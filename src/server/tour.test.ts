import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { call, freshDb, registerCleanup, signedIn } from "./test-helpers.ts";

registerCleanup();
afterEach(() => {
  for (const key of ["TOUR_ALWAYS", "TOUR_IN_DEV", "SEED_SAMPLE_DATA"]) delete process.env[key];
});

const tour = async (db: ReturnType<typeof freshDb>, auth: ReturnType<typeof signedIn>) => (await call(db, "GET", "/api/session", undefined, auth)).body.tour;

describe("guided tour state", () => {
  test("null until finished; done and skipped are remembered with a timestamp; reset clears", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery" });
    assert.deepEqual(await tour(db, me), { state: null, at: null, autoShow: true });
    const done = await call(db, "POST", "/api/me/tour", { state: "done" }, me);
    assert.equal(done.body.tour.state, "done");
    assert.ok(done.body.tour.at);
    assert.equal((await tour(db, me)).autoShow, false);
    assert.equal((await call(db, "POST", "/api/me/tour", { state: "skipped" }, me)).body.tour.state, "skipped");
    assert.equal((await tour(db, me)).autoShow, false);
    assert.equal((await call(db, "POST", "/api/me/tour", { state: "reset" }, me)).body.tour.state, null);
    assert.equal((await tour(db, me)).autoShow, true);
    assert.equal((await call(db, "POST", "/api/me/tour", { state: "maybe" }, me)).status, 400);
    assert.equal((await call(db, "POST", "/api/me/tour", { state: "done" })).status, 401);
  });

  test("each login has its own state", async () => {
    const db = freshDb();
    const a = signedIn(db, { username: "avery" });
    const b = signedIn(db, { username: "noah", role: "member" });
    await call(db, "POST", "/api/me/tour", { state: "done" }, a);
    assert.equal((await tour(db, b)).state, null);
  });

  test("TOUR_ALWAYS keeps showing until it is done (skipping isn't enough)", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery" });
    process.env.TOUR_ALWAYS = "true";
    await call(db, "POST", "/api/me/tour", { state: "skipped" }, me);
    assert.equal((await tour(db, me)).autoShow, true);
    await call(db, "POST", "/api/me/tour", { state: "done" }, me);
    assert.equal((await tour(db, me)).autoShow, false);
  });

  test("off in sample-data development mode unless TOUR_IN_DEV or TOUR_ALWAYS", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery" });
    process.env.SEED_SAMPLE_DATA = "true";
    assert.equal((await tour(db, me)).autoShow, false);
    process.env.TOUR_IN_DEV = "true";
    assert.equal((await tour(db, me)).autoShow, true);
    delete process.env.TOUR_IN_DEV;
    process.env.TOUR_ALWAYS = "true";
    assert.equal((await tour(db, me)).autoShow, true);
  });

  test("signed out: no tour field content", async () => {
    const db = freshDb();
    assert.equal((await call(db, "GET", "/api/session")).body.tour, null);
  });
});
