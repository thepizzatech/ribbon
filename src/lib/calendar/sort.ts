// Ordering helpers for calendar events. The server returns events in the order people were added, not by date.
import type { CalEvent } from "./types";
import { parseWhen } from "./when.ts";

type Sortable = Pick<CalEvent, "start" | "title">;

/** Earliest start first (an all-day event counts as midnight), then by title so the order is stable. */
export function byStart(a: Sortable, b: Sortable): number {
  return parseWhen(a.start).getTime() - parseWhen(b.start).getTime() || a.title.localeCompare(b.title);
}

export function sortedByStart<T extends Sortable>(events: readonly T[]): T[] {
  return [...events].sort(byStart);
}
