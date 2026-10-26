// Sample calendar events for DEVELOPMENT sample-data mode only (SEED_SAMPLE_DATA=true). They go through the
// real import pipeline (an ICS file -> parseIcs -> replaceEvents), so the sample behaves like a real import.
// A real install never calls this: it starts with no calendars at all.
import type { Db } from "./db.ts";
import { parseIcs } from "./ics.ts";
import { insertConnection, markSynced, replaceEvents, type Color } from "./calendar-store.ts";

const p2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;

type Item = { title: string; day: number; at?: [number, number]; hours?: number; repeat?: string; place?: string };

function toIcs(items: Item[], monday: Date): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ribbon//sample//EN"];
  items.forEach((it, i) => {
    const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + it.day);
    const rule = it.repeat ? [`RRULE:${it.repeat}`] : [];
    lines.push("BEGIN:VEVENT", `UID:sample-${i}@ribbon.local`, `SUMMARY:${it.title}`);
    if (it.place) lines.push(`LOCATION:${it.place}`);
    if (it.at) {
      const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), it.at[0] + (it.hours ?? 1), it.at[1]);
      lines.push(`DTSTART:${ymd(day)}T${p2(it.at[0])}${p2(it.at[1])}00`, `DTEND:${ymd(end)}T${p2(end.getHours())}${p2(end.getMinutes())}00`);
    } else {
      const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${ymd(day)}`, `DTEND;VALUE=DATE:${ymd(next)}`);
    }
    lines.push(...rule, "END:VEVENT");
  });
  lines.push("END:VCALENDAR", "");
  return lines.join("\r\n");
}

const SAMPLE: { name: string; color: Color; items: Item[] }[] = [
  {
    name: "Family",
    color: "purple",
    items: [
      { title: "Piano lesson", day: 0, at: [9, 0], repeat: "FREQ=WEEKLY;BYDAY=MO", place: "Maple Music" },
      { title: "Soccer practice", day: 1, at: [17, 30], repeat: "FREQ=WEEKLY;BYDAY=TU,TH", place: "Riverside field" },
      { title: "Parent–teacher night", day: 2, at: [18, 0], hours: 2 },
      { title: "Farmers market", day: 5, at: [10, 0], hours: 2, repeat: "FREQ=WEEKLY;BYDAY=SA" },
      { title: "Brunch at May’s", day: 6, at: [11, 0], hours: 2, place: "May’s place" },
    ],
  },
  {
    name: "School",
    color: "red",
    items: [
      { title: "School assembly", day: 3, at: [8, 30] },
      { title: "Science fair setup", day: 4, at: [15, 0] },
      { title: "Picture day", day: 8 },
    ],
  },
  {
    name: "Work",
    color: "blue",
    items: [
      { title: "Team sync", day: 0, at: [11, 0], repeat: "FREQ=WEEKLY;BYDAY=MO" },
      { title: "Design review", day: 2, at: [14, 0] },
      { title: "Dentist", day: 2, at: [14, 30] },
      { title: "1:1", day: 3, at: [13, 0] },
      { title: "Team offsite", day: 4 },
    ],
  },
];

export function seedSampleCalendars(db: Db, user: { id: string; householdId: string }, now = new Date()): number {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  let total = 0;
  for (const cal of SAMPLE) {
    const row = insertConnection(db, { userId: user.id, householdId: user.householdId, kind: "ics_file", name: cal.name, color: cal.color, shared: cal.name === "Family", source: { sample: true }, state: {}, syncHours: null });
    const parsed = parseIcs(toIcs(cal.items, monday), now);
    replaceEvents(db, row.id, parsed.events);
    markSynced(db, row.id);
    total += parsed.events.length;
  }
  return total;
}
