// /api/calendars: a person's calendar connections (ICS link, ICS file, Google, CalDAV), the review of
// birthday-like events, and Sync now. Everything here is private to the signed-in login: a connection is
// only ever read, changed, synced or deleted by the login that made it (shared ones are read-only to others,
// and only through the calendar view).
import { cleanMonthDay, relationshipLabel, RELATIONSHIPS } from "../lib/gifts/model.ts";
import { calendarMaxConnections, calendarSyncHours, googleConfig } from "./config.ts";
import { error, json, type Handler } from "./http.ts";
import { addPerson, getPerson, updatePerson } from "./ledger.ts";
import { throttle } from "./ratelimit.ts";
import { normalizeCalendarUrl } from "./safe-fetch.ts";
import { parseIcs, cleanText } from "./ics.ts";
import { caldavConnect, caldavDiscover } from "./caldav.ts";
import { disconnectGoogle, googleHandler } from "./google.ts";
import { syncConnection } from "./calendar-sync.ts";
import {
  connectionCount,
  deleteConnection,
  getConnection,
  getOwnConnection,
  insertConnection,
  isColor,
  looksLikeIcs,
  ownConnections,
  pendingReviews,
  readState,
  replaceEvents,
  markSynced,
  viewConnection,
  type Color,
  type ConnectionRow,
} from "./calendar-store.ts";
import type { Db } from "./db.ts";

const TEN_MIN = 10 * 60 * 1000;
const MIN_GAP_MS = 15_000; // between two "Sync now" presses on one calendar

function cleanName(value: unknown, fallback: string): string {
  return cleanText(value, 60).replace(/\s+/g, " ") || fallback;
}

function readSyncHours(value: unknown): number | null | "bad" {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 168 ? n : "bad";
}

function listing(db: Db, userId: string, householdId: string) {
  const mine = ownConnections(db, userId, householdId).map((row) => viewConnection(row));
  const shared = (
    db
      .prepare(
        `SELECT c.id, c.name, c.color, u.display_name AS owner FROM calendar_connections c JOIN users u ON u.id = c.user_id
         WHERE c.household_id = ? AND c.shared = 1 AND c.user_id != ? ORDER BY c.name`,
      )
      .all(householdId, userId) as { id: string; name: string; color: string; owner: string }[]
  ).map((c) => ({ id: c.id, name: c.name, color: c.color, owner: c.owner }));
  return {
    connections: mine,
    sharedWithMe: shared,
    providers: { ics: true, google: googleConfig() !== null, caldav: true },
    limits: { maxConnections: calendarMaxConnections(), defaultSyncHours: calendarSyncHours() },
    pendingReviews: pendingReviews(db, userId, householdId).length,
  };
}

