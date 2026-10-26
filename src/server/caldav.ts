// CalDAV (read-only): works with iCloud, Fastmail, Nextcloud, Radicale, Synology and other CalDAV servers.
// Discovery by PROPFIND (current-user-principal -> calendar-home-set -> calendars), refresh by comparing the
// collection's getctag/sync-token and then a REPORT calendar-query for the sync window. Passwords are sent
// only over https (Basic auth), only to the server entered (plus iCloud's own partition hosts), and are stored
// encrypted. EXPERIMENTAL: exercised against a fake CalDAV server in the tests, not against real iCloud.
import { calendarMaxConnections } from "./config.ts";
import type { Db } from "./db.ts";
import { error, json, type ApiCall } from "./http.ts";
import { cleanText, parseIcs, WINDOW_FUTURE_DAYS, WINDOW_PAST_DAYS, MAX_ROWS, type EventRow } from "./ics.ts";
import { throttle } from "./ratelimit.ts";
import { CalendarFetchError, guardedFetch, normalizeCalendarUrl } from "./safe-fetch.ts";
import { all, kid, kids, parseXml, textAt, type XNode } from "./dav-xml.ts";
import {
  connectionCount,
  deleteConnection,
  fail,
  getOwnConnection,
  httpProblem,
  insertConnection,
  readSource,
  readState,
  UNREADABLE,
  viewConnection,
  type Color,
  type ConnectionRow,
  type SyncResult,
} from "./calendar-store.ts";
import { syncConnection } from "./calendar-sync.ts";

type Login = { url: string; username: string; password: string };
export type DavCalendar = { href: string; name: string; color: string | null };
type Chosen = { href: string; name: string; ctag?: string };

const basic = (l: Login) => `Basic ${Buffer.from(`${l.username}:${l.password}`).toString("base64")}`;

/** Credentials may follow redirects and absolute hrefs to iCloud's own partition hosts (p12-caldav.icloud.com), nowhere else. */
const iCloudPair = (first: string) => (host: string) => /(^|\.)icloud\.com$/i.test(first) && /(^|\.)icloud\.com$/i.test(host);

async function dav(login: Login, url: string | URL, method: "PROPFIND" | "REPORT", body: string, depth: "0" | "1"): Promise<XNode> {
  const first = new URL(login.url).hostname;
  const res = await guardedFetch(url, {
    method,
    headers: { authorization: basic(login), depth, "content-type": "application/xml; charset=utf-8", accept: "application/xml, text/xml" },
    body,
    sendAuthTo: iCloudPair(first),
  });
  if (res.status === 401) throw new CalendarFetchError("network", "The server rejected the user name or password. For iCloud, use an app-specific password, not your Apple ID password.");
  if (res.status === 403) throw new CalendarFetchError("network", "The server refused access (403). Check the user name and password.");
  if (res.status === 404) throw new CalendarFetchError("network", "The server has no calendars at that address (404). Try the server’s CalDAV address.");
  if (res.status !== 207 && res.status !== 200) throw new CalendarFetchError("network", httpProblem(res.status));
  try {
    return parseXml(res.body.toString("utf8"));
  } catch {
    throw new CalendarFetchError("network", "That address did not answer like a CalDAV server (the reply was not valid CalDAV XML).");
  }
}

const NS = `xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/"`;
const propfind = (props: string) => `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS}><d:prop>${props}</d:prop></d:propfind>`;

const resolve = (base: string | URL, href: string) => new URL(href, base);
const hrefOf = (node: XNode | undefined) => textAt(node, "href");

/** What a PROPFIND reply says about each resource: its href and the props that came back with 200. */
function responses(doc: XNode): { href: string; props: XNode }[] {
  return kids(doc, "response").flatMap((r) => {
    const href = hrefOf(r);
    const ok = kids(r, "propstat").find((p) => /\s200\b/.test(textAt(p, "status") ?? "200 OK"));
    return href && ok ? [{ href, props: kid(ok, "prop")! }] : [];
  });
}

