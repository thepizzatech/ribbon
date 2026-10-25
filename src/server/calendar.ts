// Calendar feed (.ics) with a secret per-user link, plus the settings behind it.
import { randomBytes } from "node:crypto";
import type { Db } from "./db.ts";
import { error, json, type Handler, type PublicHandler } from "./http.ts";
import { getLedger } from "./ledger.ts";
import { addDays, monthDay, upcoming, type Upcoming } from "../lib/gifts/upcoming.ts";
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

const escapeText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

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

export function buildCalendar(db: Db, user: User, now = new Date()): string {
  const ctx = { db, hid: user.householdId, me: user.personId };
  const ledger = getLedger(ctx);
  const prefs = getPrefs(db, user.id);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const events = upcoming({
    people: ledger.people,
    gifts: ledger.gifts,
    occasionDates: ledger.occasionDates,
    mePersonId: user.personId,
    today,
    days: 366,
  });
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ribbon//Gift tracker//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(`Ribbon · ${ledger.householdName}`)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    "X-PUBLISHED-TTL:PT12H",
  ];
  const vevent = (uid: string, date: string, summary: string, description: string, yearly: boolean) => {
    const parts = monthDay(date)!;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}@${user.householdId}.ribbon`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(date, 1))}`,
      ...(yearly ? [`RRULE:FREQ=YEARLY${parts.month === 2 && parts.day === 29 ? ";BYMONTH=2;BYMONTHDAY=29" : ""}`] : []),
      `SUMMARY:${escapeText(summary)}`,
      ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  };
  const describe = (event: Upcoming) => {
    const bits: string[] = [];
    if (event.turning) bits.push(event.kind === "birthday" ? `Turning ${event.turning}` : `${event.turning} years`);
    if (event.toBuy.length > 0) bits.push(`Still to buy for: ${event.toBuy.map((t) => t.name).join(", ")}`);
    else if (event.covered > 0) bits.push("Everything is bought");
    return bits.join("\n");
  };
  for (const event of events) {
    const label = event.kind === "occasion" ? event.title : event.title;
    vevent(event.key.replace(/[^A-Za-z0-9:_-]/g, "_"), event.date, `🎁 ${label}`, describe(event), true);
    if (prefs.remind_days > 0 && event.toBuy.length > 0) {
      vevent(`shop-${event.key.replace(/[^A-Za-z0-9:_-]/g, "_")}`, addDays(event.date, -prefs.remind_days), `Start shopping: ${label}`, `${label} is in ${prefs.remind_days} days.\n${describe(event)}`, true);
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
