import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { call, freshDb, registerCleanup, signedIn } from "./test-helpers.ts";

registerCleanup();

describe("CSV import and export", () => {
  test("exports each type, with a template; formulas are neutralised", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    await call(db, "POST", "/api/wishlist", { personId: "p-noah", title: "=HYPERLINK(\"x\")", price: 5 }, me);
    const gifts = await call(db, "GET", "/api/csv/export?type=gifts", undefined, me);
    assert.equal(gifts.status, 200);
    assert.match(String(gifts.headers.get("content-type")), /text\/csv/);
    assert.equal(gifts.text.split("\r\n")[0], "direction,title,occasion,date,giver,receiver,amount,status,thanked,note");
    assert.equal(gifts.text.trim().split("\r\n").length, 14);
    assert.match((await call(db, "GET", "/api/csv/export?type=people", undefined, me)).text, /Noah Cole,son,household,2016-12-02/);
    const wish = (await call(db, "GET", "/api/csv/export?type=wishlist", undefined, me)).text;
    assert.ok(wish.includes("'=HYPERLINK"));
    assert.match((await call(db, "GET", "/api/csv/template?type=people", undefined, me)).text, /name,relationship,circle/);
    assert.equal((await call(db, "GET", "/api/csv/export?type=nope", undefined, me)).status, 400);
  });

  test("a gift export imports back into an empty ledger", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const csv = (await call(db, "GET", "/api/csv/export?type=gifts", undefined, me)).text.replace(/^\uFEFF/, "");
    await call(db, "DELETE", "/api/gifts/g1", undefined, me);
    const preview = await call(db, "POST", "/api/csv/preview", { type: "gifts", text: csv }, me);
    assert.equal(preview.body.counts.total, 13);
    assert.equal(preview.body.counts.valid, 1); // the one we deleted; the rest are duplicates
    assert.equal(preview.body.counts.duplicates, 12);
    const done = await call(db, "POST", "/api/csv/import", { type: "gifts", text: csv }, me);
    assert.equal(done.body.added, 1);
    assert.equal(done.body.duplicates, 12);
    assert.equal((await call(db, "GET", "/api/gifts", undefined, me)).body.gifts.length, 13);
  });

  test("mapping, validation and a preview of problems; nothing is written on preview", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const text = [
      "What,When,Who,Cost,Extra",
      "Scarf,12/05/2026,Noah,24.50,x",
      "Book,not a date,Noah,10,x",
      "Mug,2026-12-06,Stranger Danger,5,x",
      ",2026-12-07,Noah,5,x",
      "Hat,2026-12-08,June,abc,x",
    ].join("\n");
    const before = (await call(db, "GET", "/api/gifts", undefined, me)).body.gifts.length;
    const first = (await call(db, "POST", "/api/csv/preview", { type: "gifts", text }, me)).body;
    // headers don't match by name: title/date are found via aliases? "What", "When" are aliases
    assert.equal(first.mapping.title, 0);
    assert.equal(first.mapping.date, 1);
    assert.equal(first.mapping.receiver, null);
    assert.equal(first.mapping.amount, 3);
    assert.equal(first.problems.length, 0);
    const mapped = (await call(db, "POST", "/api/csv/preview", { type: "gifts", text, mapping: { ...first.mapping, receiver: 2 } }, me)).body;
    assert.equal(mapped.counts.total, 5);
    assert.equal(mapped.counts.valid, 2); // Scarf and Mug (Mug brings a new person)
    assert.equal(mapped.counts.invalid, 3);
    assert.deepEqual(mapped.newPeople, ["Stranger Danger"]);
    const errors = mapped.rows.flatMap((r: { errors: string[] }) => r.errors).join(" | ");
    assert.match(errors, /Date isn’t readable/);
    assert.match(errors, /Gift is blank/);
    assert.match(errors, /Amount isn’t a number/);
    assert.equal((await call(db, "GET", "/api/gifts", undefined, me)).body.gifts.length, before);
    const mapping = { ...mapped.mapping };
    // without "add new people" the Mug row is reported, not guessed
    const strict = (await call(db, "POST", "/api/csv/import", { type: "gifts", text, mapping }, me)).body;
    assert.equal(strict.added, 1);
    assert.equal(strict.failed.length, 1);
    const lenient = (await call(db, "POST", "/api/csv/import", { type: "gifts", text, mapping, createPeople: true }, me)).body;
    assert.equal(lenient.added, 1);
    assert.deepEqual(lenient.newPeople, ["Stranger Danger"]);
    const gifts = (await call(db, "GET", "/api/gifts", undefined, me)).body.gifts as { title: string; date: string; amount: number; direction: string; giverId: string }[];
    const scarf = gifts.find((g) => g.title === "Scarf")!;
    assert.equal(scarf.date, "2026-12-05");
    assert.equal(scarf.amount, 24.5);
    assert.equal(scarf.direction, "given");
    assert.equal(scarf.giverId, "p-avery");
    assert.ok(gifts.some((g) => g.title === "Mug"));
  });

  test("people and wishlist imports", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const people = "name,relationship,circle,birthday\nGran Rose,grandmother,household,Mar 3\nNoah Cole,son,household,2016-12-02\nBad,friend,maybe,xx";
    const preview = (await call(db, "POST", "/api/csv/preview", { type: "people", text: people }, me)).body;
    assert.deepEqual([preview.counts.valid, preview.counts.invalid, preview.counts.duplicates], [1, 1, 1]);
    assert.equal((await call(db, "POST", "/api/csv/import", { type: "people", text: people }, me)).body.added, 1);
    const ledger = (await call(db, "GET", "/api/ledger", undefined, me)).body;
    assert.equal(ledger.people.find((p: { name: string }) => p.name === "Gran Rose").birthday, "--03-03");
    const wishes = "person,item,link,price,priority\nGran Rose,Slippers,example.com/slippers,$30,high\nNobody,Thing,,,\nNoah,Lego,,49.99,low";
    const done = (await call(db, "POST", "/api/csv/import", { type: "wishlist", text: wishes }, me)).body;
    assert.equal(done.added, 2);
    assert.equal(done.invalid, 1);
    const items = (await call(db, "GET", "/api/wishlist", undefined, me)).body.items as { title: string; priority: number; url: string }[];
    assert.equal(items.find((i) => i.title === "Slippers")!.priority, 1);
    assert.equal(items.find((i) => i.title === "Slippers")!.url, "https://example.com/slippers");
  });

  test("surprises for you can't be imported in; empty and missing-column files are explained", async () => {
    const db = freshDb();
    const noah = signedIn(db, { username: "noah", role: "member", personId: "p-noah" });
    const text = "title,date,receiver,status\nSecret,2026-12-01,Noah,purchased\nOK,2026-12-01,June,purchased";
    const done = (await call(db, "POST", "/api/csv/import", { type: "gifts", text }, noah)).body;
    assert.equal(done.added, 1);
    assert.equal(done.failed.length, 1);
    const empty = (await call(db, "POST", "/api/csv/preview", { type: "gifts", text: "" }, noah)).body;
    assert.ok(empty.problems.length > 0);
    const missing = (await call(db, "POST", "/api/csv/preview", { type: "gifts", text: "foo,bar\n1,2" }, noah)).body;
    assert.match(missing.problems.join(" "), /Choose a column/);
    assert.equal((await call(db, "POST", "/api/csv/import", { type: "gifts", text: "foo,bar\n1,2" }, noah)).status, 400);
  });
});
