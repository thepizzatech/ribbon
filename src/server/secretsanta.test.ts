import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { call, freshDb, registerCleanup, secondHousehold, signedIn } from "./test-helpers.ts";
import { createInvite, redeemInvite } from "./sharing.ts";
import type { Db } from "./db.ts";

registerCleanup();

function family(db: Db) {
  return {
    avery: signedIn(db, { username: "avery", personId: "p-avery" }),
    jordan: signedIn(db, { username: "jordan", role: "member", personId: "p-jordan" }),
    noah: signedIn(db, { username: "noah", role: "member", personId: "p-noah" }),
    june: signedIn(db, { username: "june", role: "member", personId: "p-june" }),
  };
}
type Auth = ReturnType<typeof signedIn>;
const IDS = ["p-avery", "p-jordan", "p-noah", "p-june"];

async function setup(db: Db, organiser: Auth, extra: object = {}, people = IDS) {
  const made = await call(db, "POST", "/api/exchanges", { name: "Family Santa", date: "2026-12-20", budget: 25, ...extra }, organiser);
  assert.equal(made.status, 201);
  const id = made.body.exchange.id as string;
  const set = await call(db, "PUT", `/api/exchanges/${id}/participants`, { personIds: people }, organiser);
  assert.equal(set.status, 200);
  return id;
}
const mineOf = async (db: Db, who: Auth, id: string) => (await call(db, "GET", `/api/exchanges/${id}`, undefined, who)).body.exchange;

describe("secret santa visibility", () => {
  test("each participant sees only their own assignment, and together the draw is a valid derangement", async () => {
    const db = freshDb();
    const f = family(db);
    const id = await setup(db, f.avery);
    const drawn = await call(db, "POST", `/api/exchanges/${id}/draw`, {}, f.avery);
    assert.equal(drawn.status, 200);
    const received = new Set<string>();
    for (const [key, who] of Object.entries(f)) {
      const view = await mineOf(db, who, id);
      assert.ok(view.mine, key);
      assert.notEqual(view.mine.personId, `p-${key}`, "nobody draws themselves");
      received.add(view.mine.personId);
      // the payload contains exactly one assignment: yours
      const text = JSON.stringify(view);
      assert.equal(view.assignments, undefined);
      assert.equal(view.exclusions === undefined, !view.canManage);
      for (const other of IDS.filter((p) => p !== view.mine.personId)) {
        // other people's names appear only in the participant list, never as someone's "mine"
        assert.ok(!text.includes(`"receiver_id":"${other}"`));
      }
    }
    assert.equal(received.size, 4);
    // the list endpoint doesn't leak either
    const list = (await call(db, "GET", "/api/exchanges", undefined, f.noah)).body.exchanges[0];
    assert.equal(list.assignments, undefined);
    assert.ok(list.mine);
  });

  test("the organiser sees assignments only if they're a participant, or opted in to peek", async () => {
    const db = freshDb();
    const f = family(db);
    const host = signedIn(db, { username: "host" }); // owner of the household, not a participant, no person
    const id = await setup(db, host);
    await call(db, "POST", `/api/exchanges/${id}/draw`, {}, host);
    const view = await mineOf(db, host, id);
    assert.equal(view.status, "drawn");
    assert.equal(view.mine, null);
    assert.equal(view.assignments, undefined);
    assert.equal(view.canManage, true);
    // other owners can manage but never peek
    assert.equal((await call(db, "PATCH", `/api/exchanges/${id}`, { organiserPeek: true }, f.avery)).status, 403);
    // the organiser may turn peeking on explicitly
    await call(db, "PATCH", `/api/exchanges/${id}`, { organiserPeek: true }, host);
    const peek = await mineOf(db, host, id);
    assert.equal(peek.assignments.length, 4);
    // the household's other owner still sees only their own
    const averyView = await mineOf(db, f.avery, id);
    assert.equal(averyView.assignments, undefined);
    assert.ok(averyView.mine);
    // members can't manage
    assert.equal((await call(db, "POST", `/api/exchanges/${id}/draw`, { confirm: true }, f.noah)).status, 403);
    assert.equal((await call(db, "DELETE", `/api/exchanges/${id}`, undefined, f.noah)).status, 403);
  });

  test("outsiders get a 404; linked-household participants see it, other linked users do not", async () => {
    const db = freshDb();
    const f = family(db);
    const rivera = secondHousehold(db);
    const patels = secondHousehold(db, "The Patels");
    const id = await setup(db, f.avery);
    assert.equal((await call(db, "GET", `/api/exchanges/${id}`, undefined, rivera)).status, 404);
    // link, share the Riveras' person, add them
    assert.ok(redeemInvite(db, createInvite(db, f.avery.householdId, f.avery.id).code, rivera.householdId).ok);
    assert.equal((await call(db, "PUT", `/api/exchanges/${id}/participants`, { personIds: [...IDS, rivera.selfId] }, f.avery)).status, 400); // not shared yet
    assert.equal((await call(db, "PATCH", `/api/people/${rivera.selfId}`, { shared: true }, rivera)).status, 200);
    const added = await call(db, "PUT", `/api/exchanges/${id}/participants`, { personIds: [...IDS, rivera.selfId] }, f.avery);
    assert.equal(added.status, 200);
    assert.equal(added.body.exchange.participants.length, 5);
    assert.equal((await call(db, "GET", `/api/exchanges/${id}`, undefined, rivera)).status, 200);
    assert.equal((await call(db, "GET", `/api/exchanges/${id}`, undefined, patels)).status, 404);
    assert.equal((await call(db, "GET", "/api/exchanges", undefined, patels)).body.exchanges.length, 0);
    // the guest can see it but not manage it
    assert.equal((await call(db, "POST", `/api/exchanges/${id}/draw`, {}, rivera)).status, 403);
    await call(db, "POST", `/api/exchanges/${id}/draw`, {}, f.avery);
    const guest = await mineOf(db, rivera, id);
    assert.ok(guest.mine);
    assert.equal(guest.canManage, false);
    assert.equal(guest.exclusions, undefined);
    // someone from the other household can only be drawn from the shared set
    const candidates = (await call(db, "GET", "/api/exchanges/candidates", undefined, f.avery)).body.people as { personId: string }[];
    assert.ok(candidates.some((p) => p.personId === rivera.selfId));
    assert.equal(candidates.filter((p) => p.personId.startsWith("p-")).length, 8);
    // un-sharing removes them from the exchange and clears the draw
    await call(db, "PATCH", `/api/people/${rivera.selfId}`, { shared: false }, rivera);
    const after = await mineOf(db, f.avery, id);
    assert.equal(after.participants.length, 4);
    assert.equal(after.status, "draft");
    assert.equal((await call(db, "GET", `/api/exchanges/${id}`, undefined, rivera)).status, 404);
  });
});