export const calendarConnectionsHandler: Handler = async (c) => {
  if (c.resource !== "calendars") return null;
  const { db, method, id, rest, body, session } = c;
  const user = session.user;
  const input = (body ?? {}) as Record<string, unknown>;

  // ---- list ----
  if (method === "GET" && id === undefined) return json(listing(db, user.id, user.householdId));

  // ---- Google (OAuth) ----
  if (id === "google") return googleHandler(c);

  // ---- review of birthday-like events ----
  if (id === "review" && rest.length === 0) {
    if (method === "GET") {
      const people = c.ctx && db.prepare("SELECT id, name, birthday, anniversary FROM people WHERE household_id = ? ORDER BY seq").all(user.householdId) as { id: string; name: string; birthday: string | null; anniversary: string | null }[];
      const items = pendingReviews(db, user.id, user.householdId).map((item) => {
        const wanted = item.name.toLowerCase();
        const first = wanted.split(" ")[0];
        const matches = people
          .filter((p) => p.name.toLowerCase() === wanted || p.name.toLowerCase().split(" ")[0] === first)
          .map((p) => ({ id: p.id, name: p.name, current: item.kind === "birthday" ? p.birthday : p.anniversary }));
        return { ...item, matches };
      });
      return json({ items, people: people.map((p) => ({ id: p.id, name: p.name })) });
    }
    if (method === "POST") return decide(c);
    return null;
  }

  // ---- add a connection ----
  if (method === "POST" && id === undefined) {
    if (throttle(`calnew:${user.id}`, 10, TEN_MIN) > 0) return error(429, "Too many tries. Wait a few minutes and try again.");
    if (connectionCount(db, user.id) >= calendarMaxConnections()) return error(409, `You can connect up to ${calendarMaxConnections()} calendars. Remove one first.`);
    const color: Color = isColor(input.color) ? input.color : "purple";
    const shared = input.shared === true;
    const syncHours = readSyncHours(input.syncHours);
    if (syncHours === "bad") return error(400, "Refresh every 1 to 168 hours.");

    if (input.kind === "ics_url") {
      const url = normalizeCalendarUrl(input.url);
      if (!url.ok) return error(400, url.reason);
      const row = insertConnection(db, { userId: user.id, householdId: user.householdId, kind: "ics_url", name: cleanName(input.name, "Calendar"), color, shared, source: { url: url.url.toString() }, state: { host: url.url.hostname }, syncHours });
      const result = await syncConnection(db, row.id);
      if (!result.ok) {
        deleteConnection(db, row.id); // a link that can't be read isn't kept
        return error(400, result.error);
      }
      // No name given: use the calendar's own name (X-WR-CALNAME) when the feed has one.
      const calName = cleanText(readState<{ calName?: string }>(getConnection(db, row.id)!).calName, 60);
      if (!cleanText(input.name, 60) && calName) db.prepare("UPDATE calendar_connections SET name = ? WHERE id = ?").run(calName, row.id);
      return json({ connection: viewConnection(getOwnConnection(db, row.id, user.id, user.householdId)!), ...listing(db, user.id, user.householdId) }, { status: 201 });
    }

    if (input.kind === "caldav") return caldavConnect(c, { color, shared, syncHours });

    return error(400, "Pick how to connect: a calendar link, an .ics file, Google or CalDAV.");
  }

  if (method === "POST" && id === "upload" && rest.length === 0) {
    if (throttle(`calnew:${user.id}`, 10, TEN_MIN) > 0) return error(429, "Too many tries. Wait a few minutes and try again.");
    if (connectionCount(db, user.id) >= calendarMaxConnections()) return error(409, `You can connect up to ${calendarMaxConnections()} calendars. Remove one first.`);
    const text = typeof input.text === "string" ? input.text.replace(/^\uFEFF/, "") : "";
    if (!text || !looksLikeIcs(text)) return error(400, "That file is not a calendar (.ics) file.");
    const parsed = parseIcs(text);
    if (parsed.events.length === 0) return error(400, "No events were found in that file (from two months ago to fourteen months ahead).");
    const row = insertConnection(db, {
      userId: user.id,
      householdId: user.householdId,
      kind: "ics_file",
      name: cleanName(input.name, parsed.name ?? "Imported calendar"),
      color: isColor(input.color) ? input.color : "purple",
      shared: input.shared === true,
      source: {},
      state: {},
    });
    replaceEvents(db, row.id, parsed.events);
    markSynced(db, row.id, parsed.truncated ? "This file is very large; only part of it was imported." : null);
    return json({ connection: viewConnection(getOwnConnection(db, row.id, user.id, user.householdId)!), ...listing(db, user.id, user.householdId) }, { status: 201 });
  }

  if (method === "POST" && id === "caldav" && rest[0] === "discover" && rest.length === 1) return caldavDiscover(c);

  // ---- one connection ----
  if (id === undefined || id === "upload" || id === "caldav") return null;
  const row = getOwnConnection(db, id, user.id, user.householdId);
  if (!row) return error(404, "That calendar is gone.");

  if (method === "PATCH" && rest.length === 0) {
    const sets: string[] = [];
    const args: (string | number | null)[] = [];
    if (input.name !== undefined) {
      sets.push("name = ?");
      args.push(cleanName(input.name, row.name));
    }
    if (input.color !== undefined) {
      if (!isColor(input.color)) return error(400, "Pick one of the colours.");
      sets.push("color = ?");
      args.push(input.color);
    }
    if (input.enabled !== undefined) {
      sets.push("enabled = ?");
      args.push(input.enabled === true ? 1 : 0);
    }
    if (input.shared !== undefined) {
      sets.push("shared = ?");
      args.push(input.shared === true ? 1 : 0);
    }
    if (input.syncHours !== undefined) {
      const hours = readSyncHours(input.syncHours);
      if (hours === "bad") return error(400, "Refresh every 1 to 168 hours.");
      sets.push("sync_hours = ?");
      args.push(hours);
    }
    if (sets.length > 0) db.prepare(`UPDATE calendar_connections SET ${sets.join(", ")} WHERE id = ?`).run(...args, row.id);
    return json({ connection: viewConnection(getOwnConnection(db, row.id, user.id, user.householdId)!) });
  }

  if (method === "DELETE" && rest.length === 0) {
    if (row.kind === "google") await disconnectGoogle(db, row); // revokes the grant at Google, best effort
    deleteConnection(db, row.id);
    return json({ ok: true });
  }

  if (method === "POST" && rest[0] === "sync" && rest.length === 1) {
    if (row.kind === "ics_file") return error(400, "A file import can’t refresh. Remove it and upload the newer file.");
    const sinceLast = row.last_attempt_at ? Date.now() - Date.parse(row.last_attempt_at) : Infinity;
    if (sinceLast < MIN_GAP_MS) {
      const response = error(429, "That calendar was just refreshed. Give it a few seconds.");
      response.headers.set("retry-after", String(Math.ceil((MIN_GAP_MS - sinceLast) / 1000)));
      return response;
    }
    const wait = throttle(`calsync:${user.id}`, 12, TEN_MIN);
    if (wait > 0) {
      const response = error(429, "That is a lot of refreshing. Try again in a few minutes.");
      response.headers.set("retry-after", String(wait));
      return response;
    }
    const result = await syncConnection(db, row.id);
    const fresh = getOwnConnection(db, row.id, user.id, user.householdId)!;
    return json({ ok: result.ok, error: result.ok ? null : result.error, connection: viewConnection(fresh) }, { status: result.ok ? 200 : 502 });
  }
  return null;
};