/** Find the user's calendars starting from whatever address they typed. */
export async function discover(login: Login): Promise<{ calendars: DavCalendar[]; server: string }> {
  const start = normalizeCalendarUrl(login.url);
  if (!start.ok) throw new CalendarFetchError("invalid", start.reason);
  const base = start.url;
  const probe = propfind("<d:resourcetype/><d:displayname/><d:current-user-principal/><c:calendar-home-set/>");
  let doc: XNode;
  try {
    doc = await dav(login, base, "PROPFIND", probe, "0");
  } catch (e) {
    // A bare host name: servers publish the real path at /.well-known/caldav (RFC 6764).
    if (base.pathname === "/" && e instanceof CalendarFetchError && /404/.test(e.message)) doc = await dav(login, resolve(base, "/.well-known/caldav"), "PROPFIND", probe, "0");
    else throw e;
  }
  let home: URL | null = null;
  const first = responses(doc)[0];
  const direct = hrefOf(kid(first?.props, "calendar-home-set"));
  if (first && isCalendar(first.props)) {
    return { calendars: [toCalendar(base, first.href, first.props)], server: base.hostname }; // they gave the calendar itself
  }
  if (direct) home = resolve(base, direct);
  if (!home) {
    const principal = hrefOf(kid(first?.props, "current-user-principal"));
    if (!principal) throw new CalendarFetchError("network", "That server did not say where this account’s calendars are. Check the address.");
    const pdoc = await dav(login, resolve(base, principal), "PROPFIND", propfind("<c:calendar-home-set/>"), "0");
    const h = hrefOf(kid(responses(pdoc)[0]?.props, "calendar-home-set"));
    if (!h) throw new CalendarFetchError("network", "That account has no calendar home on the server.");
    home = resolve(resolve(base, principal), h);
  }
  const list = await dav(login, home, "PROPFIND", propfind("<d:resourcetype/><d:displayname/><a:calendar-color/><c:supported-calendar-component-set/><cs:getctag/>"), "1");
  const calendars = responses(list)
    .filter((r) => isCalendar(r.props) && supportsEvents(r.props))
    .map((r) => toCalendar(home!, r.href, r.props))
    .slice(0, 30);
  if (calendars.length === 0) throw new CalendarFetchError("network", "No calendars with events were found for that account.");
  return { calendars, server: base.hostname };
}

const isCalendar = (props: XNode) => kid(props, "resourcetype")?.children.some((c) => c.name === "calendar") === true;
/** A calendar collection that lists its supported components must include VEVENT (this skips task lists). */
const supportsEvents = (props: XNode) => {
  const set = kid(props, "supported-calendar-component-set");
  return !set || set.children.length === 0 || set.children.some((c) => c.name === "comp" && /^vevent$/i.test(c.attrs.name ?? ""));
};
function toCalendar(base: string | URL, href: string, props: XNode): DavCalendar {
  const color = textAt(props, "calendar-color");
  return { href: resolve(base, href).toString(), name: cleanText(textAt(props, "displayname"), 60) || "Calendar", color: color && /^#[0-9a-f]{6}/i.test(color) ? color.slice(0, 7) : null };
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

function reportBody(now: Date) {
  const from = new Date(now.getTime() - WINDOW_PAST_DAYS * 86_400_000);
  const to = new Date(now.getTime() + WINDOW_FUTURE_DAYS * 86_400_000);
  return `<?xml version="1.0" encoding="utf-8"?><c:calendar-query ${NS}><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${stamp(from)}" end="${stamp(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
}

async function ctagOf(login: Login, href: string): Promise<string | undefined> {
  const doc = await dav(login, href, "PROPFIND", propfind("<cs:getctag/><d:sync-token/>"), "0");
  const props = responses(doc)[0]?.props;
  return textAt(props, "getctag") ?? textAt(props, "sync-token");
}

export async function syncCaldav(db: Db, row: ConnectionRow): Promise<SyncResult> {
  const login = readSource<Login>(db, row);
  if (!login?.url || !login.username || login.password === undefined) return fail(UNREADABLE);
  const state = readState<{ calendars?: Chosen[] }>(row);
  const chosen = (state.calendars ?? []).slice(0, 30);
  if (chosen.length === 0) return fail("No calendars are selected for this connection. Remove it and connect again.");

  // Has anything changed? One cheap request per calendar.
  const ctags = await Promise.all(chosen.map((c) => ctagOf(login, c.href).catch(() => undefined)));
  const same = row.event_count > 0 && row.last_status === "ok" && chosen.every((c, i) => c.ctag && ctags[i] && c.ctag === ctags[i]);
  if (same) return { ok: true, events: "unchanged" };

  const now = new Date();
  const seen = new Set<string>();
  const rows: EventRow[] = [];
  let truncated = false;
  for (const cal of chosen) {
    const doc = await dav(login, cal.href, "REPORT", reportBody(now), "1");
    for (const r of kids(doc, "response")) {
      const data = all(r, "calendar-data")[0]?.text;
      if (!data || !/BEGIN:VCALENDAR/i.test(data)) continue;
      const parsed = parseIcs(data, now);
      truncated ||= parsed.truncated;
      for (const e of parsed.events) {
        const key = `${cal.href}|${e.uid}|${e.starts}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ ...e, uid: `${cal.href.slice(-40)}:${e.uid}` });
      }
    }
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
  }
  const next = chosen.map((c, i) => ({ ...c, ctag: ctags[i] }));
  return { ok: true, events: rows.slice(0, MAX_ROWS), state: { ...state, calendars: next }, note: truncated ? "This calendar is very large; only part of it was imported." : null };
}

