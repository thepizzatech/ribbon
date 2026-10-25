import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { MIGRATIONS, openDb } from "./db.ts";
import { DatabaseSync } from "node:sqlite";
import { resetLockouts } from "./users.ts";
import { call, freshDb, registerCleanup, signedIn, tempDir } from "./test-helpers.ts";

registerCleanup();

const KEYS = ["SEED_SAMPLE_DATA", "TOUR_ALWAYS", "SETUP_CODE", "NODE_ENV"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  process.env.SEED_SAMPLE_DATA = "false";
  process.env.NODE_ENV = "test";
  delete process.env.SETUP_CODE;
  delete process.env.TOUR_ALWAYS;
  resetLockouts();
});
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const ACCOUNT = { username: "sam@example.com", password: "a-long-enough-password" };

async function firstSignIn(db = freshDb({ seed: false })) {
  const made = await call(db, "POST", "/api/setup", ACCOUNT);
  const cookie = (made.headers.get("set-cookie") ?? "").split(";")[0]!;
  return { db, made, auth: { cookie, csrf: made.body.csrfToken as string } };
}

describe("first visit only creates the owner account", () => {
  test("no family name or members are needed, and the owner is sent to the welcome setup", async () => {
    const { made, auth, db } = await firstSignIn();
    assert.equal(made.status, 201);
    assert.equal(made.body.user.role, "owner");
    assert.equal(made.body.welcomeRequired, true);
    assert.equal(made.body.tour.autoShow, false);
    const session = await call(db, "GET", "/api/session", undefined, auth);
    assert.equal(session.body.welcomeRequired, true);
    assert.equal(session.body.setupRequired, false);
  });

  test("SETUP_CODE is still required when it is configured", async () => {
    process.env.SETUP_CODE = "let-me-in";
    const db = freshDb({ seed: false });
    assert.equal((await call(db, "POST", "/api/setup", ACCOUNT)).status, 403);
    assert.equal((await call(db, "POST", "/api/setup", { ...ACCOUNT, setupCode: "let-me-in" })).status, 201);
  });

  test("a second owner cannot be created once the first exists", async () => {
    const { db } = await firstSignIn();
    assert.equal((await call(db, "POST", "/api/setup", { username: "mallory", password: "another-long-password" })).status, 409);
  });
});

describe("the server holds everything else closed until the welcome setup is done", () => {
  test("data routes answer 409 welcome_setup_required for the pending owner", async () => {
    const { db, auth } = await firstSignIn();
    for (const [method, path] of [
      ["GET", "/api/ledger"],
      ["GET", "/api/people"],
      ["GET", "/api/gifts"],
      ["POST", "/api/gifts"],
      ["GET", "/api/export"],
      ["GET", "/api/users"],
      ["POST", "/api/users"],
      ["GET", "/api/backups"],
      ["GET", "/api/csv/export?type=people"],
      ["POST", "/api/me/tour"],
      ["GET", "/api/calendar"],
    ] as const) {
      const r = await call(db, method, path, method === "POST" ? {} : undefined, auth);
      assert.equal(r.status, 409, `${method} ${path}`);
      assert.equal(r.body.code, "welcome_setup_required", `${method} ${path}`);
    }
  });

  test("sign-out, change password and the welcome endpoints still work", async () => {
    const { db, auth } = await firstSignIn();
    assert.equal((await call(db, "GET", "/api/welcome", undefined, auth)).status, 200);
    const changed = await call(db, "POST", "/api/account/password", { current: ACCOUNT.password, next: "a-different-long-password" }, auth);
    assert.equal(changed.status, 200);
    assert.equal((await call(db, "POST", "/api/logout", {}, auth)).status, 200);
  });

  test("starts empty: the household has no name yet and only the owner is a person", async () => {
    const { db, auth } = await firstSignIn();
    const state = (await call(db, "GET", "/api/welcome", undefined, auth)).body;
    assert.deepEqual([state.required, state.familyName, state.yourName, state.members, state.step], [true, "", "", [], 1]);
  });
});

