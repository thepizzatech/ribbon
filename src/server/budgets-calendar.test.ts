import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { call, freshDb, registerCleanup, signedIn } from "./test-helpers.ts";

registerCleanup();

describe("budgets", () => {
  test("set, update, clear and copy a year; validation", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const put = (body: object) => call(db, "PUT", "/api/budgets", body, me);
    assert.equal((await put({ scope: "person", key: "p-noah", year: 2026, amount: 150 })).body.budgets.length, 1);
    assert.equal((await put({ scope: "occasion", key: "Christmas", year: 2026, amount: 600.456 })).body.budgets.find((b: { key: string }) => b.key === "Christmas").amount, 600.46);
    assert.equal((await put({ scope: "person", key: "p-noah", year: 2026, amount: 200 })).body.budgets.find((b: { key: string }) => b.key === "p-noah").amount, 200);
    assert.equal((await put({ scope: "person", key: "nobody", year: 2026, amount: 1 })).status, 404);
    assert.equal((await put({ scope: "occasion", key: "Nope", year: 2026, amount: 1 })).status, 404);
    assert.equal((await put({ scope: "person", key: "p-noah", year: 2026, amount: -5 })).status, 400);
    assert.equal((await put({ scope: "wat", key: "x", year: 2026, amount: 5 })).status, 400);
    assert.equal((await put({ scope: "person", key: "p-noah", year: 1900, amount: 5 })).status, 400);
    const copied = await call(db, "POST", "/api/budgets/copy", { from: 2026, to: 2027 }, me);
    assert.equal(copied.body.budgets.length, 2);
    assert.equal((await call(db, "GET", "/api/budgets?year=2026", undefined, me)).body.budgets.length, 2);
    await put({ scope: "person", key: "p-noah", year: 2026, amount: null });
    assert.equal((await call(db, "GET", "/api/budgets?year=2026", undefined, me)).body.budgets.length, 1);
  });

  test("your own budget is hidden from you and can't be set by you", async () => {
    const db = freshDb();
    const avery = signedIn(db, { username: "avery", personId: "p-avery" });
    const noah = signedIn(db, { username: "noah", role: "member", personId: "p-noah" });
    await call(db, "PUT", "/api/budgets", { scope: "person", key: "p-noah", year: 2026, amount: 300 }, avery);
    assert.equal((await call(db, "GET", "/api/budgets?year=2026", undefined, noah)).body.budgets.length, 0);
    assert.equal((await call(db, "PUT", "/api/budgets", { scope: "person", key: "p-noah", year: 2026, amount: 1 }, noah)).status, 403);
    assert.equal((await call(db, "GET", "/api/budgets?year=2026", undefined, avery)).body.budgets.length, 1);
  });

  test("deleting a person or occasion drops its budget; renaming an occasion keeps it", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    await call(db, "POST", "/api/occasions", { name: "Diwali" }, me);
    await call(db, "PUT", "/api/budgets", { scope: "occasion", key: "Diwali", year: 2026, amount: 80 }, me);
    await call(db, "PATCH", "/api/occasions/Diwali", { name: "Deepavali" }, me);
    assert.equal((await call(db, "GET", "/api/budgets?year=2026", undefined, me)).body.budgets[0].key, "Deepavali");
    await call(db, "DELETE", "/api/occasions/Deepavali", undefined, me);
    assert.equal((await call(db, "GET", "/api/budgets?year=2026", undefined, me)).body.budgets.length, 0);
  });
});

describe("calendar feed", () => {
  test("token lifecycle: created on demand, regenerated, revoked", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    assert.equal((await call(db, "GET", "/api/calendar", undefined, me)).body.token, null);
    const a = (await call(db, "POST", "/api/calendar/token", {}, me)).body.token as string;
    assert.ok(a.length >= 30);
    assert.equal((await call(db, "GET", `/api/calendar/${a}.ics`)).status, 200);
    const b = (await call(db, "POST", "/api/calendar/token", {}, me)).body.token as string;
    assert.notEqual(a, b);
    assert.equal((await call(db, "GET", `/api/calendar/${a}.ics`)).status, 404);
    assert.equal((await call(db, "GET", `/api/calendar/${b}.ics`)).status, 200);
    assert.equal((await call(db, "GET", "/api/calendar/short.ics")).status, 404);
    await call(db, "DELETE", "/api/calendar/token", undefined, me);
    assert.equal((await call(db, "GET", `/api/calendar/${b}.ics`)).status, 404);
  });

  test("the feed is valid iCalendar with dates, yearly repeats and shopping reminders", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const token = (await call(db, "POST", "/api/calendar/token", {}, me)).body.token as string;
    const feed = await call(db, "GET", `/api/calendar/${token}.ics`);
    assert.match(String(feed.headers.get("content-type")), /text\/calendar/);
    const text = feed.text;
    assert.ok(text.startsWith("BEGIN:VCALENDAR\r\n") && text.endsWith("END:VCALENDAR\r\n"));
    assert.equal((text.match(/BEGIN:VEVENT/g) ?? []).length, (text.match(/END:VEVENT/g) ?? []).length);
    assert.match(text, /SUMMARY:🎁 Christmas/);
    assert.match(text, /RRULE:FREQ=YEARLY/);
    assert.match(text, /SUMMARY:Start shopping: Christmas/);
    assert.match(text, /DTSTART;VALUE=DATE:\d{8}/);
    for (const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
    // your own birthday doesn't list what's still to buy
    assert.ok(!/Avery’s birthday[\s\S]{0,200}Still to buy for: Avery/.test(text));
    // turning reminders off removes the shopping events
    assert.equal((await call(db, "PATCH", "/api/calendar", { remindDays: 0 }, me)).body.remindDays, 0);
    assert.ok(!(await call(db, "GET", `/api/calendar/${token}.ics`)).text.includes("Start shopping"));
    assert.equal((await call(db, "PATCH", "/api/calendar", { remindDays: 500 }, me)).status, 400);
  });

  test("the feed shows the owner's view: no surprise gifts for the linked person leak", async () => {
    const db = freshDb();
    const avery = signedIn(db, { username: "avery", personId: "p-avery" });
    const noah = signedIn(db, { username: "noah", role: "member", personId: "p-noah" });
    await call(db, "POST", "/api/gifts", {
      direction: "given", title: "Secret", occasion: "Christmas", date: "2026-12-01", giverId: "p-avery",
      receiverId: "p-noah", amount: 5, status: "purchased", thanked: false, note: "",
    }, avery);
    const tokenN = (await call(db, "POST", "/api/calendar/token", {}, noah)).body.token as string;
    const tokenA = (await call(db, "POST", "/api/calendar/token", {}, avery)).body.token as string;
    const forNoah = (await call(db, "GET", `/api/calendar/${tokenN}.ics`)).text;
    const forAvery = (await call(db, "GET", `/api/calendar/${tokenA}.ics`)).text;
    assert.ok(!forNoah.includes("Secret"));
    assert.ok(forAvery.length > 0);
  });
});
