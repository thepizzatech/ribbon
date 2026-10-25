import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { breakdown, delta, giftStatus, needsYou, yearTotals } from "./insights.ts";
import { normalizeRelationship, SEED_GIFTS, SEED_PEOPLE, relationshipLabel, type Gift } from "./model.ts";

const base: Gift = {
  id: "x", direction: "given", title: "T", occasion: "Birthday", date: "2026-03-01",
  giverId: "p-avery", receiverId: "p-noah", amount: null, status: "idea", thanked: false, note: "",
};
const gift = (patch: Partial<Gift>): Gift => ({ ...base, ...patch });

describe("insights", () => {
  test("status words", () => {
    assert.equal(giftStatus(gift({ status: "idea" })), "idea");
    assert.equal(giftStatus(gift({ status: "purchased" })), "bought");
    assert.equal(giftStatus(gift({ status: "delivered" })), "given");
    assert.equal(giftStatus(gift({ direction: "received", status: "delivered" })), "received");
    assert.equal(giftStatus(gift({ direction: "received", status: "delivered", thanked: true })), "thanked");
  });

  test("needs-you groups and counts", () => {
    const list = [
      gift({ id: "a", direction: "received", status: "delivered" }),
      gift({ id: "b", status: "idea" }),
      gift({ id: "c", status: "purchased" }),
      gift({ id: "d", status: "delivered" }),
    ];
    const needs = needsYou(list);
    assert.deepEqual([needs.thanks.length, needs.toGive.length, needs.bought.length, needs.count], [1, 1, 1, 3]);
  });

  test("year totals only count that year; money is what you gave", () => {
    const list = [
      gift({ amount: 20, status: "delivered" }),
      gift({ amount: 5, status: "delivered", date: "2025-01-01" }),
      gift({ direction: "received", status: "delivered", thanked: true }),
      gift({ direction: "received", status: "delivered" }),
    ];
    const totals = yearTotals(list, 2026);
    assert.deepEqual([totals.given, totals.received, totals.spent, totals.thankRate], [1, 2, 20, 50]);
    assert.equal(yearTotals([], 2026).thankRate, null);
  });

  test("delta needs something to compare against", () => {
    assert.equal(delta(5, 0), null);
    assert.deepEqual(delta(5, 5), { dir: "flat", label: "same" });
    assert.deepEqual(delta(7, 5), { dir: "up", label: "2" });
    assert.deepEqual(delta(3, 5), { dir: "down", label: "2" });
  });

  test("breakdown folds the tail into Other and falls back to counts without amounts", () => {
    const list = ["A", "B", "C", "D"].map((occasion, i) => gift({ id: String(i), occasion, amount: 10 - i }));
    const out = breakdown(list, SEED_PEOPLE, 2026, "occasion", 3);
    assert.equal(out.unit, "usd");
    assert.deepEqual(out.rows.map((r) => r.label), ["A", "B", "Other"]);
    assert.equal(out.total, 10 + 9 + 8 + 7);
    const counts = breakdown([gift({}), gift({ id: "y" })], SEED_PEOPLE, 2026, "person");
    assert.deepEqual([counts.unit, counts.rows[0]?.label, counts.rows[0]?.value], ["count", "Noah Cole", 2]);
  });
});

describe("relationships", () => {
  test("keys, labels, and guessing from old role text", () => {
    assert.equal(normalizeRelationship("wife", ""), "wife");
    assert.equal(normalizeRelationship(undefined, "Mom"), "mother");
    assert.equal(normalizeRelationship("nonsense", "Grandpa"), "grandfather");
    assert.equal(normalizeRelationship(undefined, "Coworker"), "other");
    assert.equal(relationshipLabel("aunt"), "Aunt");
    assert.equal(relationshipLabel("zzz"), "Other");
  });

  test("seed data is self-consistent", () => {
    const ids = new Set(SEED_PEOPLE.map((p) => p.id));
    for (const g of SEED_GIFTS) assert.ok(ids.has(g.giverId) && ids.has(g.receiverId), g.id);
  });
});
