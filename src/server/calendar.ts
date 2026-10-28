// Calendar feed (.ics) with a secret per-user link, plus the settings behind it.
import { randomBytes } from "node:crypto";
import type { Db } from "./db.ts";
import { error, json, type Handler, type PublicHandler } from "./http.ts";
import { buildEvents, type CalEvent } from "./calendar-events.ts";
import { householdRow } from "./ledger.ts";
import { addDays, monthDay } from "../lib/gifts/upcoming.ts";
import { getUser, type User } from "./users.ts";

export const DEFAULT_REMIND_DAYS = 14;

type Prefs = { calendar_token: string | null; remind_days: number };

export function getPrefs(db: Db, userId: string): Prefs {
  const row = db.prepare("SELECT calendar_token, remind_days FROM user_prefs WHERE user_id = ?").get(userId) as Prefs | undefined;
  return row ?? { calendar_token: null, remind_days: DEFAULT_REMIND_DAYS };
}

function ensureRow(db: Db, userId: string) {
  db.prepare("INSERT OR IGNORE INTO user_prefs (user_id) VALUES (?)").run(userId);
}

export function newToken(db: Db, userId: string): string {
  ensureRow(db, userId);
  const token = randomBytes(24).toString("base64url");
  db.prepare("UPDATE user_prefs SET calendar_token = ? WHERE user_id = ?").run(token, userId);
  return token;
}

export function userForToken(db: Db, token: string): User | undefined {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return undefined;
  const row = db.prepare("SELECT user_id FROM user_prefs WHERE calendar_token = ?").get(token) as { user_id: string } | undefined;
  return row ? getUser(db, row.user_id) : undefined;
}

// Control characters (a bare CR, NUL, ...) are dropped first: a name with "\rATTENDEE:..." must not start a new iCalendar line.
const escapeText = (value: string) =>
  value
    .replace(/\r\n|\r|\n/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");

/** RFC 5545 folding: lines at most 75 octets, continuation lines start with a space. */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // don't split inside a multibyte character
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74;
  }
  return parts.join("\r\n ");
}

const compact = (iso: string) => iso.replaceAll("-", "");
const safeUid = (id: string) => id.replace(/[^A-Za-z0-9:_-]/g, "_");
/** A timed event is written as the calendar page shows it: "YYYY-MM-DDTHH:MM:SS", no zone, so it lands at the same wall-clock time. */
const compactTime = (local: string) => local.replaceAll("-", "").replaceAll(":", "").slice(0, 15);
/** The same thing on every date it repeats: "birthday:p1:2027-03-02" and "birthday:p1:2028-03-02" share "birthday:p1". */
const seriesOf = (id: string) => id.replace(/:\d{4}-\d{2}-\d{2}$/, "");

/**
 * The feed is what the Calendar page shows (buildEvents), for the next year: birthdays, anniversaries and yearly occasions
 * (each one yearly-repeating, plus "Start shopping" reminders), gift deadlines, Secret Santa dates and your own events
 * (yearly ones repeat). Events imported from other calendars are left out: they came from there. Surprise gifts planned
 * for the person whose feed this is are never in it, because buildEvents reads the ledger the way that person sees it.
 */