type DecideCall = Parameters<Handler>[0];

function decide(c: DecideCall): Response {
  const { db, body, session, ctx } = c;
  const user = session.user;
  const input = (body ?? {}) as Record<string, unknown>;
  const connectionId = typeof input.connectionId === "string" ? input.connectionId : "";
  const uid = typeof input.uid === "string" ? input.uid : "";
  const action = input.action;
  if (action !== "match" && action !== "create" && action !== "ignore") return error(400, "Choose to match a person, create a person, or ignore.");
  const connection: ConnectionRow | undefined = connectionId ? getOwnConnection(db, connectionId, user.id, user.householdId) : undefined;
  const pending = connection ? pendingReviews(db, user.id, user.householdId).find((p) => p.connectionId === connection.id && p.uid === uid) : undefined;
  if (!connection || !pending) return error(404, "That suggestion is gone.");
  const now = new Date().toISOString();
  const mark = (state: "matched" | "created" | "ignored", personId: string | null) =>
    db.prepare("INSERT OR REPLACE INTO calendar_reviews (connection_id, uid, state, person_id, created_at) VALUES (?, ?, ?, ?, ?)").run(connection.id, uid, state, personId, now);

  if (action === "ignore") {
    mark("ignored", null);
    return json({ ok: true });
  }
  let date = pending.date;
  if (input.date !== undefined && input.date !== "") {
    const clean = cleanMonthDay(input.date);
    if (!clean) return error(400, "Dates look like 2026-12-25, or --12-25 when the year is unknown.");
    date = clean;
  }
  const field = pending.kind === "birthday" ? "birthday" : "anniversary";

  if (action === "match") {
    const personId = typeof input.personId === "string" ? input.personId : "";
    const person = getPerson(ctx, personId); // only people of this household
    if (!person) return error(404, "Pick a person from your household.");
    const current = person[field] ?? null;
    if (current && current !== date && input.overwrite !== true) {
      return json({ error: `${person.name} already has a ${field} (${current}). Replace it?`, code: "exists", current }, { status: 409 });
    }
    const result = updatePerson(ctx, personId, { [field]: date });
    if (!result.ok) return error(result.status, result.reason);
    mark("matched", personId);
    return json({ ok: true, person: result.person });
  }

  // create
  const name = cleanText(input.name ?? pending.name, 80);
  if (!name) return error(400, "Name the person.");
  const relationship = RELATIONSHIPS.some((r) => r.key === input.relationship && r.key !== "self") ? (input.relationship as string) : "other";
  const result = addPerson(ctx, { name, role: relationshipLabel(relationship), relationship, circle: "outside", [field]: date });
  if (!result.ok) return error(result.status, result.reason);
  mark("created", result.person.id);
  return json({ ok: true, person: result.person }, { status: 201 });
}