describe("secret santa rules", () => {
  test("exclusions (a couple) are honoured across many re-draws; unsolvable setups are refused", async () => {
    const db = freshDb();
    const f = family(db);
    const id = await setup(db, f.avery);
    const set = await call(db, "PUT", `/api/exchanges/${id}/exclusions`, { pairs: [["p-avery", "p-jordan"]] }, f.avery);
    assert.equal(set.body.exchange.exclusions.length, 2); // mutual
    for (let i = 0; i < 25; i += 1) {
      assert.equal((await call(db, "POST", `/api/exchanges/${id}/draw`, { confirm: true }, f.avery)).status, 200);
      const a = (await mineOf(db, f.avery, id)).mine.personId;
      const j = (await mineOf(db, f.jordan, id)).mine.personId;
      assert.notEqual(a, "p-jordan");
      assert.notEqual(j, "p-avery");
    }
    assert.equal((await mineOf(db, f.avery, id)).drawCount, 25);
    // Make it impossible: Avery can't draw anyone
    await call(db, "PUT", `/api/exchanges/${id}/exclusions`, { pairs: [["p-avery", "p-jordan", false], ["p-avery", "p-noah", false], ["p-avery", "p-june", false]], confirm: true }, f.avery);
    const check = await call(db, "POST", `/api/exchanges/${id}/check`, {}, f.avery);
    assert.equal(check.body.ok, false);
    assert.deepEqual(check.body.stuck, ["Avery Cole"]);
    const refused = await call(db, "POST", `/api/exchanges/${id}/draw`, {}, f.avery);
    assert.equal(refused.status, 422);
    assert.equal((await mineOf(db, f.avery, id)).status, "draft");
    // bad inputs
    assert.equal((await call(db, "PUT", `/api/exchanges/${id}/exclusions`, { pairs: [["p-avery", "p-avery"]] }, f.avery)).status, 400);
    assert.equal((await call(db, "PUT", `/api/exchanges/${id}/exclusions`, { pairs: [["p-avery", "stranger"]] }, f.avery)).status, 400);
  });

  test("too few people; re-draw and participant changes need a confirm", async () => {
    const db = freshDb();
    const f = family(db);
    const id = await setup(db, f.avery, {}, ["p-avery", "p-jordan"]);
    assert.equal((await call(db, "POST", `/api/exchanges/${id}/draw`, {}, f.avery)).status, 422);
    await call(db, "PUT", `/api/exchanges/${id}/participants`, { personIds: IDS }, f.avery);
    assert.equal((await call(db, "POST", `/api/exchanges/${id}/draw`, {}, f.avery)).status, 200);
    assert.equal((await call(db, "POST", `/api/exchanges/${id}/draw`, {}, f.avery)).status, 409);
    assert.equal((await call(db, "PUT", `/api/exchanges/${id}/participants`, { personIds: ["p-avery", "p-jordan", "p-noah"] }, f.avery)).status, 409);
    assert.equal((await call(db, "PUT", `/api/exchanges/${id}/participants`, { personIds: ["p-avery", "p-jordan", "p-noah"], confirm: true }, f.avery)).status, 200);
    const view = await mineOf(db, f.avery, id);
    assert.equal(view.status, "draft");
    assert.equal(view.mine, null);
  });

  test("'don't repeat last year' avoids last exchange's pairs", async () => {
    const db = freshDb();
    const f = family(db);
    const last = await setup(db, f.avery, { name: "Santa 2025", date: "2025-12-20" });
    await call(db, "POST", `/api/exchanges/${last}/draw`, {}, f.avery);
    const prior = new Map<string, string>();
    for (const [key, who] of Object.entries(f)) prior.set(`p-${key}`, (await mineOf(db, who, last)).mine.personId);
    const now = await setup(db, f.avery, { name: "Santa 2026", date: "2026-12-20", avoidPrevious: true });
    for (let i = 0; i < 20; i += 1) {
      await call(db, "POST", `/api/exchanges/${now}/draw`, { confirm: true }, f.avery);
      for (const [key, who] of Object.entries(f)) assert.notEqual((await mineOf(db, who, now)).mine.personId, prior.get(`p-${key}`), `draw ${i}`);
    }
    // history: both exchanges are listed, newest first
    const list = (await call(db, "GET", "/api/exchanges", undefined, f.noah)).body.exchanges as { name: string }[];
    assert.deepEqual(list.map((e) => e.name), ["Santa 2026", "Santa 2025"]);
  });

  test("deleting a participant's person clears the draw; validation", async () => {
    const db = freshDb();
    const f = family(db);
    assert.equal((await call(db, "POST", "/api/exchanges", { name: "", date: "2026-12-20" }, f.avery)).status, 400);
    assert.equal((await call(db, "POST", "/api/exchanges", { name: "x", date: "soon" }, f.avery)).status, 400);
    assert.equal((await call(db, "POST", "/api/exchanges", { name: "x", date: "2026-12-20", budget: "lots" }, f.avery)).status, 400);
    const gran = (await call(db, "POST", "/api/people", { name: "Gran Rose", role: "Grandmother", circle: "outside" }, f.avery)).body.person;
    const id = await setup(db, f.avery, {}, [...IDS, gran.id]);
    assert.equal((await mineOf(db, f.avery, id)).participants.find((p: { personId: string }) => p.personId === gran.id).hasLogin, false);
    await call(db, "POST", `/api/exchanges/${id}/draw`, {}, f.avery);
    assert.equal((await call(db, "DELETE", `/api/people/${gran.id}`, undefined, f.avery)).status, 200);
    const view = await mineOf(db, f.avery, id);
    assert.equal(view.status, "draft");
    assert.equal(view.participants.length, 4);
  });
});