export function buildCalendar(db: Db, user: User, now = new Date()): string {
  const prefs = getPrefs(db, user.id);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const events = buildEvents(db, user, { from: today, to: addDays(today, 366) }, today).filter((e) => e.source !== "external");
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ribbon//Gift tracker//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(`Ribbon · ${householdRow(db, user.householdId)?.name ?? "Our household"}`)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    "X-PUBLISHED-TTL:PT12H",
  ];
  const vevent = (e: { uid: string; start: string; end: string; allDay: boolean; summary: string; description: string; yearly: boolean; busy?: boolean }) => {
    const parts = monthDay(e.start.slice(0, 10))!;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@${user.householdId}.ribbon`,
      `DTSTAMP:${stamp}`,
      e.allDay ? `DTSTART;VALUE=DATE:${compact(e.start)}` : `DTSTART:${compactTime(e.start)}`,
      e.allDay ? `DTEND;VALUE=DATE:${compact(e.end)}` : `DTEND:${compactTime(e.end)}`,
      ...(e.yearly ? [`RRULE:FREQ=YEARLY${parts.month === 2 && parts.day === 29 ? ";BYMONTH=2;BYMONTHDAY=29" : ""}`] : []),
      `SUMMARY:${escapeText(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
      `TRANSP:${e.busy ? "OPAQUE" : "TRANSPARENT"}`,
      "END:VEVENT",
    );
  };
  const describe = (event: CalEvent) => {
    const bits: string[] = [];
    if (event.turning) bits.push(event.source === "birthday" ? `Turning ${event.turning}` : `${event.turning} years`);
    if (event.note) bits.push(event.note);
    if (event.toBuy && event.toBuy.length > 0) bits.push(`Still to buy for: ${event.toBuy.map((t) => t.name).join(", ")}`);
    else if (event.covered) bits.push("Everything is bought");
    return bits.join("\n");
  };
  const seen = new Set<string>();
  for (const event of events) {
    const yearly = event.source === "birthday" || event.source === "anniversary" || event.source === "occasion" || (event.source === "manual" && event.yearly === true);
    const series = yearly ? seriesOf(event.id) : event.id;
    // A year and a day can hold the same date twice; a repeating event is written once, from its first date.
    if (seen.has(series)) continue;
    seen.add(series);
    const gift = event.source === "birthday" || event.source === "anniversary" || event.source === "occasion";
    const summary = gift ? `🎁 ${event.title}` : event.source === "gift" ? `🎁 ${event.title}` : event.source === "santa" ? `🎅 ${event.title}` : event.title;
    vevent({
      uid: safeUid(series),
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      summary,
      description: event.source === "manual" ? event.note ?? "" : describe(event),
      yearly,
      busy: event.source === "manual" && !event.allDay,
    });
    if (gift && prefs.remind_days > 0 && event.toBuy && event.toBuy.length > 0) {
      const label = event.title;
      vevent({
        uid: `shop-${safeUid(series)}`,
        start: addDays(event.start, -prefs.remind_days),
        end: addDays(event.start, 1 - prefs.remind_days),
        allDay: true,
        summary: `Start shopping: ${label}`,
        description: `${label} is in ${prefs.remind_days} days.\n${describe(event)}`,
        yearly: true,
      });
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export const calendarPublicHandler: PublicHandler = (c) => {
  if (c.resource !== "calendar" || c.method !== "GET" || !c.id?.endsWith(".ics") || c.rest.length > 0) return null;
  const user = userForToken(c.db, c.id.slice(0, -4));
  if (!user) return error(404, "No such calendar.");
  return new Response(buildCalendar(c.db, user), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="ribbon.ics"',
      "cache-control": "private, max-age=900",
    },
  });
};

export function calendarInfo(db: Db, userId: string) {
  const prefs = getPrefs(db, userId);
  return { token: prefs.calendar_token, remindDays: prefs.remind_days };
}

export const calendarHandler: Handler = async (c) => {
  if (c.resource !== "calendar") return null;
  const user = c.session.user;
  if (c.method === "GET" && c.id === undefined) return json(calendarInfo(c.db, user.id));
  if (c.method === "POST" && c.id === "token") {
    newToken(c.db, user.id);
    return json(calendarInfo(c.db, user.id));
  }
  if (c.method === "DELETE" && c.id === "token") {
    ensureRow(c.db, user.id);
    c.db.prepare("UPDATE user_prefs SET calendar_token = NULL WHERE user_id = ?").run(user.id);
    return json(calendarInfo(c.db, user.id));
  }
  if (c.method === "PATCH" && c.id === undefined) {
    const days = Number((c.body as { remindDays?: unknown } | null)?.remindDays);
    if (!Number.isInteger(days) || days < 0 || days > 90) return error(400, "Reminders go from 0 (off) to 90 days.");
    ensureRow(c.db, user.id);
    c.db.prepare("UPDATE user_prefs SET remind_days = ? WHERE user_id = ?").run(days, user.id);
    return json(calendarInfo(c.db, user.id));
  }
  return null;
};
