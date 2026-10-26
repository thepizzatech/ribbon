// The calendar page's data: one merged, viewer-safe list of birthdays, anniversaries, yearly occasions,
// gift deadlines, Secret Santa dates, manual events and imported events; plus the KPI summary and manual
// events. Every source is read through the same visibility rules as the rest of Ribbon:
//  * people, gifts and occasions: this household only, gifts planned for the viewer are never included
//  * Secret Santa: only exchanges the viewer may see
//  * manual and imported events: the author's own, plus ones they chose to share with the household
//    (a shared manual event about the viewer is hidden from the viewer unless they wrote it)
import { randomUUID } from "node:crypto";
import { addDays, daysBetween, monthDay, upcoming, type Upcoming } from "../lib/gifts/upcoming.ts";
import { decode, error, json, type Handler } from "./http.ts";
import { getLedger } from "./ledger.ts";
import { listExchanges } from "./secretsanta.ts";
import { cleanText } from "./ics.ts";
import { pendingReviews, type Color } from "./calendar-store.ts";
import type { Db } from "./db.ts";
import type { User } from "./users.ts";

export type CalSource = "birthday" | "anniversary" | "occasion" | "gift" | "santa" | "manual" | "external";
export type CalEvent = {
  id: string;
  source: CalSource;
  title: string;
  allDay: boolean;
  /** all day: "YYYY-MM-DD". timed: "...Z" (an instant) or "YYYY-MM-DDTHH:MM:SS" (as written, no zone) */
  start: string;
  /** all day: "YYYY-MM-DD", exclusive */
  end: string;
  tone: Color;
  personId: string | null;
  note?: string;
  location?: string;
  turning?: number;
  toBuy?: { personId: string; name: string }[];
  covered?: number;
  occasion?: string;
  manualId?: string;
  yearly?: boolean;
  shared?: boolean;
  canEdit?: boolean;
  connectionId?: string;
  connectionName?: string;
  sharedBy?: string;
  exchangeId?: string;
  giftId?: string;
};

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function validDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return y >= 1970 && y <= 2100 && date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_RANGE_DAYS = 400;
const pad = (n: number) => String(n).padStart(2, "0");
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The month/day of a yearly date in `year` (Feb 29 becomes Feb 28 in common years). */
const inYear = (month: number, day: number, year: number) => `${year}-${pad(month)}-${pad(month === 2 && day === 29 && !isLeap(year) ? 28 : day)}`;

const first = (name: string) => name.split(" ")[0] ?? name;

type Range = { from: string; to: string };
const inside = (date: string, r: Range) => date >= r.from && date <= r.to;

export function buildEvents(db: Db, user: User, range: Range, today: string): CalEvent[] {
  const ctx = { db, hid: user.householdId, me: user.personId };
  const ledger = getLedger(ctx); // gifts already exclude surprises planned for this viewer
  const out: CalEvent[] = [];
  const fromYear = Number(range.from.slice(0, 4));
  const toYear = Number(range.to.slice(0, 4));

  // "Still to buy" comes from the same rules as the Overview card, for each thing's next date.
  const ups = upcoming({ people: ledger.people, gifts: ledger.gifts, occasionDates: ledger.occasionDates, mePersonId: user.personId, today, days: 400 });
  const upByKey = new Map<string, Upcoming>(ups.map((u) => [`${u.key}|${u.date}`, u]));
  const withNeeds = (e: CalEvent, key: string): CalEvent => {
    const u = upByKey.get(`${key}|${e.start}`);
    return u ? { ...e, toBuy: u.toBuy.map((t) => ({ personId: t.personId, name: t.name })), covered: u.covered } : e;
  };

  for (const person of ledger.people) {
    for (const [field, source, tone, label, occasion] of [
      ["birthday", "birthday", "pink", "birthday", "Birthday"],
      ["anniversary", "anniversary", "amber", "anniversary", "Anniversary"],
    ] as const) {
      const parts = person[field] ? monthDay(person[field]!) : null;
      if (!parts) continue;
      for (let year = fromYear; year <= toYear; year += 1) {
        const date = inYear(parts.month, parts.day, year);
        if (!inside(date, range)) continue;
        const event: CalEvent = {
          id: `${source}:${person.id}:${date}`,
          source,
          title: `${first(person.name)}’s ${label}`,
          allDay: true,
          start: date,
          end: addDays(date, 1),
          tone,
          personId: person.id,
          occasion,
          ...(parts.year && year > parts.year ? { turning: year - parts.year } : {}),
        };
        out.push(withNeeds(event, `${source}:${person.id}`));
      }
    }
  }

  for (const [name, value] of Object.entries(ledger.occasionDates)) {
    const parts = monthDay(value);
    if (!parts) continue;
    for (let year = fromYear; year <= toYear; year += 1) {
      const date = inYear(parts.month, parts.day, year);
      if (!inside(date, range)) continue;
      out.push(withNeeds({ id: `occasion:${name}:${date}`, source: "occasion", title: cleanText(name, 80), allDay: true, start: date, end: addDays(date, 1), tone: "purple", personId: null, occasion: name }, `occasion:${name}`));
    }
  }

  const nameOf = new Map(ledger.people.map((p) => [p.id, p.name]));
  for (const gift of ledger.gifts) {
    if (gift.direction !== "given" || gift.status === "delivered" || !validDate(gift.date) || !inside(gift.date, range)) continue;
    out.push({
      id: `gift:${gift.id}`,
      source: "gift",
      title: `${gift.title} for ${first(nameOf.get(gift.receiverId) ?? "someone")}`,
      allDay: true,
      start: gift.date,
      end: addDays(gift.date, 1),
      tone: "red",
      personId: gift.receiverId,
      note: gift.status === "idea" ? "Gift idea, not bought yet" : "Bought, not given yet",
      occasion: gift.occasion,
      giftId: gift.id,
    });
  }

  for (const ex of listExchanges(db, user)) {
    if (!validDate(ex.date) || !inside(ex.date, range)) continue;
    out.push({ id: `santa:${ex.id}`, source: "santa", title: cleanText(ex.name, 80), allDay: true, start: ex.date, end: addDays(ex.date, 1), tone: "green", personId: null, exchangeId: ex.id, note: ex.status === "drawn" ? "Names drawn" : "Names not drawn yet" });
  }

  out.push(...manualEvents(db, user, range, nameOf));
  out.push(...importedEvents(db, user, range));
  return out;
}

