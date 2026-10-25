import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { call, freshDb, registerCleanup, secondHousehold, signedIn } from "./test-helpers.ts";
import { createInvite, redeemInvite } from "./sharing.ts";

registerCleanup();

const item = (patch: object = {}) => ({ personId: "p-noah", title: "LEGO set", url: "lego.com/set", price: 49.99, size: "", notes: "the big one", priority: 1, ...patch });

describe("wishlists", () => {
  test("add, edit, list, delete; link and price are cleaned", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const made = await call(db, "POST", "/api/wishlist", item(), me);
    assert.equal(made.status, 201);
    assert.equal(made.body.item.url, "https://lego.com/set");
    assert.equal(made.body.item.status, "wanted");
    const bad = await call(db, "POST", "/api/wishlist", item({ url: "javascript:alert(1)" }), me);
    assert.equal(bad.status, 400);
    assert.equal((await call(db, "POST", "/api/wishlist", item({ price: "abc" }), me)).status, 400);
    assert.equal((await call(db, "POST", "/api/wishlist", item({ title: " " }), me)).status, 400);
    assert.equal((await call(db, "POST", "/api/wishlist", item({ personId: "nobody" }), me)).status, 400);
    const edited = await call(db, "PATCH", `/api/wishlist/${made.body.item.id}`, { priority: 3, size: "M" }, me);
    assert.equal(edited.body.item.priority, 3);
    assert.equal(edited.body.item.size, "M");
    const list = await call(db, "GET", "/api/wishlist?personId=p-noah", undefined, me);
    assert.equal(list.body.items.length, 1);
    assert.equal((await call(db, "DELETE", `/api/wishlist/${made.body.item.id}`, undefined, me)).status, 200);
    assert.equal((await call(db, "GET", "/api/wishlist", undefined, me)).body.items.length, 0);
  });

  test("reserved and purchased marks are visible to others but hidden from the list's owner", async () => {
    const db = freshDb();
    const avery = signedIn(db, { username: "avery", personId: "p-avery" });
    const noah = signedIn(db, { username: "noah", role: "member", personId: "p-noah" });
    const made = await call(db, "POST", "/api/wishlist", item(), noah);
    const id = made.body.item.id;
    const reserved = await call(db, "PATCH", `/api/wishlist/${id}`, { status: "reserved" }, avery);
    assert.equal(reserved.body.item.status, "reserved");
    assert.equal(reserved.body.item.claimedByMe, true);
    // Noah sees his own list as untouched: no status, no name
    const own = (await call(db, "GET", "/api/wishlist?personId=p-noah", undefined, noah)).body.items[0];
    assert.equal(own.status, "wanted");
    assert.equal(own.claimedBy, null);
    assert.ok(!JSON.stringify(own).includes("Avery"));
    // and can't reserve his own
    assert.equal((await call(db, "PATCH", `/api/wishlist/${id}`, { status: "purchased" }, noah)).status, 403);
    // everyone else sees who has it
    const june = signedIn(db, { username: "june", role: "member", personId: "p-june" });
    const seen = (await call(db, "GET", "/api/wishlist?personId=p-noah", undefined, june)).body.items[0];
    assert.equal(seen.status, "reserved");
    assert.ok(seen.claimedBy);
    assert.equal(seen.claimedByMe, false);
    // double-buy protection: June can't take it, and only the claimer (or owner) can release it
    assert.equal((await call(db, "PATCH", `/api/wishlist/${id}`, { status: "purchased" }, june)).status, 409);
    assert.equal((await call(db, "PATCH", `/api/wishlist/${id}`, { status: "wanted" }, june)).status, 403);
    assert.equal((await call(db, "PATCH", `/api/wishlist/${id}`, { status: "purchased" }, avery)).body.item.status, "purchased");
    assert.equal((await call(db, "PATCH", `/api/wishlist/${id}`, { status: "wanted" }, avery)).body.item.status, "wanted");
  });

  test("converting to a gift makes a planned gift and reserves the item", async () => {
    const db = freshDb();
    const avery = signedIn(db, { username: "avery", personId: "p-avery" });
    const noah = signedIn(db, { username: "noah", role: "member", personId: "p-noah" });
    const made = await call(db, "POST", "/api/wishlist", item(), avery);
    const id = made.body.item.id;
    assert.equal((await call(db, "POST", `/api/wishlist/${id}/convert`, {}, noah)).status, 403);
    const done = await call(db, "POST", `/api/wishlist/${id}/convert`, { occasion: "Birthday", date: "2026-12-05" }, avery);
    assert.equal(done.status, 201);
    assert.equal(done.body.gift.title, "LEGO set");
    assert.equal(done.body.gift.amount, 49.99);
    assert.equal(done.body.gift.receiverId, "p-noah");
    assert.equal(done.body.gift.giverId, "p-avery");
    assert.equal(done.body.item.status, "reserved");
    // the new gift is a surprise: Noah doesn't see it
    const titles = (await call(db, "GET", "/api/gifts", undefined, noah)).body.gifts.map((g: { title: string }) => g.title);
    assert.ok(!titles.includes("LEGO set"));
  });

  test("a household's lists stay private; a linked household sees only shared people", async () => {
    const db = freshDb();
    const avery = signedIn(db, { username: "avery", personId: "p-avery" });
    const rivera = secondHousehold(db);
    const noahItem = (await call(db, "POST", "/api/wishlist", item(), avery)).body.item;
    const juneItem = (await call(db, "POST", "/api/wishlist", item({ personId: "p-june", title: "Book" }), avery)).body.item;
    assert.equal((await call(db, "GET", "/api/wishlist", undefined, rivera)).body.items.length, 0);
    assert.equal((await call(db, "GET", "/api/shared/wishlists", undefined, rivera)).body.lists.length, 0);
    // unlinked: can't claim
    assert.equal((await call(db, "PATCH", `/api/shared/wishlist/${noahItem.id}`, { status: "reserved" }, rivera)).status, 404);
    // link the households
    const invite = createInvite(db, avery.householdId, avery.id);
    const redeemed = redeemInvite(db, invite.code, rivera.householdId);
    assert.ok(redeemed.ok);
    // nobody is shared yet
    assert.equal((await call(db, "GET", "/api/shared/wishlists", undefined, rivera)).body.lists.length, 0);
    assert.equal((await call(db, "PATCH", `/api/shared/wishlist/${noahItem.id}`, { status: "reserved" }, rivera)).status, 404);
    assert.equal((await call(db, "PATCH", "/api/people/p-noah", { shared: true }, avery)).status, 200);
    const lists = (await call(db, "GET", "/api/shared/wishlists", undefined, rivera)).body.lists;
    assert.equal(lists.length, 1);
    assert.equal(lists[0].person.name, "Noah Cole");
    assert.equal(lists[0].items.length, 1);
    assert.equal(lists[0].items[0].title, "LEGO set");
    assert.ok(!JSON.stringify(lists).includes("June") && !JSON.stringify(lists).includes(juneItem.id));
    const claimed = await call(db, "PATCH", `/api/shared/wishlist/${noahItem.id}`, { status: "reserved" }, rivera);
    assert.equal(claimed.status, 200);
    // the Coles see it reserved by the Riveras; the wishlist owner does not
    const noah = signedIn(db, { username: "noah", role: "member", personId: "p-noah" });
    assert.equal((await call(db, "GET", "/api/wishlist?personId=p-noah", undefined, noah)).body.items[0].status, "wanted");
    assert.equal((await call(db, "GET", "/api/wishlist?personId=p-noah", undefined, avery)).body.items[0].status, "reserved");
    // linked households can't edit or delete items, or see ledgers
    assert.equal((await call(db, "PATCH", `/api/wishlist/${noahItem.id}`, { title: "x" }, rivera)).status, 404);
    assert.equal((await call(db, "DELETE", `/api/wishlist/${noahItem.id}`, undefined, rivera)).status, 404);
    assert.equal((await call(db, "GET", "/api/ledger", undefined, rivera)).body.gifts.length, 0);
  });

  test("deleting a person removes their wishlist", async () => {
    const db = freshDb();
    const avery = signedIn(db, { username: "avery", personId: "p-avery" });
    const extra = (await call(db, "POST", "/api/people", { name: "Gran", role: "Grandma", relationship: "grandmother", circle: "outside" }, avery)).body.person;
    await call(db, "POST", "/api/wishlist", item({ personId: extra.id }), avery);
    assert.equal((await call(db, "DELETE", `/api/people/${extra.id}`, undefined, avery)).status, 200);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM wishlist_items").get()?.n, 0);
  });
});
