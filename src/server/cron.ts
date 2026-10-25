// A tiny five-field cron matcher: "m h dom mon dow", with *, lists, ranges and steps.
type Field = Set<number>;

function parseField(text: string, min: number, max: number): Field | null {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) return null;
    let from = min;
    let to = max;
    if (m[1] !== "*") {
      const [a, b] = m[1]!.split("-");
      from = Number(a);
      to = b === undefined ? (m[2] ? max : from) : Number(b);
    }
    if (from < min || to > max || from > to) return null;
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out.size ? out : null;
}

export type Cron = { minute: Field; hour: Field; dom: Field; month: Field; dow: Field; domAny: boolean; dowAny: boolean };

/** null if the expression isn't valid. */
export function parseCron(expression: string): Cron | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = parseField(parts[0]!, 0, 59);
  const hour = parseField(parts[1]!, 0, 23);
  const dom = parseField(parts[2]!, 1, 31);
  const month = parseField(parts[3]!, 1, 12);
  const dow = parseField(parts[4]!.replace(/\b7\b/g, "0"), 0, 6);
  if (!minute || !hour || !dom || !month || !dow) return null;
  return { minute, hour, dom, month, dow, domAny: parts[2]!.startsWith("*"), dowAny: parts[4]!.startsWith("*") };
}

export function cronMatches(cron: Cron, at: Date): boolean {
  if (!cron.minute.has(at.getMinutes()) || !cron.hour.has(at.getHours()) || !cron.month.has(at.getMonth() + 1)) return false;
  const domOk = cron.dom.has(at.getDate());
  const dowOk = cron.dow.has(at.getDay());
  // Like classic cron: if both day fields are restricted, either may match.
  if (!cron.domAny && !cron.dowAny) return domOk || dowOk;
  return domOk && dowOk;
}

/** The next minute (after `from`) the schedule fires, within a year, or null. */
export function nextRun(cron: Cron, from: Date): Date | null {
  const t = new Date(from);
  t.setSeconds(0, 0);
  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    t.setMinutes(t.getMinutes() + 1);
    if (cronMatches(cron, t)) return new Date(t);
  }
  return null;
}