// ---- HTTP handlers ----

function readLogin(c: ApiCall): Login | string {
  const b = (c.body ?? {}) as Record<string, unknown>;
  const url = normalizeCalendarUrl(b.url);
  if (!url.ok) return url.reason;
  const username = typeof b.username === "string" ? b.username.trim().slice(0, 200) : "";
  const password = typeof b.password === "string" ? b.password.slice(0, 500) : "";
  if (!username || !password) return "Enter the user name and the app-specific password.";
  return { url: url.url.toString(), username, password };
}

const friendly = (e: unknown) => (e instanceof CalendarFetchError ? e.message : "Could not talk to that CalDAV server.");

export async function caldavDiscover(c: ApiCall): Promise<Response> {
  const login = readLogin(c);
  if (typeof login === "string") return error(400, login);
  if (throttle(`caldav:discover:${c.session.user.id}`, 10, 10 * 60 * 1000) > 0) return error(429, "Too many tries. Wait a few minutes and try again.");
  try {
    const found = await discover(login);
    return json({ calendars: found.calendars.map((cal) => ({ href: cal.href, name: cal.name, color: cal.color })), server: found.server });
  } catch (e) {
    if (!(e instanceof CalendarFetchError)) console.error("[ribbon] caldav discovery failed:", e instanceof Error ? e.message : "unknown error");
    return error(400, friendly(e));
  }
}

export async function caldavConnect(c: ApiCall, opts: { color: Color; shared: boolean; syncHours: number | null }): Promise<Response> {
  const { db, session } = c;
  const user = session.user;
  const login = readLogin(c);
  if (typeof login === "string") return error(400, login);
  const b = (c.body ?? {}) as Record<string, unknown>;
  if (connectionCount(db, user.id) >= calendarMaxConnections()) return error(409, `You can connect up to ${calendarMaxConnections()} calendars. Remove one first.`);
  let found: Awaited<ReturnType<typeof discover>>;
  try {
    found = await discover(login);
  } catch (e) {
    return error(400, friendly(e));
  }
  // Only calendars the server itself listed can be chosen (nobody can point us at an arbitrary path).
  const wanted = Array.isArray(b.calendars) ? new Set(b.calendars.filter((h): h is string => typeof h === "string")) : null;
  const picked = found.calendars.filter((cal) => !wanted || wanted.has(cal.href));
  if (picked.length === 0) return error(400, "Pick at least one calendar.");
  const row = insertConnection(db, {
    userId: user.id,
    householdId: user.householdId,
    kind: "caldav",
    name: cleanText(b.name, 60) || "CalDAV calendar",
    color: opts.color,
    shared: opts.shared,
    source: login,
    state: { host: found.server, account: login.username, calendars: picked.map((p) => ({ href: p.href, name: p.name })) },
    syncHours: opts.syncHours,
  });
  const result = await syncConnection(db, row.id);
  if (!result.ok) {
    deleteConnection(db, row.id);
    return error(400, result.error);
  }
  return json({ connection: viewConnection(getOwnConnection(db, row.id, user.id, user.householdId)!) }, { status: 201 });
}
