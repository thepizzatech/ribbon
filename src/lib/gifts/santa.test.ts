import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { draw, isValidDraw, solvable } from "./santa.ts";

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const couple = (a: string, b: string): [string, string][] => [[a, b], [b, a]];

describe("secret santa draw", () => {
  test("nobody draws themselves, everyone gives and receives once (many random draws)", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const n = 3 + (seed % 9);
      const result = draw({ ids: ids(n), forbidden: [], random: seeded(seed) });
      assert.ok(result.ok);
      assert.ok(isValidDraw(ids(n), [], result.pairs), `seed ${seed}`);
    }
  });

  test("honours couple and previous-year exclusions", () => {
    const people = ids(8);
    const forbidden: [string, string][] = [...couple("p0", "p1"), ...couple("p2", "p3"), ["p4", "p5"], ["p5", "p6"], ["p6", "p7"], ["p7", "p4"]];
    for (let seed = 1; seed <= 300; seed += 1) {
      const result = draw({ ids: people, forbidden, random: seeded(seed) });
      assert.ok(result.ok);
      assert.ok(isValidDraw(people, forbidden, result.pairs), `seed ${seed}`);
      assert.notEqual(result.pairs.get("p0"), "p1");
      assert.notEqual(result.pairs.get("p3"), "p2");
    }
  });

  test("tight constraints still solve through the matching fallback", () => {
    // Each person may only give to exactly two others: a sparse graph random shuffles rarely hit
    const people = ids(12);
    const forbidden: [string, string][] = [];
    people.forEach((g, gi) => people.forEach((r, ri) => {
      if (g !== r && ri !== (gi + 1) % 12 && ri !== (gi + 5) % 12) forbidden.push([g, r]);
    }));
    for (let seed = 1; seed <= 40; seed += 1) {
      const result = draw({ ids: people, forbidden, random: seeded(seed) });
      assert.ok(result.ok, `seed ${seed}`);
      assert.ok(isValidDraw(people, forbidden, result.pairs));
    }
  });

  test("unsolvable cases are detected, with a reason", () => {
    assert.equal(solvable(["a", "b"], []).ok, false);
    assert.equal((draw({ ids: ["a", "b"], forbidden: [] }) as { reason: string }).reason, "too-few");
    // c can't draw anyone
    const stuck = draw({ ids: ["a", "b", "c"], forbidden: [["c", "a"], ["c", "b"]] });
    assert.ok(!stuck.ok);
    assert.equal(stuck.reason, "stuck");
    assert.deepEqual(stuck.stuckIds, ["c"]);
    // a and b may only give to c, so both would need c: no perfect matching though nobody is stuck
    const hall = draw({ ids: ["a", "b", "c", "d"], forbidden: [["a", "b"], ["a", "d"], ["b", "a"], ["b", "d"]] });
    assert.ok(!hall.ok);
    assert.equal(hall.reason, "unsolvable");
    // a full couple of 3 where everyone excludes everyone else
    assert.equal(draw({ ids: ids(3), forbidden: [...couple("p0", "p1"), ...couple("p1", "p2"), ...couple("p0", "p2")] }).ok, false);
  });

  test("a valid two-cycle-only draw exists for 3 people only as the 3-cycle", () => {
    const result = draw({ ids: ["a", "b", "c"], forbidden: [], random: seeded(7) });
    assert.ok(result.ok);
    const cycle = result.pairs.get(result.pairs.get("a")!);
    assert.notEqual(cycle, "a"); // with 3 people a derangement is always a single 3-cycle
  });
});
