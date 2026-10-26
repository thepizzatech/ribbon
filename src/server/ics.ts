// iCalendar (.ics) -> plain event rows. Uses node-ical (Apache-2.0) for parsing and recurrence expansion
// (RRULE, EXDATE, RECURRENCE-ID overrides, time zones). Everything that comes out is plain text with control
// characters removed: the UI renders it as text and never as HTML.
import ical from "node-ical";

export const WINDOW_PAST_DAYS = 60;
export const WINDOW_FUTURE_DAYS = 420;
export const MAX_SERIES = 3000; // distinct events (UIDs) read from one calendar
export const MAX_ROWS = 20_000; // expanded occurrences kept per connection

export type EventRow = {
  uid: string;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  /** all day: "YYYY-MM-DD"; timed: "...Z" (UTC) or "YYYY-MM-DDTHH:MM:SS" (floating, shown as written) */
  starts: string;
  /** all day: exclusive "YYYY-MM-DD" */
  ends: string;
  suggest: "birthday" | "anniversary" | null;
  suggestName: string | null;
  /** "YYYY-MM-DD" (year known) or "--MM-DD" */
  suggestDate: string | null;
};

export type ParseOutcome = { name: string | null; events: EventRow[]; truncated: boolean; failedSeries: number };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/** Text safe to store and show: no control or bidi-override characters, bounded length. */
export function cleanText(value: unknown, max: number): string {
  let text = "";
  if (typeof value === "string") text = value;
  else if (value && typeof value === "object" && "val" in value && typeof (value as { val: unknown }).val === "string") text = (value as { val: string }).val;
  return text.replace(/\r\n?/g, "\n").replace(CONTROL, "").trim().slice(0, max);
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localStamp = (d: Date) => `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const plusDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
};

// ---- birthday and anniversary detection ----

const NAME = String.raw`([^\n]{1,80}?)`;
const POSSESSIVE = String.raw`['’‘`+"´"+String.raw`]s?`;
const BIRTHDAY_PATTERNS: RegExp[] = [
  new RegExp(String.raw`^\W*${NAME}${POSSESSIVE}\s+(?:\d+(?:st|nd|rd|th)\s+)?(?:birthday|b-?day)\b`, "iu"),
  new RegExp(String.raw`^\W*(?:birthday|b-?day)(?:\s+of)?\s*[:\-–—]\s*${NAME}\s*$`, "iu"),
  new RegExp(String.raw`^\W*(?:birthday|b-?day)\s+of\s+${NAME}\s*$`, "iu"),
  new RegExp(String.raw`^\W*${NAME}\s+(?:\d+(?:st|nd|rd|th)\s+)?(?:birthday|b-?day)\s*$`, "iu"),
  /^\W*🎂\s*([^\n]{1,80}?)\s*$/u,
];
const ANNIVERSARY_PATTERNS: RegExp[] = [
  new RegExp(String.raw`^\W*${NAME}${POSSESSIVE}\s+(?:\d+(?:st|nd|rd|th)\s+)?(?:wedding\s+)?anniversary\b`, "iu"),
  new RegExp(String.raw`^\W*(?:wedding\s+)?anniversary(?:\s+of)?\s*[:\-–—]\s*${NAME}\s*$`, "iu"),
  new RegExp(String.raw`^\W*${NAME}\s+(?:\d+(?:st|nd|rd|th)\s+)?(?:wedding\s+)?anniversary\s*$`, "iu"),
];

function tidyName(raw: string): string {
  return raw.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").replace(/^[\s"'“”]+|[\s"'“”]+$/g, "").slice(0, 80);
}

/** "Mom's birthday" -> { kind: "birthday", name: "Mom" }; null when the title is not birthday-like. */
export function detectSpecial(title: string): { kind: "birthday" | "anniversary"; name: string } | null {
  for (const [kind, patterns] of [["birthday", BIRTHDAY_PATTERNS], ["anniversary", ANNIVERSARY_PATTERNS]] as const) {
    for (const pattern of patterns) {
      const m = pattern.exec(title);
      const name = m?.[1] ? tidyName(m[1]) : "";
      if (name && !/^(a|the|my|our|your|his|her|their)$/i.test(name)) return { kind, name };
    }
  }
  return null;
}

/** A birthday event's date as a person field: the year only when the calendar is a "Birthdays" one and the year is plausible. */
function specialDate(day: string, birthdaysCalendar: boolean): string {
  const year = Number(day.slice(0, 4));
  return birthdaysCalendar && year >= 1900 && year <= new Date().getFullYear() ? day : `--${day.slice(5)}`;
}

const SLOW = /FREQ=(SECONDLY|MINUTELY|HOURLY)/i;

