// Google Calendar (read-only) through OAuth 2.0: authorization code + PKCE (S256) + state bound to the
// signed-in login and a cookie. Only offered when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
// Scopes: calendar.readonly, and (if the person ticks it) contacts.readonly for contact birthdays.
// Tokens are stored encrypted (see secrets.ts). Disconnecting revokes the grant at Google and deletes them.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { googleConfig, publicUrl } from "./config.ts";
import { readCookie } from "./cookies.ts";
import type { Db } from "./db.ts";
import { error, json, type ApiCall, type PublicHandler } from "./http.ts";
import { cleanText, detectSpecial, WINDOW_FUTURE_DAYS, WINDOW_PAST_DAYS, MAX_ROWS, type EventRow } from "./ics.ts";
import { throttle } from "./ratelimit.ts";
import { clientAddress, isSecureRequest, requestHost, requestScheme } from "./security.ts";
import {
  connectionCount,
  deleteConnection,
  fail,
  getConnection,
  insertConnection,
  isColor,
  readSource,
  readState,
  writeSource,
  type Color,
  type ConnectionRow,
  type SyncResult,
} from "./calendar-store.ts";
import { calendarMaxConnections } from "./config.ts";
import { syncConnection } from "./calendar-sync.ts";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";

export type GoogleEndpoints = { auth: string; token: string; revoke: string; calendar: string; people: string };
const REAL: GoogleEndpoints = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  calendar: "https://www.googleapis.com/calendar/v3",
  people: "https://people.googleapis.com/v1",
};
let endpoints: GoogleEndpoints = REAL;
/** Tests point Ribbon at a fake Google. There is no environment variable for this on purpose. */
export function setGoogleEndpoints(next: GoogleEndpoints | null) {
  endpoints = next ?? REAL;
}

const FLOW_MS = 10 * 60 * 1000;
const FLOW_COOKIE = "ribbon_gcal";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const b64url = (b: Buffer) => b.toString("base64url");

function redirectUri(request: Request): string {
  const pub = publicUrl();
  return `${pub ?? `${requestScheme(request)}://${requestHost(request)}`}/api/calendars/google/callback`;
}

