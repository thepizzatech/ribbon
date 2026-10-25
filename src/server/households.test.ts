import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { call, freshDb, registerCleanup, secondHousehold, signedIn } from "./test-helpers.ts";

registerCleanup();

const planned = (receiverId: string, patch: object = {}) => ({
  direction: "given", title: "Surprise", occasion: "Birthday", date: "2026-12-02",
  giverId: "p-avery", receiverId, amount: 30, status: "purchased", thanked: false, note: "", ...patch,
});

describe("households are separate ledgers", () => {
  test("one household cannot read or change another's people, gifts or occasions", async () => {
    const db = freshDb();
    const coles = signedIn(db, { username: "avery", personId: "p-avery" });
    const rivera = secondHousehold(db);
    const mine = (await call(db, "GET", "/api/ledger", undefined, rivera)).body;
    assert.equal(mine.householdName, "The Riveras");
    assert.equal(mine.people.length, 2);
    assert.equal(mine.gifts.length, 0);
    assert.ok(!JSON.stringify(mine).includes("Avery"));
    assert.equal((await call(db, "PATCH", "/api/gifts/g1", { title: "hack" }, rivera)).status, 404);
    assert.equal((await call(db, "DELETE", "/api/gifts/g1", undefined, rivera)).status, 404);
    assert.equal((await call(db, "PATCH", "/api/people/p-may", { name: "x" }, rivera)).status, 404);
    assert.equal((await call(db, "DELETE", "/api/people/p-may", undefined, rivera)).status, 404);
    // can't point a gift at someone from the other household
    const bad = await call(db, "POST", "/api/gifts", planned("p-noah", { status: "idea" }), rivera);
    assert.equal(bad.status, 400);
    // their own data is untouched
    assert.equal((await call(db, "GET", "/api/ledger", undefined, coles)).body.gifts.length, 13);
  });

  test("occasions are per household; a name can exist in both", async () => {
    const db = freshDb();
    const coles = signedIn(db, { username: "avery" });
    const rivera = secondHousehold(db);
    assert.equal((await call(db, "POST", "/api/occasions", { name: "Diwali", date: "11-01" }, rivera)).status, 201);
    assert.equal((await call(db, "POST", "/api/occasions", { name: "Diwali" }, coles)).status, 201);
    const r = (await call(db, "GET", "/api/ledger", undefined, rivera)).body;
    assert.equal(r.occasionDates.Diwali, "11-01");
    assert.equal(r.occasionDates.Christmas, "12-25");
    assert.equal((await call(db, "GET", "/api/ledger", undefined, coles)).body.occasionDates.Diwali, undefined);
  });

  test("importing a file whose ids another household uses gives them fresh ids", async () => {
    const db = freshDb();
    const coles = signedIn(db, { username: "avery" });
    const rivera = secondHousehold(db);
    const file = (await call(db, "GET", "/api/export", undefined, coles)).body;
    const imported = await call(db, "POST", "/api/import", file, rivera);
    assert.equal(imported.status, 200);
    assert.equal(imported.body.people.length, file.people.length);
    assert.ok(imported.body.people.every((p: { id: string }) => !file.people.some((q: { id: string }) => q.id === p.id)));
    assert.equal(imported.body.gifts.length, file.gifts.length);
    assert.equal((await call(db, "GET", "/api/ledger", undefined, coles)).body.gifts.length, 13);
  });
});

