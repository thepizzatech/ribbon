import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { byStart, sortedByStart } from "./sort.ts";
import { parseWhen } from "./when.ts";

const ev = (title: string, start: string, allDay = true) => ({ title, start, allDay });

describe("sortedByStart", () => {
  test("puts the soonest first, whatever order the server sent", () => {
    // the order the app showed: Nov 30, Dec 2, then Oct 28 three times
    const input = [ev("Jordan", "2026-11-30"), ev("Mina", "2026-12-02"), ev("Avery", "2026-10-28"), ev("Blake", "2026-10-28"), ev("Cam", "2026-10-27")];
    assert.deepEqual(sortedByStart(input).map((e) => e.title), ["Cam", "Avery", "Blake", "Jordan", "Mina"]);
  });
  test("does not change its input", () => {
    const input = [ev("b", "2026-11-02"), ev("a", "2026-11-01")];
    sortedByStart(input);
    assert.equal(input[0]!.title, "b");
  });
  test("an all-day event comes before a timed one the same day", () => {
    const list = sortedByStart([ev("Lunch", "2026-10-28T12:00:00", false), ev("Birthday", "2026-10-28")]);
    assert.deepEqual(list.map((e) => e.title), ["Birthday", "Lunch"]);
  });
  test("compares absolute and wall-clock times as instants", () => {
    const a = ev("utc", "2026-10-28T20:00:00Z", false);
    const b = ev("local", "2026-10-28T00:30:00", false);
    assert.equal(Math.sign(byStart(a, b)), Math.sign(parseWhen(a.start).getTime() - parseWhen(b.start).getTime()));
  });
  test("ties are ordered by title", () => {
    assert.ok(byStart(ev("A", "2026-10-28"), ev("B", "2026-10-28")) < 0);
  });
});
