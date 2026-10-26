import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { inDays, iso } from "./calendar-test-kit.ts";
import { call, freshDb, registerCleanup, secondHousehold, signedIn } from "./test-helpers.ts";
import type { Db } from "./db.ts";

registerCleanup();

type Ev = { id: string; source: string; title: string; start: string; end: string; allDay: boolean; personId: string | null; turning?: number; toBuy?: { personId: string }[]; canEdit?: boolean; shared?: boolean; manualId?: string; note?: string; tone: string };
const today = iso(new Date());
const events = async (db: Db, who: ReturnType<typeof signedIn>, from: string, to: string) => {
  const res = await call(db, "GET", `/api/calendar/events?from=${from}&to=${to}&today=${today}`, undefined, who);
  assert.equal(res.status, 200, res.text);
  return res.body.events as Ev[];
};
const family = (db: Db) => ({
  avery: signedIn(db, { username: "avery", personId: "p-avery" }),
  noah: signedIn(db, { username: "noah", role: "member", personId: "p-noah" }),
});

describe("calendar events from the ledger", () => {
  test("birthdays, anniversaries and occasions, for every year in the range", async () => {
    const db = freshDb();
    const { avery } = family(db);
    const evs = await events(db, avery, "2026-11-01", "2027-01-31");
    const by = (title: string) => evs.filter((e) => e.title === title);
    assert.equal(by("Jordan’s birthday").length, 1);
    assert.equal(by("Jordan’s birthday")[0]!.start, "2026-11-30");
    assert.equal(by("Jordan’s birthday")[0]!.turning, undefined, "year unknown: no 'turning'");
    assert.equal(by("Noah’s birthday")[0]!.turning, 10);
    assert.equal(by("Noah’s birthday")[0]!.end, "2026-12-03", "end is exclusive");
    assert.equal(by("Christmas")[0]!.start, "2026-12-25");
    assert.equal(by("Christmas")[0]!.source, "occasion");
    assert.equal(by("May’s birthday")[0]!.personId, "p-may");
    const twoYears = await events(db, avery, "2026-12-20", "2027-12-31");
    assert.equal(twoYears.filter((e) => e.title === "Christmas").length, 2);
    assert.equal(twoYears.filter((e) => e.title === "Jordan’s anniversary").length, 1);
    assert.equal(twoYears.find((e) => e.title === "Jordan’s anniversary")!.turning, 13);
  });

  test("Feb 29 birthdays land on Feb 28 in common years", async () => {
    const db = freshDb();
    const { avery } = family(db);
    await call(db, "PATCH", "/api/people/p-june", { birthday: "2016-02-29" }, avery);
    const evs = await events(db, avery, "2027-02-01", "2028-03-01");
    assert.deepEqual(evs.filter((e) => e.title === "June’s birthday").map((e) => e.start), ["2027-02-28", "2028-02-29"]);
  });

  test("'still to buy' follows the Overview rules and never lists the viewer", async () => {
    const db = freshDb();
    const { avery, noah } = family(db);
    const d = iso(inDays(5));
    const people = (await call(db, "GET", "/api/people", undefined, avery)).body.people as { id: string }[];
    await call(db, "PATCH", "/api/people/p-priya", { birthday: `1990-${d.slice(5)}` }, avery);
    const mine = (await events(db, avery, d, d)).find((e) => e.title === "Priya’s birthday")!;
    assert.deepEqual(mine.toBuy!.map((t) => t.personId), ["p-priya"]);
    const christmas = (await events(db, avery, "2026-12-25", "2026-12-25")).find((e) => e.title === "Christmas")!;
    assert.ok(christmas.toBuy!.length >= 1 && christmas.toBuy!.length <= people.length - 1, "at most everyone but yourself");
    assert.ok(!christmas.toBuy!.some((t) => t.personId === "p-avery"));
    const theirs = (await events(db, noah, "2026-12-25", "2026-12-25")).find((e) => e.title === "Christmas")!;
    assert.ok(theirs.toBuy!.some((t) => t.personId === "p-avery") && !theirs.toBuy!.some((t) => t.personId === "p-noah"));
  });

  test("gift deadlines appear for others but never for the person the gift is for", async () => {
    const db = freshDb();
    const { avery, noah } = family(db);
    const d = iso(inDays(6));
    const made = await call(db, "POST", "/api/gifts", { direction: "given", title: "Surprise watch", occasion: "Birthday", date: d, giverId: "p-noah", receiverId: "p-avery", status: "idea", amount: null, thanked: false, note: "" }, noah);
    assert.equal(made.status, 201, made.text);
    const forOthers = await events(db, noah, d, d);
    assert.ok(forOthers.some((e) => e.source === "gift" && e.title === "Surprise watch for Avery"));
    const forAvery = await events(db, avery, d, d);
    assert.ok(!forAvery.some((e) => e.source === "gift"), "no gift deadline for the person it's for");
    assert.ok(!JSON.stringify(forAvery).includes("Surprise watch"), "…and the title appears nowhere in their payload");
    const summary = (await call(db, "GET", `/api/calendar/summary?today=${today}`, undefined, avery)).body;
    assert.ok(!JSON.stringify(summary).includes("Surprise watch"));
    // delivered gifts are no longer deadlines
    const id = made.body.gift.id as string;
    await call(db, "PATCH", `/api/gifts/${id}`, { status: "delivered" }, noah);
    assert.ok(!(await events(db, noah, d, d)).some((e) => e.source === "gift"));
  });

  test("Secret Santa dates are shown only to people who can see the exchange", async () => {
    const db = freshDb();
    const { avery, noah } = family(db);
    const stranger = secondHousehold(db);
    const made = await call(db, "POST", "/api/exchanges", { name: "Family Santa", date: "2026-12-20" }, avery);
    await call(db, "PUT", `/api/exchanges/${made.body.exchange.id}/participants`, { personIds: ["p-avery", "p-jordan", "p-noah"] }, avery);
    for (const who of [avery, noah]) assert.ok((await events(db, who, "2026-12-20", "2026-12-20")).some((e) => e.source === "santa" && e.title === "Family Santa"));
    assert.deepEqual((await events(db, stranger, "2026-12-20", "2026-12-20")).filter((e) => e.source === "santa"), []);
    const text = JSON.stringify(await events(db, avery, "2026-12-20", "2026-12-20"));
    assert.ok(!text.includes("receiver"), "no draw details leak through the calendar");
  });

  test("a household never sees another household's people or occasions", async () => {
    const db = freshDb();
    const { avery } = family(db);
    const other = secondHousehold(db);
    const evs = await events(db, other, "2026-01-01", "2026-04-01");
    assert.ok(!JSON.stringify(evs).includes("Avery"));
    assert.deepEqual(evs.filter((e) => e.source === "birthday" || e.source === "manual"), []);
    assert.ok((await events(db, avery, "2026-03-10", "2026-03-20")).some((e) => e.title === "Avery’s birthday"));
  });

  test("range validation", async () => {
    const db = freshDb();
    const { avery } = family(db);
    for (const q of ["", `from=2026-01-01&to=2026-01-05`, `from=nope&to=2026-01-05&today=${today}`, `from=2026-02-30&to=2026-03-05&today=${today}`, `from=2026-01-05&to=2026-01-01&today=${today}`, `from=2026-01-01&to=2028-01-01&today=${today}`, `from=1800-01-01&to=1800-01-05&today=${today}`]) {
      assert.equal((await call(db, "GET", `/api/calendar/events?${q}`, undefined, avery)).status, 400, q);
    }
    assert.equal((await call(db, "GET", "/api/calendar/summary", undefined, avery)).status, 400);
  });
});