type ManualRow = { id: string; user_id: string; title: string; notes: string; all_day: number; date: string; start_time: string | null; end_time: string | null; person_id: string | null; yearly: number; shared: number };

function manualEvents(db: Db, user: User, range: Range, people: Map<string, string>): CalEvent[] {
  const rows = db
    .prepare(
      `SELECT id, user_id, title, notes, all_day, date, start_time, end_time, person_id, yearly, shared FROM manual_events
       WHERE household_id = ? AND (user_id = ? OR shared = 1)`,
    )
    .all(user.householdId, user.id) as ManualRow[];
  const out: CalEvent[] = [];
  const fromYear = Number(range.from.slice(0, 4));
  const toYear = Number(range.to.slice(0, 4));
  for (const row of rows) {
    // Something planned about you and shared with the household stays out of your view (unless you wrote it).
    if (row.user_id !== user.id && user.personId && row.person_id === user.personId) continue;
    const parts = monthDay(row.date)!;
    const dates = row.yearly === 1 ? Array.from({ length: toYear - fromYear + 1 }, (_, i) => inYear(parts.month, parts.day, fromYear + i)).filter((d) => d >= row.date) : [row.date];
    for (const date of dates) {
      if (!inside(date, range)) continue;
      const allDay = row.all_day === 1;
      const start = allDay ? date : `${date}T${row.start_time ?? "09:00"}:00`;
      const end = allDay ? addDays(date, 1) : `${date}T${row.end_time ?? addHour(row.start_time ?? "09:00")}:00`;
      out.push({
        id: `manual:${row.id}:${date}`,
        source: "manual",
        title: row.title,
        allDay,
        start,
        end,
        tone: "blue",
        personId: row.person_id && people.has(row.person_id) ? row.person_id : null,
        ...(row.notes ? { note: row.notes } : {}),
        manualId: row.id,
        yearly: row.yearly === 1,
        shared: row.shared === 1,
        canEdit: row.user_id === user.id || (user.role === "owner" && row.shared === 1),
      });
    }
  }
  return out;
}

function addHour(time: string): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h >= 23 ? "23:59" : `${pad(h + 1)}:${pad(m)}`;
}

type ExtRow = { id: string; connection_id: string; title: string; description: string; location: string; all_day: number; starts: string; ends: string; cname: string; color: Color; owner_id: string; owner: string };

