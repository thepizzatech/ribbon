// "What's coming up": birthdays, anniversaries and yearly occasions, with what is still to buy.
// Pure and shared: the Overview card, the calendar feed and the tests all use this.
import type { Gift, Person } from "./model.ts";

export type UpcomingKind = "birthday" | "anniversary" | "occasion";

export type Upcoming = {
  key: string;
  kind: UpcomingKind;
  title: string;
  /** Next time it happens, YYYY-MM-DD. */
  date: string;
  daysLeft: number;
  /** The gift occasion this lines up with (Birthday, Anniversary, or the occasion's name). */
  occasion: string;
  personId?: string;
  /** Turning N (when the birth or wedding year is known). */
  turning?: number;
  /** People with nothing bought yet (ideas count as "to buy"). */
  toBuy: { personId: string; name: string; hasIdea: boolean }[];
  /** How many on the list are already bought or given. */
  covered: number;
};

const pad = (n: number) => String(n).padStart(2, "0");

export function isoDay(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function todayLocal(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

export function daysBetween(fromIso: string, toIso: string): number {
  return dayNumber(toIso) - dayNumber(fromIso);
}

export function addDays(iso: string, days: number): string {
  return isoDay(new Date((dayNumber(iso) + days) * 86_400_000));
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The next time a yearly month/day lands on or after `today`. Feb 29 becomes Feb 28 in common years. */
export function nextYearly(month: number, day: number, today: string): string {
  const year = Number(today.slice(0, 4));
  const at = (y: number) => `${y}-${pad(month)}-${pad(month === 2 && day === 29 && !isLeap(y) ? 28 : day)}`;
  const candidate = at(year);
  return candidate >= today ? candidate : at(year + 1);
}

/** Month/day parts of "YYYY-MM-DD", "--MM-DD" or "MM-DD". */
export function monthDay(value: string): { month: number; day: number; year: number | null } | null {
  const m = /^(?:(\d{4})-|--)?(\d{2})-(\d{2})$/.exec(value);
  return m ? { year: m[1] ? Number(m[1]) : null, month: Number(m[2]), day: Number(m[3]) } : null;
}

export type UpcomingInput = {
  people: Person[];
  gifts: Gift[];
  occasionDates: Record<string, string>;
  /** The viewer's own person: they are never shown a "to buy" list for themselves. */
  mePersonId?: string | null;
  today?: string;
  days?: number;
};

export function upcoming(input: UpcomingInput): Upcoming[] {
  const today = input.today ?? todayLocal();
  const horizon = input.days ?? 60;
  const shoppable = input.people.filter((person) => person.id !== input.mePersonId);
  const given = input.gifts.filter((gift) => gift.direction === "given");
  const out: Upcoming[] = [];

  const status = (personId: string, occasion: string, year: string) => {
    const matching = given.filter((gift) => gift.receiverId === personId && gift.occasion === occasion && gift.date.startsWith(year));
    if (matching.some((gift) => gift.status !== "idea")) return "covered" as const;
    return matching.length > 0 ? ("idea" as const) : ("none" as const);
  };

  const push = (item: Omit<Upcoming, "daysLeft" | "toBuy" | "covered">, who: Person[]) => {
    const daysLeft = daysBetween(today, item.date);
    if (daysLeft < 0 || daysLeft > horizon) return;
    const toBuy: Upcoming["toBuy"] = [];
    let covered = 0;
    for (const person of who) {
      const s = status(person.id, item.occasion, item.date.slice(0, 4));
      if (s === "covered") covered += 1;
      else toBuy.push({ personId: person.id, name: person.name, hasIdea: s === "idea" });
    }
    out.push({ ...item, daysLeft, toBuy, covered });
  };

  for (const person of input.people) {
    for (const [field, kind, occasion, label] of [
      ["birthday", "birthday", "Birthday", "birthday"],
      ["anniversary", "anniversary", "Anniversary", "anniversary"],
    ] as const) {
      const parts = person[field] ? monthDay(person[field]!) : null;
      if (!parts) continue;
      const date = nextYearly(parts.month, parts.day, today);
      push(
        {
          key: `${kind}:${person.id}`,
          kind,
          title: `${person.name.split(" ")[0]}’s ${label}`,
          date,
          occasion,
          personId: person.id,
          turning: parts.year ? Number(date.slice(0, 4)) - parts.year : undefined,
        },
        // Nobody buys their own birthday present, and an anniversary is for the couple
        person.id === input.mePersonId ? [] : [person],
      );
    }
  }
  for (const [name, value] of Object.entries(input.occasionDates)) {
    const parts = monthDay(value);
    if (!parts) continue;
    push({ key: `occasion:${name}`, kind: "occasion", title: name, date: nextYearly(parts.month, parts.day, today), occasion: name }, shoppable);
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.title.localeCompare(b.title));
}

export function daysLabel(daysLeft: number): string {
  if (daysLeft === 0) return "Today";
  if (daysLeft === 1) return "Tomorrow";
  return `In ${daysLeft} days`;
}

/** "Dec 2" or "Dec 2, 2016" from "YYYY-MM-DD" / "--MM-DD". */
export function formatMonthDay(value: string): string {
  const parts = monthDay(value);
  if (!parts) return value;
  const date = new Date(parts.year ?? 2000, parts.month - 1, parts.day);
  return date.toLocaleDateString(undefined, parts.year ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
}