type Instance = ReturnType<typeof ical.expandRecurringEvent>[number];
type VEventLike = Instance["event"];

/** Parse iCalendar text into events inside [now - 60 days, now + 420 days]. Never throws; a damaged feed yields fewer events. */
export function parseIcs(text: string, now = new Date()): ParseOutcome {
  let data: Record<string, unknown>;
  let failedParts = 0;
  try {
    data = ical.parseICS(text) as unknown as Record<string, unknown>;
  } catch {
    // One bad event (say RRULE with INTERVAL=0) makes the library give up on the whole file.
    // Try again event by event, with the calendar header and time zones, and skip the ones that fail.
    const header = /^BEGIN:VCALENDAR[\s\S]*?(?=BEGIN:(?:VEVENT|VTIMEZONE))/i.exec(text)?.[0] ?? "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n";
    const zones = (text.match(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE/gi) ?? []).join("\r\n");
    data = {};
    for (const block of (text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi) ?? []).slice(0, MAX_SERIES)) {
      try {
        const one = ical.parseICS(`${header}${zones}\r\n${block}\r\nEND:VCALENDAR\r\n`) as unknown as Record<string, unknown>;
        for (const [key, value] of Object.entries(one)) data[data[key] === undefined ? key : `${key}#${Object.keys(data).length}`] = value;
      } catch {
        failedParts += 1;
      }
    }
  }
  const vcal = data.vcalendar as Record<string, unknown> | undefined;
  const calName = cleanText(vcal?.["WR-CALNAME"] ?? vcal?.["x-wr-calname"], 80) || null;
  const birthdaysCalendar = Boolean(calName && /\bbirthdays?\b/i.test(calName));
  const from = new Date(now.getTime() - WINDOW_PAST_DAYS * 86_400_000);
  const to = new Date(now.getTime() + WINDOW_FUTURE_DAYS * 86_400_000);
  const events: EventRow[] = [];
  let truncated = false;
  let failedSeries = failedParts;
  let series = 0;

  for (const component of Object.values(data)) {
    const base = component as VEventLike | undefined;
    if (!base || (base as { type?: string }).type !== "VEVENT" || !base.start) continue;
    series += 1;
    if (series > MAX_SERIES) {
      truncated = true;
      break;
    }
    if (String(base.status ?? "").toUpperCase() === "CANCELLED") continue;
    const rule = base.rrule as { toString?: () => string } | undefined;
    const slow = rule?.toString ? SLOW.test(String(rule.toString())) : false;
    let instances: Instance[];
    try {
      instances = slow
        ? []
        : ical.expandRecurringEvent(base, { from, to, expandOngoing: true });
    } catch {
      failedSeries += 1;
      continue;
    }
    const uid = cleanText(base.uid, 200) || cleanText(base.summary, 60) || "event";
    for (const instance of instances) {
      const ev = instance.event ?? base;
      if (String(ev.status ?? "").toUpperCase() === "CANCELLED") continue;
      const title = cleanText(ev.summary ?? instance.summary, 200) || "(No title)";
      let starts: string;
      let ends: string;
      const allDay = instance.isFullDay === true;
      const start = instance.start;
      if (!(start instanceof Date) || Number.isNaN(start.getTime())) continue;
      const end = instance.end instanceof Date && !Number.isNaN(instance.end.getTime()) ? instance.end : start;
      if (allDay) {
        starts = localDay(start);
        ends = localDay(end);
        if (ends <= starts) ends = plusDay(starts);
      } else {
        const floating = (start as Date & { tz?: string }).tz === undefined;
        starts = floating ? localStamp(start) : start.toISOString();
        ends = floating ? localStamp(end) : end.toISOString();
        if (ends < starts) ends = starts;
      }
      let suggest: EventRow["suggest"] = null;
      let suggestName: string | null = null;
      let suggestDate: string | null = null;
      if (allDay) {
        const found = detectSpecial(title) ?? (birthdaysCalendar ? { kind: "birthday" as const, name: tidyName(title.replace(/['’]s\s+birthday.*$/i, "")) } : null);
        if (found?.name) {
          suggest = found.kind;
          suggestName = found.name;
          // The master's own date is the birth (or wedding) date; an instance would only carry this year's.
          const origin = base.start instanceof Date ? localDay(base.start) : starts;
          suggestDate = specialDate(origin, birthdaysCalendar);
        }
      }
      events.push({
        uid,
        title,
        description: cleanText(ev.description, 2000),
        location: cleanText(ev.location, 200),
        allDay,
        starts,
        ends,
        suggest,
        suggestName,
        suggestDate,
      });
      if (events.length >= MAX_ROWS) {
        truncated = true;
        return { name: calName, events, truncated, failedSeries };
      }
    }
  }
  return { name: calName, events, truncated, failedSeries };
}