function importedEvents(db: Db, user: User, range: Range): CalEvent[] {
  const rows = db
    .prepare(
      `SELECT e.id, e.connection_id, e.title, e.description, e.location, e.all_day, e.starts, e.ends,
              c.name AS cname, c.color, c.user_id AS owner_id, u.display_name AS owner
       FROM calendar_events e
       JOIN calendar_connections c ON c.id = e.connection_id
       JOIN users u ON u.id = c.user_id
       LEFT JOIN calendar_reviews r ON r.connection_id = e.connection_id AND r.uid = e.uid
       WHERE c.enabled = 1 AND c.household_id = ? AND (c.user_id = ? OR c.shared = 1)
         AND COALESCE(r.state, '') NOT IN ('matched', 'created')
         AND e.starts < ? AND e.ends > ?
       ORDER BY e.starts LIMIT 3000`,
    )
    .all(user.householdId, user.id, `${addDays(range.to, 2)}T00:00:00`, `${addDays(range.from, -2)}`) as ExtRow[];
  return rows.map((r) => ({
    id: `ext:${r.id}`,
    source: "external" as const,
    title: r.title,
    allDay: r.all_day === 1,
    start: r.starts,
    end: r.ends,
    tone: r.color,
    personId: null,
    ...(r.description ? { note: r.description } : {}),
    ...(r.location ? { location: r.location } : {}),
    connectionId: r.connection_id,
    connectionName: r.cname,
    ...(r.owner_id !== user.id ? { sharedBy: r.owner } : {}),
  }));
}

// ---- summary ----

function weekOf(today: string): Range {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
  const monday = addDays(today, -dow);
  return { from: monday, to: addDays(monday, 6) };
}

export function summary(db: Db, user: User, today: string) {
  const week = weekOf(today);
  const weekEvents = buildEvents(db, user, week, today);
  const month = buildEvents(db, user, { from: today, to: addDays(today, 30) }, today);
  const todays = weekEvents.filter((e) => (e.allDay ? e.start <= today && e.end > today : e.start.slice(0, 10) === today));
  const needs = month.filter((e) => e.toBuy && e.toBuy.length > 0);
  const tones = [...new Set(todays.map((e) => e.tone))].slice(0, 3);
  return {
    today,
    week,
    eventsThisWeek: weekEvents.length,
    birthdaysIn30: month.filter((e) => e.source === "birthday").length,
    giftsNeeded: needs.reduce((n, e) => n + (e.toBuy?.length ?? 0), 0),
    giftEventsNeeded: needs.length,
    todayTones: tones,
    todayCount: todays.length,
    pendingReviews: pendingReviews(db, user.id, user.householdId).length,
    comingUp: month
      .filter((e) => e.source === "birthday" || e.source === "anniversary" || e.source === "occasion" || e.source === "santa")
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 8)
      .map((e) => ({ ...e, daysLeft: daysBetween(today, e.start.slice(0, 10)) })),
  };
}

// ---- manual events ----

type ManualCols = { title: string; notes: string; all_day: number; date: string; start_time: string | null; end_time: string | null; person_id: string | null; yearly: number; shared: number };

/** Check a complete manual event (what a create sends, or an existing one with a patch applied). */
function validateManual(input: Record<string, unknown>, db: Db, householdId: string): { ok: true; cols: ManualCols } | { ok: false; reason: string } {
  const title = cleanText(input.title, 120).replace(/\s+/g, " ");
  if (!title) return { ok: false, reason: "Give the event a title." };
  if (!validDate(input.date)) return { ok: false, reason: "Pick a date." };
  const allDay = input.allDay !== false;
  let startTime: string | null = null;
  let endTime: string | null = null;
  if (!allDay) {
    if (typeof input.startTime !== "string" || !TIME.test(input.startTime)) return { ok: false, reason: input.startTime ? "Times look like 14:30." : "Pick a start time, or make it all day." };
    startTime = input.startTime;
    if (input.endTime !== undefined && input.endTime !== null && input.endTime !== "") {
      if (typeof input.endTime !== "string" || !TIME.test(input.endTime)) return { ok: false, reason: "Times look like 14:30." };
      if (input.endTime <= startTime) return { ok: false, reason: "The end time has to be after the start time." };
      endTime = input.endTime;
    }
  }
  let personId: string | null = null;
  if (input.personId !== undefined && input.personId !== null && input.personId !== "") {
    if (typeof input.personId !== "string" || !db.prepare("SELECT 1 FROM people WHERE id = ? AND household_id = ?").get(input.personId, householdId)) {
      return { ok: false, reason: "Pick a person from your household." };
    }
    personId = input.personId;
  }
  return { ok: true, cols: { title, notes: cleanText(input.notes, 1000), all_day: allDay ? 1 : 0, date: input.date, start_time: startTime, end_time: endTime, person_id: personId, yearly: input.yearly === true ? 1 : 0, shared: input.shared === true ? 1 : 0 } };
}

