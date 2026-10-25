// Numbers behind the Overview: what needs attention, breakdowns, and one-line patterns.
import { formatDate, formatMoney, personName, type Gift, type Person } from "./model.ts";

export type StatusKey = "idea" | "bought" | "given" | "received" | "thanked";

export const STATUS_LABEL: Record<StatusKey, string> = {
  idea: "Idea",
  bought: "Bought",
  given: "Given",
  received: "Received",
  thanked: "Thanked",
};

/** One word for where a gift stands. Received gifts are "Thanked" once the thank-you is sent. */
export function giftStatus(gift: Gift): StatusKey {
  if (gift.direction === "received") return gift.thanked ? "thanked" : "received";
  if (gift.status === "idea") return "idea";
  if (gift.status === "purchased") return "bought";
  return "given";
}

export function needsYou(gifts: Gift[], _people: Person[] = []) {
  const thanks = gifts
    .filter((gift) => gift.direction === "received" && !gift.thanked)
    .sort((a, b) => a.date.localeCompare(b.date));
  const toGive = gifts
    .filter((gift) => gift.direction === "given" && gift.status === "idea")
    .sort((a, b) => a.date.localeCompare(b.date));
  const bought = gifts
    .filter((gift) => gift.direction === "given" && gift.status === "purchased")
    .sort((a, b) => a.date.localeCompare(b.date));
  return { thanks, toGive, bought, count: thanks.length + toGive.length + bought.length };
}

export function yearTotals(gifts: Gift[], year: number) {
  const prefix = `${year}-`;
  let received = 0;
  let given = 0;
  let spent = 0;
  let thanked = 0;
  for (const gift of gifts) {
    if (!gift.date.startsWith(prefix)) continue;
    if (gift.direction === "received") {
      received += 1;
      if (gift.thanked) thanked += 1;
    } else {
      given += 1;
      spent += gift.amount ?? 0;
    }
  }
  return {
    received,
    given,
    total: received + given,
    spent,
    thanked,
    thankRate: received === 0 ? null : Math.round((thanked / received) * 100),
  };
}

export type Delta = { dir: "up" | "down" | "flat"; label: string };

/** Compare to last year. Returns null when there is nothing to compare against. */
export function delta(current: number, previous: number, format: (n: number) => string = String): Delta | null {
  if (previous === 0) return null;
  const diff = current - previous;
  if (diff === 0) return { dir: "flat", label: "same" };
  return { dir: diff > 0 ? "up" : "down", label: format(Math.abs(diff)) };
}

export type BreakdownRow = { label: string; value: number; count: number };
export type Breakdown = { unit: "usd" | "count"; rows: BreakdownRow[]; total: number };

