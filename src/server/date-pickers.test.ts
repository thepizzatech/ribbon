// What the date pickers save has to show up: on the Calendar page, in the .ics feed, and be refused when it isn't a real day.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { inDays, iso } from "./calendar-test-kit.ts";
import { call, freshDb, registerCleanup, signedIn } from "./test-helpers.ts";
import type { Db } from "./db.ts";

registerCleanup();

type Ev = { id: string; source: string; title: string; start: string; end: string; turning?: number };
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
const feed = async (db: Db, who: ReturnType<typeof signedIn>) => {
  const token = (await call(db, "POST", "/api/calendar/token", {}, who)).body.token as string;
  const res = await call(db, "GET", `/api/calendar/${token}.ics`);
  assert.equal(res.status, 200);
  return res.text;
};
/** One VEVENT as text, found by something in its SUMMARY. Folded lines are joined first. */
const vevent = (text: string, summary: string) => {
  const flat = text.replace(/\r\n /g, "");
  return flat.split("BEGIN:VEVENT").slice(1).map((b) => b.split("END:VEVENT")[0]!).find((b) => b.includes(`SUMMARY:${summary}`));
};
const gift = (over: object) => ({ direction: "given", title: "Lego set", occasion: "Birthday", date: iso(inDays(6)), giverId: "p-avery", receiverId: "p-jordan", status: "idea", amount: null, thanked: false, note: "", ...over });

describe("dates from the pickers show on the calendar", () => {
  test("a new person's birthday with a year and one without both appear, with the age only when the year is known", async () => {
    const db = freshDb();
    const { avery } = family(db);
    const a = await call(db, "POST", "/api/people", { name: "Ada Lovelace", role: "Friend", circle: "outside", relationship: "friend", birthday: "2016-12-02" }, avery);
    const b = await call(db, "POST", "/api/people", { name: "Ben Hur", role: "Friend", circle: "outside", relationship: "friend", birthday: "--12-02", anniversary: "--06-15" }, avery);
    assert.equal(a.status, 201, a.text);
    assert.equal(b.status, 201, b.text);
    const evs = await events(db, avery, "2026-12-01", "2026-12-03");
    const ada = evs.find((e) => e.title === "Ada’s birthday")!;
    const ben = evs.find((e) => e.title === "Ben’s birthday")!;
    assert.equal(ada.start, "2026-12-02");
    assert.equal(ada.turning, 10);
    assert.equal(ben.start, "2026-12-02");
    assert.equal(ben.turning, undefined);
    assert.equal((await events(db, avery, "2027-06-14", "2027-06-16")).find((e) => e.title === "Ben’s anniversary")?.start, "2027-06-15");
  });

  test("editing a birthday moves it on the calendar at once, and clearing it takes it off", async () => {
    const db = freshDb();
    const { avery } = family(db);
    await call(db, "PATCH", "/api/people/p-noah", { birthday: "2016-12-02" }, avery);
    assert.ok((await events(db, avery, "2026-12-02", "2026-12-02")).some((e) => e.title === "Noah’s birthday"));
    await call(db, "PATCH", "/api/people/p-noah", { birthday: "--12-09" }, avery);
    assert.ok(!(await events(db, avery, "2026-12-02", "2026-12-02")).some((e) => e.title === "Noah’s birthday"));
    assert.ok((await events(db, avery, "2026-12-09", "2026-12-09")).some((e) => e.title === "Noah’s birthday"));
    await call(db, "PATCH", "/api/people/p-noah", { birthday: "" }, avery);
    assert.ok(!(await events(db, avery, "2026-12-01", "2026-12-31")).some((e) => e.title === "Noah’s birthday"));
  });

  test("an occasion's yearly date and a gift deadline appear, and the picker's 02-29 is kept", async () => {
    const db = freshDb();
    const { avery } = family(db);
    assert.equal((await call(db, "POST", "/api/occasions", { name: "Diwali" }, avery)).status, 201);
    assert.equal((await call(db, "PATCH", "/api/occasions/Diwali", { date: "11-08" }, avery)).status, 200);
    assert.ok((await events(db, avery, "2026-11-08", "2026-11-08")).some((e) => e.source === "occasion" && e.title === "Diwali"));
    assert.equal((await call(db, "PATCH", "/api/occasions/Diwali", { date: "02-29" }, avery)).status, 200);
    assert.deepEqual((await events(db, avery, "2027-02-01", "2028-03-01")).filter((e) => e.title === "Diwali").map((e) => e.start), ["2027-02-28", "2028-02-29"]);
    const d = iso(inDays(9));
    const made = await call(db, "POST", "/api/gifts", gift({ date: d }), avery);
    assert.equal(made.status, 201, made.text);
    assert.ok((await events(db, avery, d, d)).some((e) => e.source === "gift" && e.title === "Lego set for Jordan" && e.start === d));
  });

  test("a Secret Santa date appears on the calendar", async () => {
    const db = freshDb();
    const { avery } = family(db);
    const made = await call(db, "POST", "/api/exchanges", { name: "Office Santa", date: "2026-12-18" }, avery);
    assert.equal(made.status, 201, made.text);
    assert.ok((await events(db, avery, "2026-12-18", "2026-12-18")).some((e) => e.source === "santa" && e.title === "Office Santa"));
  });
});