function viewManual(db: Db, id: string, user: User) {
  const row = db.prepare("SELECT id, user_id, title, notes, all_day, date, start_time, end_time, person_id, yearly, shared FROM manual_events WHERE id = ? AND household_id = ?").get(id, user.householdId) as ManualRow | undefined;
  if (!row) return null;
  return { id: row.id, title: row.title, notes: row.notes, allDay: row.all_day === 1, date: row.date, startTime: row.start_time, endTime: row.end_time, personId: row.person_id, yearly: row.yearly === 1, shared: row.shared === 1, mine: row.user_id === user.id };
}

const MAX_MANUAL = 500;

export const calendarEventsHandler: Handler = (c) => {
  if (c.resource !== "calendar") return null;
  const { db, method, id, rest, session, url } = c;
  const user = session.user;

  if (method === "GET" && id === "events" && rest.length === 0) {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const today = url.searchParams.get("today");
    if (!validDate(from) || !validDate(to) || !validDate(today)) return error(400, "Send from, to and today as YYYY-MM-DD.");
    if (to < from || daysBetween(from, to) > MAX_RANGE_DAYS) return error(400, `Ask for at most ${MAX_RANGE_DAYS} days at a time.`);
    return json({ events: buildEvents(db, user, { from, to }, today) });
  }

  if (method === "GET" && id === "summary" && rest.length === 0) {
    const today = url.searchParams.get("today");
    if (!validDate(today)) return error(400, "Send today as YYYY-MM-DD.");
    return json(summary(db, user, today));
  }

  if (id !== "manual") return null;

  if (method === "POST" && rest.length === 0) {
    const count = (db.prepare("SELECT COUNT(*) AS n FROM manual_events WHERE user_id = ?").get(user.id) as { n: number }).n;
    if (count >= MAX_MANUAL) return error(409, `You can keep up to ${MAX_MANUAL} events of your own. Delete some first.`);
    const read = validateManual((c.body ?? {}) as Record<string, unknown>, db, user.householdId);
    if (!read.ok) return error(400, read.reason);
    const v = read.cols;
    const newId = randomUUID();
    db.prepare(
      `INSERT INTO manual_events (id, household_id, user_id, title, notes, all_day, date, start_time, end_time, person_id, yearly, shared, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId, user.householdId, user.id, v.title, v.notes, v.all_day, v.date, v.start_time, v.end_time, v.person_id, v.yearly, v.shared, new Date().toISOString());
    return json({ event: viewManual(db, newId, user) }, { status: 201 });
  }

  if (rest.length !== 1) return null;
  const target = decode(rest[0]!);
  if (!target) return error(400, "Bad id in the address.");
  const row = db.prepare("SELECT id, user_id, shared FROM manual_events WHERE id = ? AND household_id = ?").get(target, user.householdId) as { id: string; user_id: string; shared: number } | undefined;
  // Someone else's private event doesn't exist as far as you can tell.
  if (!row || (row.user_id !== user.id && row.shared !== 1)) return error(404, "That event is gone.");
  const mayEdit = row.user_id === user.id || (user.role === "owner" && row.shared === 1);
  if (!mayEdit) return error(403, "Only the person who made this event (or an owner, for shared ones) can change it.");

  if (method === "PATCH") {
    const current = viewManual(db, row.id, user)!;
    const patch = (c.body ?? {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...current };
    for (const key of ["title", "date", "allDay", "startTime", "endTime", "notes", "yearly", "shared", "personId"]) if (patch[key] !== undefined) merged[key] = patch[key];
    if (merged.allDay === true) {
      merged.startTime = null;
      merged.endTime = null;
    }
    // Only the author decides who it is shared with.
    if (row.user_id !== user.id) merged.shared = current.shared;
    const read = validateManual(merged, db, user.householdId);
    if (!read.ok) return error(400, read.reason);
    const v = read.cols;
    db.prepare("UPDATE manual_events SET title = ?, notes = ?, all_day = ?, date = ?, start_time = ?, end_time = ?, person_id = ?, yearly = ?, shared = ? WHERE id = ?").run(v.title, v.notes, v.all_day, v.date, v.start_time, v.end_time, v.person_id, v.yearly, v.shared, row.id);
    return json({ event: viewManual(db, row.id, user) });
  }
  if (method === "DELETE") {
    db.prepare("DELETE FROM manual_events WHERE id = ?").run(row.id);
    return json({ ok: true });
  }
  return null;
};