const flowCookie = (state: string, secure: boolean) => `${FLOW_COOKIE}=${state}; Path=/api/calendars/google; HttpOnly; SameSite=Lax; Max-Age=${FLOW_MS / 1000}${secure ? "; Secure" : ""}`;
const clearFlowCookie = (secure: boolean) => `${FLOW_COOKIE}=; Path=/api/calendars/google; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
const back = (query: string, secure: boolean) => {
  const headers = new Headers({ location: `/settings?tab=calendars&${query}`, "cache-control": "no-store" });
  headers.append("set-cookie", clearFlowCookie(secure));
  return new Response(null, { status: 302, headers });
};

// ---- talking to Google ----

type Tokens = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
type Stored = { accessToken: string; refreshToken: string; expiresAt: number };

async function postForm(url: string, form: Record<string, string>): Promise<{ status: number; json: Tokens }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(form), redirect: "error", signal: AbortSignal.timeout(10_000) });
  let body: Tokens = {};
  try {
    body = (await res.json()) as Tokens;
  } catch {
    /* not JSON */
  }
  return { status: res.status, json: body };
}

class Reauth extends Error {}

/** A valid access token, refreshing it when it is about to expire. Throws Reauth when Google no longer honours the grant. */
async function accessToken(db: Db, row: ConnectionRow, force = false): Promise<string> {
  const stored = readSource<Stored>(db, row);
  if (!stored?.refreshToken) throw new Reauth("Google access was lost. Connect Google again.");
  if (!force && stored.accessToken && stored.expiresAt - 60_000 > Date.now()) return stored.accessToken;
  const cfg = googleConfig();
  if (!cfg) throw new Reauth("Google sign-in is no longer configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  const res = await postForm(endpoints.token, { grant_type: "refresh_token", refresh_token: stored.refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret });
  if (res.status === 400 || res.status === 401) throw new Reauth("Google says access was revoked or has expired. Connect Google again.");
  if (res.status !== 200 || !res.json.access_token) throw new Error(`Google token refresh answered ${res.status}`);
  writeSource(db, row.id, { accessToken: res.json.access_token, refreshToken: res.json.refresh_token ?? stored.refreshToken, expiresAt: Date.now() + (res.json.expires_in ?? 3600) * 1000 });
  return res.json.access_token;
}

class ApiProblem extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function api<T>(db: Db, row: ConnectionRow, url: string): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await accessToken(db, row, attempt === 1);
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 && attempt === 0) continue; // token rejected: refresh once and retry
    if (res.status === 401) throw new Reauth("Google rejected the saved access. Connect Google again.");
    if (res.status === 403) {
      const text = await res.text().catch(() => "");
      if (/accessNotConfigured|has not been used|is disabled/i.test(text)) throw new ApiProblem(403, "Google says the Calendar API is not enabled for this OAuth client. Enable “Google Calendar API” (and “People API” for contacts) in the Google Cloud project.");
      throw new ApiProblem(403, "Google refused access (403). Connect Google again and allow calendar access.");
    }
    if (res.status === 429) throw new ApiProblem(429, "Google says to slow down (429). Ribbon will try again later.");
    if (!res.ok) throw new ApiProblem(res.status, `Google answered ${res.status}.`);
    return (await res.json()) as T;
  }
  throw new Error("unreachable");
}

// ---- sync ----

type GDate = { date?: string; dateTime?: string };
type GEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GDate;
  end?: GDate;
  recurringEventId?: string;
  eventType?: string;
  birthdayProperties?: { type?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};
type GList<T> = { items?: T[]; nextPageToken?: string };
type GCalendar = { id: string; summary?: string; summaryOverride?: string; primary?: boolean; selected?: boolean };

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function googleEventRow(calendarId: string, ev: GEvent): EventRow | null {
  if (ev.status === "cancelled" || !ev.id || !ev.start) return null;
  if (ev.attendees?.some((a) => a.self && a.responseStatus === "declined")) return null;
  const title = cleanText(ev.summary, 200) || "(No title)";
  const common = { uid: `g:${cleanText(calendarId, 120)}:${ev.recurringEventId ?? ev.id}`.slice(0, 300), title, description: cleanText(ev.description, 2000), location: cleanText(ev.location, 200) };
  if (isDay(ev.start.date)) {
    const end = isDay(ev.end?.date) && ev.end!.date! > ev.start.date ? ev.end!.date! : plusDay(ev.start.date);
    const special = ev.eventType === "birthday" || ev.birthdayProperties?.type ? { kind: ev.birthdayProperties?.type === "anniversary" ? ("anniversary" as const) : ("birthday" as const), name: detectSpecial(title)?.name ?? title.replace(/['’]s\s+(birthday|anniversary).*$/i, "").trim() } : detectSpecial(title);
    return {
      ...common,
      allDay: true,
      starts: ev.start.date,
      ends: end,
      suggest: special?.name ? special.kind : null,
      suggestName: special?.name ? special.name.slice(0, 80) : null,
      suggestDate: special?.name ? `--${ev.start.date.slice(5)}` : null, // Google never says the birth year in the calendar
    };
  }
  const start = ev.start.dateTime ? new Date(ev.start.dateTime) : null;
  if (!start || Number.isNaN(start.getTime())) return null;
  const end = ev.end?.dateTime ? new Date(ev.end.dateTime) : start;
  return { ...common, allDay: false, starts: start.toISOString(), ends: (Number.isNaN(end.getTime()) || end < start ? start : end).toISOString(), suggest: null, suggestName: null, suggestDate: null };
}

function plusDay(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

type Person = { resourceName?: string; names?: { displayName?: string }[]; birthdays?: { date?: { year?: number; month?: number; day?: number } }[] };

/** Contact birthdays (People API) as yearly events across the sync window. */
export function contactBirthdayRows(people: Person[], now: Date): EventRow[] {
  const out: EventRow[] = [];
  const from = new Date(now.getTime() - WINDOW_PAST_DAYS * 86_400_000);
  const to = new Date(now.getTime() + WINDOW_FUTURE_DAYS * 86_400_000);
  for (const person of people) {
    const name = cleanText(person.names?.[0]?.displayName, 80);
    const date = person.birthdays?.find((b) => b.date?.month && b.date?.day)?.date;
    if (!name || !date?.month || !date.day) continue;
    const known = date.year && date.year >= 1900 && date.year <= now.getFullYear() ? date.year : null;
    for (let year = from.getFullYear(); year <= to.getFullYear(); year += 1) {
      const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      const day = date.month === 2 && date.day === 29 && !leap ? 28 : date.day;
      const iso = `${year}-${String(date.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (new Date(`${iso}T12:00:00Z`) < from || new Date(`${iso}T12:00:00Z`) > to) continue;
      out.push({
        uid: `contact:${cleanText(person.resourceName, 100) || name}`,
        title: `${name}’s birthday`,
        description: "",
        location: "",
        allDay: true,
        starts: iso,
        ends: plusDay(iso),
        suggest: "birthday",
        suggestName: name,
        suggestDate: known ? `${known}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}` : `--${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`,
      });
    }
  }
  return out;
}