describe("dates that aren't real are refused", () => {
  test("a gift date has to be a real day when it is set or changed, but an old odd one can still be edited", async () => {
    const db = freshDb();
    const { avery } = family(db);
    for (const date of ["2026-13-45", "2026-02-30", "12/02/2026", "", "tomorrow", "1800-01-01"]) {
      const res = await call(db, "POST", "/api/gifts", gift({ date }), avery);
      assert.equal(res.status, 400, `${date}: ${res.text}`);
      assert.match(res.body.error, /real date/);
    }
    const ok = await call(db, "POST", "/api/gifts", gift({ date: "2026-12-02" }), avery);
    assert.equal(ok.status, 201);
    const id = ok.body.gift.id as string;
    assert.equal((await call(db, "PATCH", `/api/gifts/${id}`, { date: "2026-13-45" }, avery)).status, 400);
    assert.equal((await call(db, "PATCH", `/api/gifts/${id}`, { date: "2026-12-05" }, avery)).body.gift.date, "2026-12-05");
    // A date an older version let through: the gift can still be changed, as long as its date is left alone.
    db.prepare("UPDATE gifts SET date = ? WHERE id = ?").run("2026-02-30", id);
    const edited = await call(db, "PATCH", `/api/gifts/${id}`, { date: "2026-02-30", status: "purchased" }, avery);
    assert.equal(edited.status, 200, edited.text);
    assert.equal(edited.body.gift.status, "purchased");
    assert.ok(!JSON.stringify(await events(db, avery, "2026-02-01", "2026-03-31")).includes("Lego set"), "an unreadable date is simply not drawn");
  });

  test("a Secret Santa date has to be a real day", async () => {
    const db = freshDb();
    const { avery } = family(db);
    for (const date of ["2026-13-45", "2026-02-30", "soon", ""]) assert.equal((await call(db, "POST", "/api/exchanges", { name: "Bad", date }, avery)).status, 400, date);
    const made = await call(db, "POST", "/api/exchanges", { name: "Good", date: "2026-12-18" }, avery);
    assert.equal((await call(db, "PATCH", `/api/exchanges/${made.body.exchange.id}`, { date: "2026-13-45" }, avery)).status, 400);
    assert.equal((await call(db, "PATCH", `/api/exchanges/${made.body.exchange.id}`, { date: "2026-12-19" }, avery)).body.exchange.date, "2026-12-19");
  });

  test("restoring a backup or importing a ledger keeps working with dates an older version allowed", async () => {
    const db = freshDb();
    const { avery } = family(db);
    const exported = (await call(db, "GET", "/api/export", undefined, avery)).body;
    assert.ok(exported?.gifts, "export is readable");
    exported.gifts[0].date = "2026-02-30";
    const res = await call(db, "POST", "/api/import", exported, avery);
    assert.ok(res.status === 200 || res.status === 201, res.text);
  });
});