describe("the wizard", () => {
  test("progress is saved on the server and resumes (also after signing in again)", async () => {
    const { db, auth } = await firstSignIn();
    const saved = await call(db, "PUT", "/api/welcome", { familyName: "The Rivers", yourName: "Sam Rivers", step: 2 }, auth);
    assert.equal(saved.status, 200);
    await call(db, "PUT", "/api/welcome", { members: [{ name: "Alex", relationship: "wife", household: true }] }, auth);
    // a different device: a fresh sign-in for the same owner
    const login = await call(db, "POST", "/api/login", ACCOUNT);
    assert.equal(login.status, 200);
    assert.equal(login.body.welcomeRequired, true);
    const again = { cookie: (login.headers.get("set-cookie") ?? "").split(";")[0]!, csrf: login.body.csrfToken as string };
    const state = (await call(db, "GET", "/api/welcome", undefined, again)).body;
    assert.deepEqual([state.familyName, state.yourName, state.step], ["The Rivers", "Sam Rivers", 2]);
    assert.deepEqual(state.members, [{ name: "Alex", relationship: "wife", role: "", household: true }]);
  });

  test("completing needs a family name, then opens the empty overview with the people the owner added", async () => {
    const { db, auth } = await firstSignIn();
    const blank = await call(db, "POST", "/api/welcome/complete", { familyName: "  " }, auth);
    assert.equal(blank.status, 400);
    assert.equal((await call(db, "GET", "/api/ledger", undefined, auth)).status, 409);

    const done = await call(
      db,
      "POST",
      "/api/welcome/complete",
      {
        familyName: "The Rivers",
        yourName: "Sam Rivers",
        members: [
          { name: "Alex Rivers", relationship: "wife", household: true },
          { name: "Kit", relationship: "son", household: true },
          { name: "Pat", relationship: "other", role: "Neighbor", household: false },
        ],
      },
      auth,
    );
    assert.equal(done.status, 200);
    const session = (await call(db, "GET", "/api/session", undefined, auth)).body;
    assert.equal(session.welcomeRequired, false);
    assert.equal(session.household.name, "The Rivers");
    assert.equal(session.user.displayName, "Sam Rivers");

    const ledger = (await call(db, "GET", "/api/ledger", undefined, auth)).body;
    assert.equal(ledger.householdName, "The Rivers");
    assert.equal(ledger.gifts.length, 0);
    assert.deepEqual(
      ledger.people.map((p: { name: string; relationship: string; circle: string; role: string }) => [p.name, p.relationship, p.circle, p.role]),
      [
        ["Sam Rivers", "self", "household", "You"],
        ["Alex Rivers", "wife", "household", "Wife"],
        ["Kit", "son", "household", "Son"],
        ["Pat", "other", "outside", "Neighbor"],
      ],
    );
    assert.ok(ledger.occasions.includes("Birthday"));
    // done is done: the wizard is gone
    assert.equal((await call(db, "GET", "/api/welcome", undefined, auth)).status, 404);
    assert.equal((await call(db, "POST", "/api/welcome/complete", { familyName: "Hijack" }, auth)).status, 404);
  });

  test("members can be skipped: finishing with just a name lands on an empty ledger", async () => {
    const { db, auth } = await firstSignIn();
    assert.equal((await call(db, "POST", "/api/welcome/complete", { familyName: "Just us" }, auth)).status, 200);
    const ledger = (await call(db, "GET", "/api/ledger", undefined, auth)).body;
    assert.equal(ledger.people.length, 1);
  });

  test("bad members are refused and nothing is half-saved", async () => {
    const { db, auth } = await firstSignIn();
    assert.equal((await call(db, "PUT", "/api/welcome", { members: [{ name: "", relationship: "son" }] }, auth)).status, 400);
    assert.equal((await call(db, "PUT", "/api/welcome", { members: new Array(31).fill({ name: "x", relationship: "son" }) }, auth)).status, 400);
    assert.equal((await call(db, "PUT", "/api/welcome", { familyName: 42 }, auth)).status, 400);
    assert.deepEqual((await call(db, "GET", "/api/welcome", undefined, auth)).body.members, []);
  });

  test("the tour starts only after the welcome setup (TOUR_ALWAYS)", async () => {
    process.env.TOUR_ALWAYS = "true";
    const { db, auth, made } = await firstSignIn();
    assert.equal(made.body.tour.autoShow, false);
    await call(db, "POST", "/api/welcome/complete", { familyName: "The Rivers" }, auth);
    const session = (await call(db, "GET", "/api/session", undefined, auth)).body;
    assert.equal(session.tour.autoShow, true);
  });
});

