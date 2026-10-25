import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Gift, Person } from "./model.ts";
import { addDays, daysBetween, nextYearly, upcoming } from "./upcoming.ts";

const person = (id: string, extra: Partial<Person> = {}): Person =>
  ({ id, name: `${id} Cole`, role: "x", circle: "household", relationship: "other", ...extra }) as Person;
const gift = (extra: Partial<Gift>): Gift => ({
  id: Math.random().toString(), direction: "given", title: "t", occasion: "Birthday", date: "2026-11-01",
  giverId: "me", receiverId: "a", amount: 10, status: "purchased", thanked: false, note: "", ...extra,
});

describe("upcoming", () => {
  test("date helpers", () => {
    assert.equal(daysBetween("2026-12-20", "2027-01-02"), 13);
    assert.equal(addDays("2026-02-27", 3), "2026-03-02");
    assert.equal(nextYearly(3, 14, "2026-03-14"), "2026-03-14");
    assert.equal(nextYearly(3, 14, "2026-03-15"), "2027-03-14");
    assert.equal(nextYearly(2, 29, "2026-01-10"), "2026-02-28");
    assert.equal(nextYearly(2, 29, "2027-12-10"), "2028-02-29");
  });

  test("birthdays, anniversaries and yearly occasions inside the window, soonest first", () => {
    const list = upcoming({
      today: "2026-11-20",
      people: [
        person("a", { birthday: "2016-12-02", anniversary: "2010-07-04" }),
        person("b", { birthday: "--01-10" }),
        person("c", { birthday: "--11-21" }),
      ],
      gifts: [],
      occasionDates: { Christmas: "12-25" },
    });
    assert.deepEqual(list.map((u) => [u.title, u.daysLeft]), [["c’s birthday", 1], ["a’s birthday", 12], ["Christmas", 35], ["b’s birthday", 51]]);
    assert.equal(list[1]!.turning, 10);
    assert.equal(list.find((u) => u.title === "Christmas")!.toBuy.length, 3);
  });

  test("what is still to buy: bought or given gifts count, ideas do not", () => {
    const people = [person("a"), person("b"), person("c")];
    const list = upcoming({
      today: "2026-12-01", people, occasionDates: { Christmas: "12-25" }, mePersonId: "c",
      gifts: [
        gift({ receiverId: "a", occasion: "Christmas", date: "2026-11-30", status: "purchased" }),
        gift({ receiverId: "b", occasion: "Christmas", date: "2026-11-30", status: "idea" }),
        gift({ receiverId: "b", occasion: "Christmas", date: "2025-12-25", status: "delivered" }), // last year doesn't count
      ],
    });
    const xmas = list[0]!;
    assert.equal(xmas.covered, 1);
    assert.deepEqual(xmas.toBuy.map((t) => [t.personId, t.hasIdea]), [["b", true]]);
  });

  test("your own birthday shows no shopping list; outside the window is dropped", () => {
    const list = upcoming({
      today: "2026-06-01", mePersonId: "a", days: 60, occasionDates: {}, gifts: [],
      people: [person("a", { birthday: "1990-06-10" }), person("b", { birthday: "1990-09-10" })],
    });
    assert.equal(list.length, 1);
    assert.equal(list[0]!.toBuy.length, 0);
  });
});