/** Gifts given in a year, grouped by occasion or by who received them. Biggest first, the tail folded into "Other". */
export function breakdown(
  gifts: Gift[],
  people: Person[],
  year: number,
  by: "occasion" | "person",
  limit = 5,
): Breakdown {
  const given = gifts.filter((gift) => gift.direction === "given" && gift.date.startsWith(`${year}-`));
  const hasAmounts = given.some((gift) => (gift.amount ?? 0) > 0);
  const map = new Map<string, BreakdownRow>();
  for (const gift of given) {
    const label = by === "occasion" ? gift.occasion || "Other" : personName(people, gift.receiverId);
    const row = map.get(label) ?? { label, value: 0, count: 0 };
    row.count += 1;
    row.value += hasAmounts ? (gift.amount ?? 0) : 1;
    map.set(label, row);
  }
  const sorted = [...map.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  let rows = sorted;
  if (sorted.length > limit) {
    const rest = sorted.slice(limit - 1);
    rows = [
      ...sorted.slice(0, limit - 1),
      {
        label: "Other",
        value: rest.reduce((sum, row) => sum + row.value, 0),
        count: rest.reduce((sum, row) => sum + row.count, 0),
      },
    ];
  }
  return { unit: hasAmounts ? "usd" : "count", rows, total: rows.reduce((sum, row) => sum + row.value, 0) };
}

export type Insight = {
  key: string;
  big: string;
  unit: string;
  headline: string;
  detail: string;
  question: string;
};

/** Up to three one-line patterns, computed from the ledger itself (no model call). */
export function computeInsights(gifts: Gift[], people: Person[], year: number): Insight[] {
  const out: Insight[] = [];
  const needs = needsYou(gifts, people);

  const oldest = needs.thanks[0];
  if (oldest) {
    out.push({
      key: "thanks",
      big: String(needs.thanks.length),
      unit: needs.thanks.length === 1 ? "thank-you owed" : "thank-yous owed",
      headline: "Notes still to write",
      detail: `Oldest is the ${oldest.title.toLowerCase()} from ${personName(people, oldest.giverId)}, ${formatDate(oldest.date)}.`,
      question: "Who still needs a thank-you, and for which gifts?",
    });
  }

  const byOccasion = breakdown(gifts, people, year, "occasion", 20);
  const top = byOccasion.rows[0];
  if (top && byOccasion.total > 0 && byOccasion.rows.length > 1) {
    const pct = Math.round((top.value / byOccasion.total) * 100);
    const amount = byOccasion.unit === "usd" ? formatMoney(top.value) : `${top.count} gifts`;
    out.push({
      key: "occasion",
      big: `${pct}%`,
      unit: `of ${year} giving`,
      headline: `${top.label} is where it goes`,
      detail: `${amount} of what you gave in ${year} was for ${top.label}.`,
      question: `Summarize our ${top.label} gifts in ${year}: who got what, and amounts when known.`,
    });
  }

  const unfinished = needs.toGive.length + needs.bought.length;
  if (unfinished > 0) {
    const next = [...needs.toGive, ...needs.bought].sort((a, b) => a.date.localeCompare(b.date))[0];
    out.push({
      key: "unfinished",
      big: String(unfinished),
      unit: unfinished === 1 ? "gift to finish" : "gifts to finish",
      headline: "Still on the list",
      detail: next
        ? `Next up: ${next.title.toLowerCase()} for ${personName(people, next.receiverId)}, ${formatDate(next.date)}.`
        : "Ideas and bought gifts that have not changed hands yet.",
      question: "Which gifts are still ideas or purchased and not delivered? Group them by person.",
    });
  }

  if (out.length < 3) {
    const totals = yearTotals(gifts, year);
    if (totals.total > 0) {
      out.push({
        key: "balance",
        big: `${totals.received}:${totals.given}`,
        unit: "received to given",
        headline: totals.given >= totals.received ? "You give more than you get" : "More came in than went out",
        detail: `${totals.received} gifts received and ${totals.given} given in ${year}.`,
        question: `Summarize gifts given and received in ${year}. Mention occasions and amounts when they are known.`,
      });
    }
  }

  return out.slice(0, 3);
}

/** Every gift a person gave or got, grouped by occasion (counts). */
export function personOccasions(gifts: Gift[], personId: string, limit = 6): Breakdown {
  const map = new Map<string, BreakdownRow>();
  for (const gift of gifts) {
    if (gift.giverId !== personId && gift.receiverId !== personId) continue;
    const label = gift.occasion || "Other";
    const row = map.get(label) ?? { label, value: 0, count: 0 };
    row.value += 1;
    row.count += 1;
    map.set(label, row);
  }
  const sorted = [...map.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  let rows = sorted;
  if (sorted.length > limit) {
    const rest = sorted.slice(limit - 1);
    rows = [
      ...sorted.slice(0, limit - 1),
      { label: "Other", value: rest.reduce((s, r) => s + r.value, 0), count: rest.reduce((s, r) => s + r.count, 0) },
    ];
  }
  return { unit: "count", rows, total: rows.reduce((sum, row) => sum + row.value, 0) };
}