describe("the .ics feed has everything the calendar has", () => {
  test("your own yearly event repeats, a one-off doesn't, and a timed one keeps its clock time", async () => {
    const db = freshDb();
    const { avery } = family(db);
    const d = iso(inDays(12));
    await call(db, "POST", "/api/calendar/manual", { title: "Mom’s garden day", date: d, allDay: true, yearly: true, notes: "Bring gloves" }, avery);
    await call(db, "POST", "/api/calendar/manual", { title: "Piano recital", date: d, allDay: false, startTime: "18:30", endTime: "19:15" }, avery);
    const text = await feed(db, avery);
    const yearly = vevent(text, "Mom’s garden day")!;
    assert.ok(yearly, "the yearly event is in the feed");
    assert.match(yearly, new RegExp(`DTSTART;VALUE=DATE:${d.replaceAll("-", "")}`));
    assert.match(yearly, /RRULE:FREQ=YEARLY/);
    assert.match(yearly, /DESCRIPTION:Bring gloves/);
    const timed = vevent(text, "Piano recital")!;
    assert.match(timed, new RegExp(`DTSTART:${d.replaceAll("-", "")}T183000`));
    assert.match(timed, new RegExp(`DTEND:${d.replaceAll("-", "")}T191500`));
    assert.doesNotMatch(timed, /RRULE/);
  });

  test("a Secret Santa date and a gift deadline are in it", async () => {
    const db = freshDb();
    const { avery } = family(db);
    await call(db, "POST", "/api/exchanges", { name: "Family Santa", date: "2026-12-20" }, avery);
    const d = iso(inDays(7));
    await call(db, "POST", "/api/gifts", gift({ date: d, status: "purchased" }), avery);
    const text = await feed(db, avery);
    const santa = vevent(text, "🎅 Family Santa")!;
    assert.match(santa, /DTSTART;VALUE=DATE:20261220/);
    assert.match(santa, /DTEND;VALUE=DATE:20261221/);
    assert.doesNotMatch(santa, /RRULE/);
    const deadline = vevent(text, "🎁 Lego set for Jordan")!;
    assert.match(deadline, new RegExp(`DTSTART;VALUE=DATE:${d.replaceAll("-", "")}`));
    assert.match(deadline, /DESCRIPTION:Bought\\, not given yet/);
    // once it has been given, the deadline is gone
    const id = (await call(db, "GET", "/api/gifts", undefined, avery)).body.gifts.find((g: { title: string }) => g.title === "Lego set").id as string;
    await call(db, "PATCH", `/api/gifts/${id}`, { status: "delivered" }, avery);
    assert.equal(vevent(await feed(db, avery), "🎁 Lego set for Jordan"), undefined);
  });

  test("a new person's birthday is in the feed, yearly, and each repeating event is written once", async () => {
    const db = freshDb();
    const { avery } = family(db);
    // today's month and day: it comes round today and again in a year, which the feed's one-year window both covers
    const md = today.slice(5);
    await call(db, "POST", "/api/people", { name: "Ada Lovelace", role: "Friend", circle: "outside", relationship: "friend", birthday: `2016-${md}` }, avery);
    const text = await feed(db, avery);
    const matches = text.replace(/\r\n /g, "").split("SUMMARY:").filter((p) => p.startsWith("🎁 Ada’s birthday"));
    assert.equal(matches.length, 1);
    assert.match(vevent(text, "🎁 Ada’s birthday")!, /RRULE:FREQ=YEARLY/);
    assert.match(vevent(text, "🎁 Ada’s birthday")!, /Turning \d+/);
  });

  test("surprises planned for the feed's owner stay out of it, and other households' and imported events never appear", async () => {
    const db = freshDb();
    const { avery, noah } = family(db);
    const d = iso(inDays(8));
    await call(db, "POST", "/api/gifts", gift({ title: "Secret telescope", date: d, giverId: "p-avery", receiverId: "p-noah", status: "purchased" }), avery);
    await call(db, "POST", "/api/gifts", gift({ title: "Open puzzle", date: d, giverId: "p-avery", receiverId: "p-jordan", status: "purchased" }), avery);
    await call(db, "POST", "/api/calendar/manual", { title: "Private to Noah", date: d, allDay: true }, noah);
    const forNoah = await feed(db, noah);
    assert.ok(!forNoah.includes("telescope"), "no surprise for the person it's for");
    assert.ok(forNoah.includes("Open puzzle"), "other gifts are there");
    assert.ok(forNoah.includes("Private to Noah"));
    const forAvery = await feed(db, avery);
    assert.ok(forAvery.includes("telescope"), "the giver sees it");
    assert.ok(!forAvery.includes("Private to Noah"), "someone else's private event isn't in your feed");
  });

  test("it is valid iCalendar: lines fold at 75 bytes and every VEVENT has a UID and a start", async () => {
    const db = freshDb();
    const { avery } = family(db);
    await call(db, "POST", "/api/calendar/manual", { title: "Ü".repeat(110), date: iso(inDays(3)), allDay: true, notes: "line one\nline two; with, punctuation", yearly: true }, avery);
    const text = await feed(db, avery);
    for (const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
    const blocks = text.replace(/\r\n /g, "").split("BEGIN:VEVENT").slice(1);
    assert.ok(blocks.length > 3);
    for (const b of blocks) assert.ok(/UID:\S+@\S+\.ribbon/.test(b) && /DTSTART[;:]/.test(b), b);
    const uids = blocks.map((b) => /UID:(\S+)/.exec(b)![1]);
    assert.equal(new Set(uids).size, uids.length, "UIDs are unique");
  });
});