describe("manual events", () => {
  const D = iso(inDays(4));
  test("create all-day and timed events; yearly ones repeat; validation", async () => {
    const db = freshDb();
    const { avery } = family(db);
    const a = await call(db, "POST", "/api/calendar/manual", { title: "  Parent–teacher  night ", date: D, allDay: false, startTime: "18:30", endTime: "19:15", personId: "p-noah", notes: "Room 12" }, avery);
    assert.equal(a.status, 201, a.text);
    assert.equal(a.body.event.title, "Parent–teacher night");
    const evs = await events(db, avery, D, D);
    const ev = evs.find((e) => e.source === "manual")!;
    assert.equal(ev.start, `${D}T18:30:00`);
    assert.equal(ev.end, `${D}T19:15:00`);
    assert.equal(ev.allDay, false);
    assert.equal(ev.personId, "p-noah");
    assert.equal(ev.canEdit, true);

    const y = await call(db, "POST", "/api/calendar/manual", { title: "Adoption day", date: "2020-06-10", yearly: true }, avery);
    assert.equal(y.status, 201);
    const yearly = (await events(db, avery, "2026-06-01", "2027-06-30")).filter((e) => e.title === "Adoption day").map((e) => e.start);
    assert.deepEqual(yearly, ["2026-06-10", "2027-06-10"]);
    assert.deepEqual((await events(db, avery, "2019-06-01", "2019-06-30")).filter((e) => e.title === "Adoption day"), [], "not before it began");

    for (const bad of [{}, { title: "x" }, { title: "x", date: "2026-13-01" }, { title: "", date: D }, { title: "x", date: D, allDay: false }, { title: "x", date: D, allDay: false, startTime: "25:00" }, { title: "x", date: D, allDay: false, startTime: "10:00", endTime: "09:00" }, { title: "x", date: D, personId: "nobody" }]) {
      assert.equal((await call(db, "POST", "/api/calendar/manual", bad, avery)).status, 400, JSON.stringify(bad));
    }
  });

  test("private by default; shared ones are visible to the household only, and read-only for other members", async () => {
    const db = freshDb();
    const { avery, noah } = family(db);
    const other = secondHousehold(db);
    const priv = (await call(db, "POST", "/api/calendar/manual", { title: "Private idea", date: D }, avery)).body.event.id as string;
    const shared = (await call(db, "POST", "/api/calendar/manual", { title: "Family dinner", date: D, shared: true }, avery)).body.event.id as string;
    assert.deepEqual((await events(db, noah, D, D)).filter((e) => e.source === "manual").map((e) => e.title), ["Family dinner"]);
    assert.deepEqual(await events(db, other, D, D).then((l) => l.filter((e) => e.source === "manual")), []);
    // someone else's private event looks like it doesn't exist
    assert.equal((await call(db, "PATCH", `/api/calendar/manual/${priv}`, { title: "hacked" }, noah)).status, 404);
    assert.equal((await call(db, "DELETE", `/api/calendar/manual/${priv}`, undefined, noah)).status, 404);
    // a shared one can be seen but a plain member can't change it; the author can
    const view = (await events(db, noah, D, D)).find((e) => e.manualId === shared)!;
    assert.equal(view.canEdit, false);
    assert.equal((await call(db, "PATCH", `/api/calendar/manual/${shared}`, { title: "hacked" }, noah)).status, 403);
    assert.equal((await call(db, "DELETE", `/api/calendar/manual/${shared}`, undefined, noah)).status, 403);
    assert.equal((await call(db, "PATCH", `/api/calendar/manual/${shared}`, { title: "Family dinner at 7" }, avery)).status, 200);
    // another household can't touch either
    for (const id of [priv, shared]) {
      assert.equal((await call(db, "PATCH", `/api/calendar/manual/${id}`, { title: "x" }, other)).status, 404);
      assert.equal((await call(db, "DELETE", `/api/calendar/manual/${id}`, undefined, other)).status, 404);
    }
    assert.equal((await call(db, "DELETE", `/api/calendar/manual/${priv}`, undefined, avery)).status, 200);
    assert.equal((await call(db, "DELETE", `/api/calendar/manual/${priv}`, undefined, avery)).status, 404);
  });

  test("an owner may remove a shared event; a member can't turn someone else's event private/public", async () => {
    const db = freshDb();
    const { avery, noah } = family(db);
    const jordan = signedIn(db, { username: "jordan", role: "owner", personId: "p-jordan" });
    const shared = (await call(db, "POST", "/api/calendar/manual", { title: "Shared plan", date: D, shared: true }, noah)).body.event.id as string;
    void avery;
    assert.equal((await call(db, "PATCH", `/api/calendar/manual/${shared}`, { shared: false, title: "Edited by owner" }, jordan)).status, 200);
    const still = (await events(db, jordan, D, D)).find((e) => e.manualId === shared)!;
    assert.equal(still.shared, true, "only the author decides who it is shared with");
    assert.equal(still.title, "Edited by owner");
    assert.equal((await call(db, "DELETE", `/api/calendar/manual/${shared}`, undefined, jordan)).status, 200);
  });

  test("a shared event about you is hidden from you (surprise safe), but the author still sees it", async () => {
    const db = freshDb();
    const { avery, noah } = family(db);
    const id = (await call(db, "POST", "/api/calendar/manual", { title: "Collect Avery's ring", date: D, personId: "p-avery", shared: true }, noah)).body.event.id as string;
    assert.ok(!(await events(db, avery, D, D)).some((e) => e.manualId === id), "Avery doesn't see plans about Avery");
    assert.ok((await events(db, noah, D, D)).some((e) => e.manualId === id));
    const jordan = signedIn(db, { username: "jordan", role: "member", personId: "p-jordan" });
    assert.ok((await events(db, jordan, D, D)).some((e) => e.manualId === id), "everyone else in the household does");
    assert.ok(!JSON.stringify(await call(db, "GET", `/api/calendar/summary?today=${today}`, undefined, avery)).includes("ring"));
  });

  test("a person from another household can't be attached, and a patch is validated as a whole", async () => {
    const db = freshDb();
    const { avery } = family(db);
    const other = secondHousehold(db);
    const theirs = (db.prepare("SELECT id FROM people WHERE household_id = ? LIMIT 1").get(other.hid) as { id: string }).id;
    assert.equal((await call(db, "POST", "/api/calendar/manual", { title: "x", date: D, personId: theirs }, avery)).status, 400);
    const id = (await call(db, "POST", "/api/calendar/manual", { title: "x", date: D, allDay: false, startTime: "10:00" }, avery)).body.event.id as string;
    assert.equal((await call(db, "PATCH", `/api/calendar/manual/${id}`, { personId: theirs }, avery)).status, 400);
    assert.equal((await call(db, "PATCH", `/api/calendar/manual/${id}`, { endTime: "09:00" }, avery)).status, 400);
    const toAllDay = await call(db, "PATCH", `/api/calendar/manual/${id}`, { allDay: true }, avery);
    assert.equal(toAllDay.body.event.startTime, null);
    assert.equal((await call(db, "PATCH", `/api/calendar/manual/%E0%A4%A`, {}, avery)).status, 400, "broken encoding is a 400, not a crash");
  });

  test("a person can only keep a bounded number of events", async () => {
    const db = freshDb();
    const { avery } = family(db);
    const insert = db.prepare("INSERT INTO manual_events (id, household_id, user_id, title, date, created_at) VALUES (?, ?, ?, 'x', '2026-01-01', 'now')");
    for (let i = 0; i < 500; i += 1) insert.run(`m${i}`, avery.householdId, avery.id);
    assert.equal((await call(db, "POST", "/api/calendar/manual", { title: "one too many", date: D }, avery)).status, 409);
  });
});

describe("summary", () => {
  test("KPI numbers for the week and the next 30 days", async () => {
    const db = freshDb();
    const { avery } = family(db);
    const s = (await call(db, "GET", `/api/calendar/summary?today=2026-11-25`, undefined, avery)).body;
    assert.equal(s.week.from, "2026-11-23");
    assert.equal(s.week.to, "2026-11-29");
    assert.equal(s.birthdaysIn30, 3, "Jordan Nov 30, Noah Dec 2, May Dec 18");
    assert.ok(s.giftsNeeded > 0, "Christmas is inside 30 days and nothing is bought");
    assert.ok(s.comingUp.some((e: { title: string }) => e.title === "Christmas"));
    assert.equal(s.comingUp[0].daysLeft, 5);
    assert.equal(s.eventsThisWeek, 0);
    const wk = (await call(db, "GET", `/api/calendar/summary?today=2026-11-30`, undefined, avery)).body;
    assert.equal(wk.eventsThisWeek, 2, "Jordan Nov 30 and Noah Dec 2");
    assert.deepEqual(wk.todayTones, ["pink"]);
  });
});