describe("surprise-safe: nobody sees what is planned for them", () => {
  test("planned and bought gifts for the linked person are hidden everywhere in the API", async () => {
    const db = freshDb();
    const owner = signedIn(db, { username: "avery", personId: "p-avery" });
    const noah = signedIn(db, { username: "noah", role: "member", personId: "p-noah" });
    const made = await call(db, "POST", "/api/gifts", planned("p-noah"), owner);
    assert.equal(made.status, 201);
    const idea = await call(db, "POST", "/api/gifts", planned("p-noah", { status: "idea", title: "Idea for Noah" }), owner);
    const delivered = await call(db, "POST", "/api/gifts", planned("p-noah", { status: "delivered", title: "Given already" }), owner);
    const received = await call(db, "POST", "/api/gifts", {
      direction: "received", title: "Noah got", occasion: "Birthday", date: "2026-01-01", giverId: "p-may", receiverId: "p-noah",
      status: "delivered", thanked: false, note: "",
    }, owner);
    assert.equal(received.status, 201);

    const titles = (r: { body: { gifts: { title: string }[] } }) => r.body.gifts.map((g) => g.title);
    const ownerView = await call(db, "GET", "/api/gifts", undefined, owner);
    assert.ok(titles(ownerView).includes("Surprise") && titles(ownerView).includes("Idea for Noah"));
    for (const path of ["/api/gifts", "/api/ledger", "/api/export"]) {
      const view = await call(db, "GET", path, undefined, noah);
      const list = titles(view);
      assert.ok(!list.includes("Surprise"), path);
      assert.ok(!list.includes("Idea for Noah"), path);
      assert.ok(list.includes("Given already") && list.includes("Noah got"), path);
    }
    // direct access and tampering is a plain 404
    for (const gift of [made.body.gift, idea.body.gift]) {
      assert.equal((await call(db, "PATCH", `/api/gifts/${gift.id}`, { title: "peek" }, noah)).status, 404);
      assert.equal((await call(db, "DELETE", `/api/gifts/${gift.id}`, undefined, noah)).status, 404);
    }
    assert.ok(delivered.body.gift.id);
    // the surprise is still there for the family
    assert.equal(titles(await call(db, "GET", "/api/gifts", undefined, owner)).filter((t: string) => t === "Surprise").length, 1);
  });

  test("a gift can't be edited into (or created as) a surprise for yourself", async () => {
    const db = freshDb();
    const noah = signedIn(db, { username: "noah", role: "member", personId: "p-noah" });
    assert.equal((await call(db, "POST", "/api/gifts", planned("p-noah"), noah)).status, 400);
    const ok = await call(db, "POST", "/api/gifts", planned("p-june", { status: "idea" }), noah);
    assert.equal(ok.status, 201);
    assert.equal((await call(db, "PATCH", `/api/gifts/${ok.body.gift.id}`, { receiverId: "p-noah" }, noah)).status, 400);
  });

  test("a replace-all import is refused while surprises exist for the importer", async () => {
    const db = freshDb();
    const owner = signedIn(db, { username: "avery", personId: "p-avery" });
    const noah = signedIn(db, { username: "noah", role: "member", personId: "p-noah" });
    await call(db, "POST", "/api/gifts", planned("p-noah"), owner);
    const file = (await call(db, "GET", "/api/export", undefined, noah)).body;
    assert.equal((await call(db, "POST", "/api/import", file, noah)).status, 409);
    assert.equal((await call(db, "POST", "/api/import", file, owner)).status, 200);
  });

  test("'this is me' can be set once by yourself; only another owner can change it", async () => {
    const db = freshDb();
    const owner = signedIn(db, { username: "avery" });
    const kid = signedIn(db, { username: "noah", role: "member" });
    assert.equal((await call(db, "PUT", "/api/me/person", { personId: "p-noah" }, kid)).status, 200);
    assert.equal((await call(db, "PUT", "/api/me/person", { personId: "p-june" }, kid)).status, 409); // can't switch or clear
    assert.equal((await call(db, "PATCH", `/api/users/${kid.id}`, { personId: null }, kid)).status, 403); // not an owner
    assert.equal((await call(db, "PUT", "/api/me/person", { personId: "p-noah" }, owner)).status, 409); // taken by Noah's login
    assert.equal((await call(db, "PATCH", `/api/users/${kid.id}`, { personId: null }, owner)).status, 200);
    assert.equal((await call(db, "PUT", "/api/me/person", { personId: "p-june" }, kid)).status, 200);
  });
});

describe("linking households", () => {
  test("invite, join, share a person, unlink — owners only, single use, expiring", async () => {
    const db = freshDb();
    const coles = signedIn(db, { username: "avery", personId: "p-avery" });
    const kid = signedIn(db, { username: "noah", role: "member", personId: "p-noah" });
    const rivera = secondHousehold(db);
    assert.equal((await call(db, "POST", "/api/sharing/invite", {}, kid)).status, 403);
    const invite = await call(db, "POST", "/api/sharing/invite", {}, coles);
    assert.equal(invite.status, 201);
    assert.match(invite.body.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // the code is not stored in the clear
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM household_invites WHERE code_hash = ?").get(invite.body.code)?.n, 0);
    assert.equal((await call(db, "POST", "/api/sharing/join", { code: "AAAA-BBBB-CCCC" }, rivera)).status, 400);
    assert.equal((await call(db, "POST", "/api/sharing/join", { code: invite.body.code }, coles)).status, 400); // own household
    const joined = await call(db, "POST", "/api/sharing/join", { code: invite.body.code.toLowerCase() }, rivera);
    assert.equal(joined.status, 200);
    assert.equal(joined.body.links[0].name, "The Coles");
    assert.equal((await call(db, "GET", "/api/sharing", undefined, coles)).body.links[0].name, "The Riveras");
    // single use
    const other = secondHousehold(db, "The Patels");
    assert.equal((await call(db, "POST", "/api/sharing/join", { code: invite.body.code }, other)).status, 400);
    // only owners flip "shared"
    assert.equal((await call(db, "PATCH", "/api/people/p-noah", { shared: true }, kid)).status, 403);
    assert.equal((await call(db, "PATCH", "/api/people/p-noah", { shared: true }, coles)).status, 200);
    // a member's import can't turn sharing on
    const file = (await call(db, "GET", "/api/export", undefined, kid)).body;
    file.people = file.people.map((p: object) => ({ ...p, shared: true }));
    await call(db, "POST", "/api/import", file, kid);
    const people = (await call(db, "GET", "/api/people", undefined, coles)).body.people as { id: string; shared?: boolean }[];
    assert.equal(people.find((p) => p.id === "p-noah")!.shared, true);
    assert.equal(people.find((p) => p.id === "p-june")!.shared ?? false, false);
    // unlink
    assert.equal((await call(db, "DELETE", `/api/sharing/links/${coles.householdId}`, undefined, kid)).status, 403);
    assert.equal((await call(db, "DELETE", `/api/sharing/links/${coles.householdId}`, undefined, rivera)).body.links.length, 0);
    assert.equal((await call(db, "GET", "/api/sharing", undefined, coles)).body.links.length, 0);
  });

  test("an expired invite no longer works", async () => {
    const db = freshDb();
    const coles = signedIn(db, { username: "avery", personId: "p-avery" });
    const rivera = secondHousehold(db);
    const { createInvite, redeemInvite } = await import("./sharing.ts");
    const old = createInvite(db, coles.householdId, coles.id, Date.now() - 8 * 24 * 60 * 60 * 1000);
    assert.equal(redeemInvite(db, old.code, rivera.householdId).ok, false);
  });
});