const MAX_CALENDARS = 15;
const MAX_PAGES = 8;

export async function syncGoogle(db: Db, row: ConnectionRow): Promise<SyncResult> {
  const state = readState<{ contacts?: boolean }>(row);
  try {
    const now = new Date();
    const timeMin = new Date(now.getTime() - WINDOW_PAST_DAYS * 86_400_000).toISOString();
    const timeMax = new Date(now.getTime() + WINDOW_FUTURE_DAYS * 86_400_000).toISOString();
    const list = await api<GList<GCalendar>>(db, row, `${endpoints.calendar}/users/me/calendarList?minAccessRole=reader&maxResults=100`);
    const calendars = (list.items ?? [])
      .filter((c) => c.id && (c.selected !== false || c.primary) && !/#holiday@group\.v\.calendar\.google\.com$/.test(c.id))
      .filter((c) => !(state.contacts && c.id.startsWith("addressbook#contacts"))) // contact birthdays come from the People API instead
      .slice(0, MAX_CALENDARS);
    const rows: EventRow[] = [];
    let account: string | undefined;
    for (const cal of calendars) {
      if (cal.primary) account = cleanText(cal.id, 120);
      let pageToken = "";
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const q = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", showDeleted: "false", maxResults: "250", timeMin, timeMax });
        if (pageToken) q.set("pageToken", pageToken);
        const events = await api<GList<GEvent>>(db, row, `${endpoints.calendar}/calendars/${encodeURIComponent(cal.id)}/events?${q}`);
        for (const ev of events.items ?? []) {
          const r = googleEventRow(cal.id, ev);
          if (r) rows.push(r);
        }
        if (!events.nextPageToken || rows.length >= MAX_ROWS) break;
        pageToken = events.nextPageToken;
      }
    }
    if (state.contacts) {
      const people: Person[] = [];
      let pageToken = "";
      for (let page = 0; page < 5; page += 1) {
        const q = new URLSearchParams({ personFields: "names,birthdays", pageSize: "500" });
        if (pageToken) q.set("pageToken", pageToken);
        const res = await api<{ connections?: Person[]; nextPageToken?: string }>(db, row, `${endpoints.people}/people/me/connections?${q}`);
        people.push(...(res.connections ?? []));
        if (!res.nextPageToken) break;
        pageToken = res.nextPageToken;
      }
      rows.push(...contactBirthdayRows(people, now));
    }
    const names = calendars.map((c) => ({ name: cleanText(c.summaryOverride ?? c.summary ?? c.id, 60) }));
    return { ok: true, events: rows.slice(0, MAX_ROWS), state: { ...state, host: "Google Calendar", account, calendars: names } };
  } catch (e) {
    if (e instanceof Reauth) return fail(e.message, true);
    if (e instanceof ApiProblem) return fail(e.message);
    throw e;
  }
}

/** Revoke the grant at Google and forget the tokens. Best effort: a network failure must not block removing the connection. */
export async function disconnectGoogle(db: Db, row: ConnectionRow) {
  const stored = readSource<Stored>(db, row);
  const token = stored?.refreshToken ?? stored?.accessToken;
  if (!token) return;
  try {
    await fetch(endpoints.revoke, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }), redirect: "error", signal: AbortSignal.timeout(5_000) });
  } catch {
    /* offline or already revoked */
  }
}

// ---- starting and finishing the sign-in ----

