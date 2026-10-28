// The text and value rules behind DateField, kept free of React so they can be tested on their own.
//
// A field holds one of three kinds of value:
//   "date"          "YYYY-MM-DD"                          gift date, event date, Secret Santa date
//   "optional-year" "YYYY-MM-DD" or "--MM-DD"             birthday, anniversary ("--MM-DD" when the year isn't known)
//   "month-day"     "MM-DD"                               an occasion's yearly date
// and "" for nothing picked. These are the shapes the server stores (see cleanMonthDay / cleanOccasionDate in model.ts).

export type DateMode = "date" | "optional-year" | "month-day";
export type Parsed = { ok: true; value: string } | { ok: false };

/** Month/day pairs without a year are drawn in a leap year, so 02-29 is always a real day. */
export const LEAP_YEAR = 2000;
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2200;

const pad = (n: number) => String(n).padStart(2, "0");
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysIn = (month: number, year: number) =>
  [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;

const realDay = (year: number, month: number, day: number) =>
  month >= 1 && month <= 12 && day >= 1 && day <= daysIn(month, year);
const yearOk = (year: number) => year >= MIN_YEAR && year <= MAX_YEAR;

/** Read what someone typed. "" is fine (nothing picked); 2016-12-02, 12/2/2016, 12-02 and 12/02 are read as written below. */
export function parseDateText(text: string, mode: DateMode): Parsed {
  const t = text.trim();
  if (!t) return { ok: true, value: "" };
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t); // 12/2/2016 is month first, like the CSV import
  const short = /^(?:--)?(\d{1,2})[-/](\d{1,2})$/.exec(t); // 12-02, 12/2 and the stored --12-02
  if (iso || us) {
    if (mode === "month-day") return { ok: false };
    const [y, m, d] = (iso ? [iso[1], iso[2], iso[3]] : [us![3], us![1], us![2]]).map(Number) as [
      number,
      number,
      number,
    ];
    if (!yearOk(y) || !realDay(y, m, d)) return { ok: false };
    return { ok: true, value: `${y}-${pad(m)}-${pad(d)}` };
  }
  if (short) {
    if (mode === "date") return { ok: false };
    const [m, d] = [Number(short[1]), Number(short[2])] as [number, number];
    if (!realDay(LEAP_YEAR, m, d)) return { ok: false };
    return {
      ok: true,
      value: mode === "month-day" ? `${pad(m)}-${pad(d)}` : `--${pad(m)}-${pad(d)}`,
    };
  }
  return { ok: false };
}

type Parts = { year: number | null; month: number; day: number };

/** Split a stored value into its parts, or null for "" and anything that isn't a real day. */
export function partsOf(value: string): Parts | null {
  const m = /^(?:(\d{4})-|--)?(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = m[1] ? Number(m[1]) : null;
  const [month, day] = [Number(m[2]), Number(m[3])] as [number, number];
  return realDay(year ?? LEAP_YEAR, month, day) ? { year, month, day } : null;
}

/** What the text box shows: "2016-12-02", or "12-02" when there's no year. */
export function formatDateText(value: string): string {
  const p = partsOf(value);
  if (!p) return value;
  return `${p.year ? `${p.year}-` : ""}${pad(p.month)}-${pad(p.day)}`;
}

/** A readable form for the calendar button's label: "Dec 2, 2016" or "Dec 2". */
export function describeDate(value: string): string {
  const p = partsOf(value);
  if (!p) return "";
  const date = new Date(p.year ?? LEAP_YEAR, p.month - 1, p.day);
  return date.toLocaleDateString(
    undefined,
    p.year
      ? { month: "short", day: "numeric", year: "numeric" }
      : { month: "short", day: "numeric" },
  );
}

/** True when the value is a month and day with no year. */
export const yearIsUnknown = (value: string) =>
  value.startsWith("--") || /^\d{2}-\d{2}$/.test(value);

/** The calendar date for a value (a missing year is drawn in a leap year), or undefined for "". */
export function valueToPickerDate(value: string): Date | undefined {
  const p = partsOf(value);
  return p ? new Date(p.year ?? LEAP_YEAR, p.month - 1, p.day) : undefined;
}

/** The value for a day picked on the calendar. `yearKnown` is false for a birthday whose year isn't known. */
export function pickerDateToValue(date: Date, mode: DateMode, yearKnown: boolean): string {
  const md = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (mode === "month-day") return md;
  if (mode === "optional-year" && !yearKnown) return `--${md}`;
  return `${date.getFullYear()}-${md}`;
}

/** Switch a birthday between "year known" and "year unknown", keeping the month and day. */
export function setYearKnown(value: string, known: boolean, yearToUse: number): string {
  const p = partsOf(value);
  if (!p) return "";
  if (!known) return `--${pad(p.month)}-${pad(p.day)}`;
  if (p.year) return value;
  // Feb 29 needs a leap year: step back to the nearest one.
  let year = yearToUse;
  while (!realDay(year, p.month, p.day)) year -= 1;
  return `${year}-${pad(p.month)}-${pad(p.day)}`;
}

export const HELP: Record<DateMode, string> = {
  date: "Use a date like 2026-12-02.",
  "optional-year": "Use 2016-12-02, or 12-02 if you don’t know the year.",
  "month-day": "Use month and day, like 12-25.",
};

/** Years offered in the picker's year list, widened to include the current value. */
export function yearRange(
  mode: DateMode,
  value: string,
  thisYear: number,
  minYear?: number,
  maxYear?: number,
): { from: number; to: number } {
  let from = minYear ?? (mode === "optional-year" ? 1900 : 1970);
  let to = maxYear ?? (mode === "optional-year" ? thisYear + 1 : thisYear + 10);
  const year = partsOf(value)?.year;
  if (year) {
    from = Math.min(from, year);
    to = Math.max(to, year);
  }
  return { from: Math.max(from, MIN_YEAR), to: Math.min(to, MAX_YEAR) };
}