describe("who sees the welcome setup", () => {
  test("a member never does, and cannot reach the endpoints", async () => {
    const { db, auth } = await firstSignIn();
    await call(db, "POST", "/api/welcome/complete", { familyName: "The Rivers" }, auth);
    const added = await call(db, "POST", "/api/users", { username: "kit", password: "kit-long-password-1", role: "member" }, auth);
    assert.equal(added.status, 201);
    // Even if the household were somehow pending again, a member is not held back and the wizard is hidden.
    db.prepare("UPDATE households SET setup_complete = 0").run();
    const kit = await call(db, "POST", "/api/login", { username: "kit", password: "kit-long-password-1" });
    assert.equal(kit.body.welcomeRequired, false);
    const kitAuth = { cookie: (kit.headers.get("set-cookie") ?? "").split(";")[0]!, csrf: kit.body.csrfToken as string };
    assert.equal((await call(db, "GET", "/api/welcome", undefined, kitAuth)).status, 404);
    assert.equal((await call(db, "PUT", "/api/welcome", { familyName: "Mine now" }, kitAuth)).status, 404);
    assert.equal((await call(db, "GET", "/api/ledger", undefined, kitAuth)).status, 200);
  });

  test("a second owner of the pending household is held at the wizard too", async () => {
    const { db } = await firstSignIn();
    const other = signedIn(db, { username: "other-owner", role: "owner" }); // lands in the first (pending) household
    assert.equal((await call(db, "GET", "/api/ledger", undefined, other)).status, 409);
  });

  test("a second household added by the instance owner starts set up", async () => {
    const { db, auth } = await firstSignIn();
    await call(db, "POST", "/api/welcome/complete", { familyName: "The Rivers" }, auth);
    const made = await call(db, "POST", "/api/households", { familyName: "The Riveras", username: "rivera", password: "rivera-long-password" }, auth);
    assert.equal(made.status, 201);
    const login = await call(db, "POST", "/api/login", { username: "rivera", password: "rivera-long-password" });
    assert.equal(login.body.welcomeRequired, false);
  });

  test("sample-data development mode skips it", async () => {
    process.env.SEED_SAMPLE_DATA = "true";
    const db = freshDb({ seed: false });
    const made = await call(db, "POST", "/api/setup", ACCOUNT);
    assert.equal(made.status, 201);
    assert.equal(made.body.welcomeRequired, false);
    const auth = { cookie: (made.headers.get("set-cookie") ?? "").split(";")[0]!, csrf: made.body.csrfToken as string };
    assert.equal((await call(db, "GET", "/api/ledger", undefined, auth)).status, 200);
    assert.equal((await call(db, "GET", "/api/welcome", undefined, auth)).status, 404);
  });
});

describe("migration for existing installs", () => {
  test("households that already exist count as set up", () => {
    const dir = tempDir();
    const raw = new DatabaseSync(`${dir}/ribbon.db`);
    raw.exec("CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    // an install from before this feature: everything up to migration 7, with data in it
    for (const m of MIGRATIONS.filter((item) => item.id < 8)) {
      raw.exec(m.sql);
      raw.prepare("INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)").run(m.id, m.name, "2026-10-24T00:00:00Z");
    }
    raw.prepare("INSERT INTO households (id, name, demo, demo_dismissed, created_at) VALUES ('h-main', 'The Coles', 0, 1, 'x')").run();
    raw.close();
    const db = openDb(dir, { seed: false });
    const row = db.prepare("SELECT setup_complete, setup_step FROM households WHERE id = 'h-main'").get() as { setup_complete: number; setup_step: number };
    assert.deepEqual([row.setup_complete, row.setup_step], [1, 1]);
    db.close();
  });

  test("finishing the setup is what flips the flag", async () => {
    const { db, auth } = await firstSignIn();
    const flag = () => (db.prepare("SELECT setup_complete FROM households").get() as { setup_complete: number }).setup_complete;
    assert.equal(flag(), 0);
    await call(db, "POST", "/api/welcome/complete", { familyName: "The Rivers" }, auth);
    assert.equal(flag(), 1);
  });
});