export async function googleHandler(c: ApiCall): Promise<Response | null> {
  const { db, method, rest, body, session } = c;
  const user = session.user;
  if (method === "POST" && rest[0] === "start" && rest.length === 1) {
    const cfg = googleConfig();
    if (!cfg) return error(404, "Google Calendar is not set up on this server. The administrator needs to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
    if (throttle(`calnew:${user.id}`, 10, 10 * 60 * 1000) > 0) return error(429, "Too many tries. Wait a few minutes and try again.");
    if (connectionCount(db, user.id) >= calendarMaxConnections()) return error(409, `You can connect up to ${calendarMaxConnections()} calendars. Remove one first.`);
    const input = (body ?? {}) as Record<string, unknown>;
    const contacts = input.contacts === true;
    const settings = { name: cleanText(input.name, 60) || "Google Calendar", color: isColor(input.color) ? input.color : "blue", shared: input.shared === true };
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(48));
    const uri = redirectUri(c.request);
    db.prepare("DELETE FROM calendar_oauth_flows WHERE created_at < ?").run(Date.now() - FLOW_MS);
    db.prepare("INSERT INTO calendar_oauth_flows (state_hash, user_id, verifier, contacts, settings, redirect_uri, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(sha(state), user.id, verifier, contacts ? 1 : 0, JSON.stringify(settings), uri, Date.now());
    const auth = new URL(endpoints.auth);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("client_id", cfg.clientId);
    auth.searchParams.set("redirect_uri", uri);
    auth.searchParams.set("scope", contacts ? `${CALENDAR_SCOPE} ${CONTACTS_SCOPE}` : CALENDAR_SCOPE);
    auth.searchParams.set("state", state);
    auth.searchParams.set("code_challenge", b64url(createHash("sha256").update(verifier).digest()));
    auth.searchParams.set("code_challenge_method", "S256");
    auth.searchParams.set("access_type", "offline"); // a refresh token, so the calendar keeps syncing
    auth.searchParams.set("prompt", "consent");
    auth.searchParams.set("include_granted_scopes", "false");
    return json({ url: auth.toString() }, { cookie: flowCookie(state, isSecureRequest(c.request)) });
  }
  return null;
}

/** The browser comes back from Google here, so this runs before the usual sign-in check and does its own. */
export const googlePublicHandler: PublicHandler = async (c) => {
  if (c.resource !== "calendars" || c.id !== "google" || c.rest[0] !== "callback" || c.rest.length !== 1 || c.method !== "GET") return null;
  const secure = isSecureRequest(c.request);
  const cfg = googleConfig();
  if (!cfg) return back("google=error&reason=config", secure);
  if (throttle(`gcal:cb:${clientAddress(c.request)}`, 30, 15 * 60 * 1000) > 0) return back("google=error&reason=busy", secure);
  const q = c.url.searchParams;
  const state = q.get("state") ?? "";
  const flow = state
    ? (c.db.prepare("SELECT user_id, verifier, contacts, settings, redirect_uri, created_at FROM calendar_oauth_flows WHERE state_hash = ?").get(sha(state)) as
        | { user_id: string; verifier: string; contacts: number; settings: string; redirect_uri: string; created_at: number }
        | undefined)
    : undefined;
  if (state) c.db.prepare("DELETE FROM calendar_oauth_flows WHERE state_hash = ?").run(sha(state)); // single use
  const cookie = readCookie(c.request, FLOW_COOKIE) ?? "";
  const same = cookie.length === state.length && cookie.length > 0 && timingSafeEqual(Buffer.from(cookie), Buffer.from(state));
  // The state must be one we issued, to this very browser, for the login that is signed in right now.
  if (!flow || !same || Date.now() - flow.created_at > FLOW_MS || !c.session || c.session.user.id !== flow.user_id) return back("google=error&reason=state", secure);
  if (q.get("error")) return back("google=error&reason=denied", secure);
  const code = q.get("code");
  if (!code) return back("google=error&reason=state", secure);
  const user = c.session.user;
  let created: ConnectionRow | null = null;
  try {
    const res = await postForm(endpoints.token, { grant_type: "authorization_code", code, redirect_uri: flow.redirect_uri, client_id: cfg.clientId, client_secret: cfg.clientSecret, code_verifier: flow.verifier });
    if (res.status !== 200 || !res.json.access_token) return back("google=error&reason=token", secure);
    if (!res.json.refresh_token) return back("google=error&reason=norefresh", secure);
    const granted = (res.json.scope ?? "").split(/\s+/);
    if (!granted.includes(CALENDAR_SCOPE)) return back("google=error&reason=scope", secure);
    const wantsContacts = flow.contacts === 1 && granted.includes(CONTACTS_SCOPE);
    const settings = JSON.parse(flow.settings) as { name: string; color: Color; shared: boolean };
    created = insertConnection(c.db, {
      userId: user.id,
      householdId: user.householdId,
      kind: "google",
      name: settings.name,
      color: isColor(settings.color) ? settings.color : "blue",
      shared: settings.shared === true,
      source: { accessToken: res.json.access_token, refreshToken: res.json.refresh_token, expiresAt: Date.now() + (res.json.expires_in ?? 3600) * 1000 },
      state: { host: "Google Calendar", contacts: wantsContacts },
    });
    const synced = await syncConnection(c.db, created.id);
    if (!synced.ok) {
      await disconnectGoogle(c.db, getConnection(c.db, created.id)!);
      deleteConnection(c.db, created.id);
      return back("google=error&reason=sync", secure);
    }
    return back(`google=connected&id=${encodeURIComponent(created.id)}`, secure);
  } catch (err) {
    console.error("[ribbon] google connect failed:", err instanceof Error ? err.message : "unknown error"); // never the code or tokens
    if (created && getConnection(c.db, created.id)) deleteConnection(c.db, created.id);
    return back("google=error&reason=failed", secure);
  }
};
