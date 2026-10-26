// Date helpers for the calendar views. Days are "YYYY-MM-DD" strings in the browser's own time zone.
import { addDays, daysBetween, todayLocal } from "@/lib/gifts/upcoming";
import type { CalEvent } from "./types";

export { addDays, daysBetween, todayLocal };

const pad = (n: number) => String(n).padStart(2, "0");
export const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromIso = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};
/** Monday of the week that holds `iso`. */
export const weekStart = (iso: string) => addDays(iso, -((fromIso(iso).getDay() + 6) % 7));
export const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
export function addMonths(iso: string, n: number) {
  const d = fromIso(monthStart(iso));
  d.setMonth(d.getMonth() + n);
  return toIso(d);
}

export type View = "day" | "week" | "month";

export function rangeOf(view: View, anchor: string): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") {
    const from = weekStart(anchor);
    return { from, to: addDays(from, 6) };
  }
  const from = weekStart(monthStart(anchor));
  return { from, to: addDays(from, 41) };
}

export function step(view: View, anchor: string, dir: 1 | -1): string {
  if (view === "day") return addDays(anchor, dir);
  if (view === "week") return addDays(anchor, 7 * dir);
  return addMonths(anchor, dir);
}

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => fromIso(d).toLocaleDateString(undefined, o);

export function rangeLabel(view: View, anchor: string): string {
  if (view === "day") return fmt(anchor, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  if (view === "month") return fmt(anchor, { month: "long", year: "numeric" });
  const { from, to } = rangeOf("week", anchor);
  const a = fromIso(from);
  const b = fromIso(to);
  const sameMonth = a.getMonth() === b.getMonth();
  const left = a.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const right = sameMonth ? String(b.getDate()) : b.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${left} – ${right}, ${b.getFullYear()}`;
}

export function titleOf(view: View, anchor: string, today: string): string {
  if (view === "day") return anchor === today ? "Today" : fmt(anchor, { weekday: "long" });
  if (view === "month") return monthStart(anchor) === monthStart(today) ? "This month" : fmt(anchor, { month: "long" });
  const week = weekStart(anchor);
  if (week === weekStart(today)) return "This week";
  if (week === weekStart(addDays(today, 7))) return "Next week";
  if (week === weekStart(addDays(today, -7))) return "Last week";
  return `Week of ${fmt(week, { month: "short", day: "numeric" })}`;
}

/** An instant for the event: "...Z" is absolute, anything else is the wall-clock time as written. */
export function parseWhen(value: string): Date {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) return new Date(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value)!;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
}

const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: d.getMinutes() ? "2-digit" : undefined }).replace(" ", "\u202f");

export function timeLabel(e: CalEvent): string {
  if (e.allDay) return "All day";
  const s = parseWhen(e.start);
  const end = parseWhen(e.end);
  return end > s ? `${clock(s)} – ${clock(end)}` : clock(s);
}

export function dateLabel(e: CalEvent): string {
  if (e.allDay) {
    const last = addDays(e.end, -1);
    const first = fmt(e.start, { weekday: "long", month: "long", day: "numeric" });
    return last > e.start ? `${first} – ${fmt(last, { month: "long", day: "numeric" })}` : first;
  }
  return parseWhen(e.start).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/** The days an event covers, clipped to [from, to]. */
export function daysOf(e: CalEvent, from: string, to: string): string[] {
  let first: string;
  let last: string;
  if (e.allDay) {
    first = e.start;
    last = addDays(e.end, -1);
    if (last < first) last = first;
  } else {
    const s = parseWhen(e.start);
    const end = parseWhen(e.end);
    first = toIso(s);
    // an event that ends exactly at midnight does not spill onto the next day
    const lastInstant = end > s ? new Date(end.getTime() - 1) : s;
    last = toIso(lastInstant);
  }
  const out: string[] = [];
  for (let d = first < from ? from : first; d <= (last > to ? to : last) && out.length < 45; d = addDays(d, 1)) out.push(d);
  return out;
}

export type Placed = { event: CalEvent; day: string; top: number; height: number; col: number; cols: number };

/** Timed events of one day as minutes from midnight, with side-by-side columns for overlaps. */
export function placeDay(day: string, events: CalEvent[]): Placed[] {
  const dayStart = fromIso(day).getTime();
  const rows = events
    .filter((e) => !e.allDay)
    .map((event) => {
      const s = parseWhen(event.start).getTime();
      const end = parseWhen(event.end).getTime();
      const a = Math.max(0, (s - dayStart) / 60000);
      const b = Math.min(24 * 60, Math.max(a + 30, (end - dayStart) / 60000));
      return { event, a, b };
    })
    .sort((x, y) => x.a - y.a || y.b - x.b);
  const out: Placed[] = [];
  let cluster: { event: CalEvent; a: number; b: number; col: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    for (const c of cluster) out.push({ event: c.event, day, top: c.a, height: c.b - c.a, col: c.col, cols });
    cluster = [];
  };
  for (const r of rows) {
    if (cluster.length && r.a >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.b > r.a).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col += 1;
    cluster.push({ ...r, col });
    clusterEnd = Math.max(clusterEnd, r.b);
  }
  flush();
  return out;
}

export function hourLabel(h: number): string {
  if (h === 0 || h === 24) return "12 AM";
  if (h === 12) return "Noon";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}
