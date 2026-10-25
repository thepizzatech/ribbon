import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import { handleApi } from "./api.ts";
import { MIGRATIONS, migrate, openDb, type Db } from "./db.ts";
import { hashPasswordSync } from "./password.ts";
import { createSession, createUser, ensureDevAccount, resetLockouts } from "./users.ts";

const dirs: string[] = [];
const dbs: Db[] = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "ribbon-test-"));
  dirs.push(dir);
  return dir;
}

function freshDb(options: { dir?: string; seed?: boolean } = {}) {
  const db = openDb(options.dir ?? tempDir(), { seed: options.seed ?? true });
  dbs.push(db);
  return db;
}

after(() => {
  for (const db of dbs) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const ENV_KEYS = ["ENFORCE_HTTPS", "PUBLIC_URL", "SETUP_CODE", "SEED_SAMPLE_DATA", "NODE_ENV", "GIT_COMMIT", "DEV_PASSWORD"];
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  resetLockouts();
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

type Auth = { cookie: string; csrf: string };

/** A signed-in owner without going through the (slow, rate-limited) login endpoint. */
function owner(db: Db, username = "owner"): Auth & { id: string } {
  const user = createUser(db, { username, role: "owner", passwordHash: hashPasswordSync("correct horse battery") });
  const made = createSession(db, user.id);
  return { id: user.id, cookie: `ribbon_session=${made.token}`, csrf: made.csrfToken };
}

async function call(
  db: Db,
  method: string,
  path: string,
  body?: unknown,
  auth?: Auth | null,
  headers: Record<string, string> = {},
) {
  const sendsCsrf = auth && method !== "GET";
  const response = await handleApi(
    new Request(`http://localhost:8080${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(auth ? { cookie: auth.cookie } : {}),
        ...(sendsCsrf ? { "x-csrf-token": auth.csrf } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    db,
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

describe("storage", () => {
  test("SEED_SAMPLE_DATA seeds the sample household; without it the database starts empty", async () => {
    const seeded = freshDb({ seed: true });
    const user = owner(seeded);
    const { status, body } = await call(seeded, "GET", "/api/ledger", undefined, user);
    assert.equal(status, 200);
    assert.equal(body.householdName, "The Coles");
    assert.equal(body.demo, true);
    assert.equal(body.people.length, 8);
    assert.equal(body.gifts[0].id, "g1");
    assert.equal(body.people[0].relationship, "self");

    const empty = freshDb({ seed: false });
    const session = await call(empty, "GET", "/api/session");
    assert.equal(session.body.setupRequired, true);
    assert.equal(session.body.hasLedger, false);
  });

  test("seeding follows the env default (off)", () => {
    delete process.env.SEED_SAMPLE_DATA;
    const db = openDb(tempDir());
    dbs.push(db);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM household").get()?.n, 0);
  });

  test("migrations are recorded and safe to re-run", () => {
    const db = freshDb();
    assert.deepEqual(migrate(db), []);
    assert.equal(db.prepare("SELECT id FROM _migrations").all().length, MIGRATIONS.length);
  });

  test("a version-1 database upgrades in place: data kept, relationships guessed from roles", () => {
    const dir = tempDir();
    const old = freshDb({ dir, seed: false });
    old.close();
    // Rebuild a v0.1 database by hand: schema 1 only.
    const dir2 = tempDir();
    const raw = new (old.constructor as new (path: string) => Db)(join(dir2, "ribbon.db"));
    dbs.push(raw);
    raw.exec("CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    raw.exec(MIGRATIONS[0]!.sql);
    raw.prepare("INSERT INTO _migrations VALUES (1, 'initial schema', 'x')").run();
    raw.prepare("INSERT INTO household (id, name, demo, demo_dismissed) VALUES (1, 'Old House', 0, 1)").run();
    const insert = raw.prepare("INSERT INTO people (id, seq, name, role, circle) VALUES (?, ?, ?, ?, ?)");
    insert.run("a", 1, "Ann", "Mom", "outside");
    insert.run("b", 2, "Bo", "Coworker", "outside");
    insert.run("c", 3, "Cy", "You", "household");
    raw.prepare(
      "INSERT INTO gifts (id, seq, direction, title, occasion, date, giver_id, receiver_id, amount, status, thanked, note) VALUES ('g', 1, 'given', 'Mug', 'Birthday', '2026-01-01', 'c', 'a', 5, 'idea', 0, '')",
    ).run();
    assert.deepEqual(migrate(raw), [2]);
    const rows = raw.prepare("SELECT id, relationship FROM people ORDER BY seq").all();
    assert.deepEqual(
      rows.map((r) => [r.id, r.relationship]),
      [["a", "mother"], ["b", "other"], ["c", "self"]],
    );
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM gifts").get()?.n, 1);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM users").get()?.n, 0);
  });

  test("data survives closing and reopening the file", async () => {
    const dir = tempDir();
    const first = freshDb({ dir });
    const auth = owner(first);
    await call(first, "PUT", "/api/household", { householdName: "The Rivers", demo: false, demoDismissed: true }, auth);
    await call(first, "POST", "/api/gifts", {
      id: "keep-me", direction: "given", title: "Kite", occasion: "Birthday", date: "2026-05-01",
      giverId: "p-avery", receiverId: "p-noah", amount: 12.5, status: "idea", thanked: false, note: "",
    }, auth);
    first.close();
    const second = freshDb({ dir });
    const { body } = await call(second, "GET", "/api/ledger", undefined, auth); // session rows persisted too
    assert.equal(body.householdName, "The Rivers");
    assert.equal(body.demo, false);
    assert.equal(body.gifts[0].id, "keep-me");
    assert.equal(body.gifts[0].amount, 12.5);
  });
});

describe("people", () => {
  test("create, update, delete", async () => {
    const db = freshDb();
    const auth = owner(db);
    const created = await call(db, "POST", "/api/people", { name: " Kai ", role: "Cousin", circle: "outside", relationship: "cousin" }, auth);
    assert.equal(created.status, 201);
    const id = created.body.person.id as string;
    assert.equal(created.body.person.name, "Kai");
    assert.equal(created.body.person.relationship, "cousin");

    const updated = await call(db, "PATCH", `/api/people/${id}`, { role: "Friend", relationship: "friend" }, auth);
    assert.equal(updated.body.person.role, "Friend");
    assert.equal(updated.body.person.relationship, "friend");

    assert.equal((await call(db, "DELETE", `/api/people/${id}`, undefined, auth)).status, 200);
    assert.equal((await call(db, "DELETE", `/api/people/${id}`, undefined, auth)).status, 404);
  });

  test("relationship is guessed from the role when missing, and unknown values become other", async () => {
    const db = freshDb();
    const auth = owner(db);
    const a = await call(db, "POST", "/api/people", { name: "Dee", role: "Dad", circle: "outside" }, auth);
    assert.equal(a.body.person.relationship, "father");
    const b = await call(db, "POST", "/api/people", { name: "Eve", role: "Neighbor", circle: "outside", relationship: "bogus" }, auth);
    assert.equal(b.body.person.relationship, "other");
  });

  test("rejects bad input and protects people on gifts", async () => {
    const db = freshDb();
    const auth = owner(db);
    assert.equal((await call(db, "POST", "/api/people", { name: "No circle", role: "x" }, auth)).status, 400);
    const blocked = await call(db, "DELETE", "/api/people/p-may", undefined, auth);
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /on a gift/);
  });

  test("keeps at least one person", async () => {
    const db = freshDb();
    const auth = owner(db);
    await call(db, "POST", "/api/import", { householdName: "Solo", people: [{ id: "a", name: "A", role: "You", circle: "household" }], gifts: [], occasions: [] }, auth);
    assert.equal((await call(db, "DELETE", "/api/people/a", undefined, auth)).status, 409);
  });
});

describe("gifts", () => {
  const gift = {
    direction: "received", title: "Scarf", occasion: "Christmas", date: "2026-12-25",
    giverId: "p-may", receiverId: "p-avery", amount: null, status: "delivered", thanked: false, note: "",
  };

  test("create, read, update, delete; newest first", async () => {
    const db = freshDb();
    const auth = owner(db);
    const created = await call(db, "POST", "/api/gifts", gift, auth);
    assert.equal(created.status, 201);
    const id = created.body.gift.id as string;
    let ledger = (await call(db, "GET", "/api/ledger", undefined, auth)).body;
    assert.equal(ledger.gifts[0].id, id);
    const updated = await call(db, "PATCH", `/api/gifts/${id}`, { thanked: true, amount: 40 }, auth);
    assert.equal(updated.body.gift.thanked, true);
    assert.equal(updated.body.gift.amount, 40);
    assert.equal(updated.body.gift.title, "Scarf");
    assert.equal((await call(db, "DELETE", `/api/gifts/${id}`, undefined, auth)).status, 200);
    ledger = (await call(db, "GET", "/api/ledger", undefined, auth)).body;
    assert.ok(!ledger.gifts.some((g: { id: string }) => g.id === id));
    assert.equal((await call(db, "PATCH", `/api/gifts/${id}`, { thanked: false }, auth)).status, 404);
  });

  test("rejects an invalid gift or status", async () => {
    const db = freshDb();
    const auth = owner(db);
    assert.equal((await call(db, "POST", "/api/gifts", { ...gift, status: "lost" }, auth)).status, 400);
    assert.equal((await call(db, "PATCH", "/api/gifts/g1", { status: "lost" }, auth)).status, 400);
  });
});

describe("occasions", () => {
  test("add, rename (updates gifts), remove, and the rules", async () => {
    const db = freshDb();
    const auth = owner(db);
    assert.equal((await call(db, "POST", "/api/occasions", { name: "Diwali" }, auth)).status, 201);
    assert.equal((await call(db, "POST", "/api/occasions", { name: "diwali" }, auth)).status, 409);
    assert.equal((await call(db, "POST", "/api/occasions", { name: "  " }, auth)).status, 400);
    const renamed = await call(db, "PATCH", `/api/occasions/${encodeURIComponent("Just because")}`, { name: "Surprise" }, auth);
    assert.equal(renamed.status, 200);
    const ledger = (await call(db, "GET", "/api/ledger", undefined, auth)).body;
    assert.ok(ledger.gifts.some((g: { occasion: string }) => g.occasion === "Surprise"));
    assert.equal((await call(db, "DELETE", "/api/occasions/Christmas", undefined, auth)).status, 409);
    assert.equal((await call(db, "DELETE", "/api/occasions/Diwali", undefined, auth)).status, 200);
    assert.equal((await call(db, "DELETE", "/api/occasions/Nope", undefined, auth)).status, 404);
  });
});

describe("export and import", () => {
  test("export then import round-trips and replaces what was there", async () => {
    const db = freshDb();
    const auth = owner(db);
    const exported = await call(db, "GET", "/api/export", undefined, auth);
    assert.equal(exported.status, 200);
    assert.equal(exported.body.version, 1);

    const other = freshDb();
    const otherAuth = owner(other);
    await call(other, "POST", "/api/import", { householdName: "Temp", people: [{ id: "x", name: "X", role: "You", circle: "household" }], gifts: [], occasions: ["Only"] }, otherAuth);
    const imported = await call(other, "POST", "/api/import", exported.body, otherAuth);
    assert.equal(imported.status, 200);
    assert.equal(imported.body.householdName, "The Coles");
    assert.deepEqual(imported.body.gifts, exported.body.gifts);
    assert.deepEqual(imported.body.people, exported.body.people);
    assert.equal(imported.body.demo, false);
  });

  test("import honours demo flags, drops duplicate ids, fills relationships, and rejects junk", async () => {
    const db = freshDb();
    const auth = owner(db);
    const person = { id: "a", name: "A", role: "Mom", circle: "household" };
    const ok = await call(db, "POST", "/api/import", { householdName: "H", people: [person, person], gifts: [], occasions: [], demo: true, demoDismissed: false }, auth);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.people.length, 1);
    assert.equal(ok.body.people[0].relationship, "mother");
    assert.equal(ok.body.demo, true);
    assert.equal(ok.body.demoDismissed, false);
    assert.equal((await call(db, "POST", "/api/import", { nope: true }, auth)).status, 400);
  });
});

describe("onboarding", () => {
  const family = {
    familyName: "The Rivers",
    yourName: "Sam Rivers",
    people: [
      { name: "Alex Rivers", relationship: "wife", household: true },
      { name: "Kit Rivers", relationship: "son", household: true },
      { name: "Gran", relationship: "grandmother", household: false },
      { name: "Pat", relationship: "other", role: "Neighbor", household: false },
    ],
    username: "sam@example.com",
    password: "a-long-enough-password",
  };

  test("a fresh install asks for setup, then creates the household, members, owner login and a session", async () => {
    const db = freshDb({ seed: false });
    const before = await call(db, "GET", "/api/session");
    assert.deepEqual(
      [before.body.setupRequired, before.body.hasLedger, before.body.authed],
      [true, false, false],
    );
    assert.equal((await call(db, "GET", "/api/ledger")).status, 401);

    const made = await call(db, "POST", "/api/setup", family);
    assert.equal(made.status, 201);
    assert.equal(made.body.authed, true);
    assert.equal(made.body.user.role, "owner");
    assert.equal(made.body.user.username, "sam@example.com");
    assert.ok(made.body.csrfToken);
    const cookie = (made.headers.get("set-cookie") ?? "").split(";")[0]!;
    const auth = { cookie, csrf: made.body.csrfToken as string };

    const ledger = (await call(db, "GET", "/api/ledger", undefined, auth)).body;
    assert.equal(ledger.householdName, "The Rivers");
    assert.equal(ledger.demo, false);
    assert.equal(ledger.gifts.length, 0);
    assert.deepEqual(
      ledger.people.map((p: { name: string; relationship: string; circle: string; role: string }) => [p.name, p.relationship, p.circle, p.role]),
      [
        ["Sam Rivers", "self", "household", "You"],
        ["Alex Rivers", "wife", "household", "Wife"],
        ["Kit Rivers", "son", "household", "Son"],
        ["Gran", "grandmother", "outside", "Grandmother"],
        ["Pat", "other", "outside", "Neighbor"],
      ],
    );
    assert.ok(ledger.occasions.includes("Birthday"));

    const after = await call(db, "GET", "/api/session", undefined, auth);
    assert.equal(after.body.setupRequired, false);
    assert.equal((await call(db, "POST", "/api/setup", family)).status, 409);
  });

  test("setup validates the family name, members, username and password", async () => {
    const db = freshDb({ seed: false });
    assert.equal((await call(db, "POST", "/api/setup", { ...family, familyName: " " })).status, 400);
    assert.equal((await call(db, "POST", "/api/setup", { ...family, people: [{ name: "", relationship: "son" }] })).status, 400);
    assert.equal((await call(db, "POST", "/api/setup", { ...family, username: "x" })).status, 400);
    assert.equal((await call(db, "POST", "/api/setup", { ...family, password: "short" })).status, 400);
    assert.equal((await call(db, "POST", "/api/setup", { ...family, password: "sam@example.com" })).status, 400);
    assert.equal((await call(db, "GET", "/api/session")).body.setupRequired, true);
  });

  test("an existing ledger with no logins (after an upgrade) only needs an owner, and keeps its data", async () => {
    const db = freshDb({ seed: true });
    const before = await call(db, "GET", "/api/session");
    assert.deepEqual([before.body.setupRequired, before.body.hasLedger, before.body.householdName], [true, true, "The Coles"]);
    const made = await call(db, "POST", "/api/setup", { username: "avery", password: "a-long-enough-password" });
    assert.equal(made.status, 201);
    const cookie = (made.headers.get("set-cookie") ?? "").split(";")[0]!;
    const ledger = (await call(db, "GET", "/api/ledger", undefined, { cookie, csrf: made.body.csrfToken })).body;
    assert.equal(ledger.householdName, "The Coles");
    assert.equal(ledger.people.length, 8);
    assert.ok(ledger.gifts.length > 0);
  });

  test("SETUP_CODE, when set, is required to create the owner", async () => {
    process.env.SETUP_CODE = "let-me-in";
    const db = freshDb({ seed: false });
    assert.equal((await call(db, "GET", "/api/session")).body.setupCodeRequired, true);
    assert.equal((await call(db, "POST", "/api/setup", family)).status, 403);
    assert.equal((await call(db, "POST", "/api/setup", { ...family, setupCode: "let-me-in" })).status, 201);
  });

  test("the dev account is only created with sample data on and never in production", () => {
    process.env.SEED_SAMPLE_DATA = "true";
    process.env.NODE_ENV = "test";
    const dev = freshDb({ seed: true });
    const user = ensureDevAccount(dev);
    assert.equal(user?.username, "admin");
    assert.equal(ensureDevAccount(dev), null); // only when no users exist

    process.env.NODE_ENV = "production";
    assert.equal(ensureDevAccount(freshDb({ seed: true })), null);
    process.env.NODE_ENV = "test";
    process.env.SEED_SAMPLE_DATA = "false";
    assert.equal(ensureDevAccount(freshDb({ seed: true })), null);
  });
});

describe("accounts and sessions", () => {
  async function ready() {
    const db = freshDb({ seed: false });
    const made = await call(db, "POST", "/api/setup", {
      familyName: "F", username: "owner", password: "a-long-enough-password",
    });
    const cookie = (made.headers.get("set-cookie") ?? "").split(";")[0]!;
    return { db, auth: { cookie, csrf: made.body.csrfToken as string } };
  }

  test("everything but health, session, setup and login needs a session", async () => {
    const { db } = await ready();
    for (const path of ["/api/ledger", "/api/people", "/api/gifts", "/api/export", "/api/users"]) {
      assert.equal((await call(db, "GET", path)).status, 401, path);
    }
    assert.equal((await call(db, "GET", "/api/health")).status, 200);
    assert.equal((await call(db, "GET", "/api/session")).status, 200);
  });

  test("login: wrong password fails the same way for known and unknown users; right one sets a hardened cookie", async () => {
    const { db } = await ready();
    const bad = await call(db, "POST", "/api/login", { username: "owner", password: "nope-nope-nope" });
    const unknown = await call(db, "POST", "/api/login", { username: "ghost", password: "nope-nope-nope" });
    assert.equal(bad.status, 401);
    assert.deepEqual(bad.body, unknown.body);

    const good = await call(db, "POST", "/api/login", { username: "Owner", password: "a-long-enough-password" });
    assert.equal(good.status, 200);
    const setCookie = good.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^ribbon_session=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.doesNotMatch(setCookie, /Secure/);
    assert.ok(good.body.csrfToken);
  });

  test("cookies are Secure (and __Host- prefixed) over HTTPS or when ENFORCE_HTTPS is on", async () => {
    const { db } = await ready();
    const viaProxy = await call(db, "POST", "/api/login", { username: "owner", password: "a-long-enough-password" }, null, { "x-forwarded-proto": "https" });
    assert.match(viaProxy.headers.get("set-cookie") ?? "", /^__Host-ribbon_session=.*; Secure/);
    process.env.ENFORCE_HTTPS = "true";
    const enforced = await call(db, "POST", "/api/login", { username: "owner", password: "a-long-enough-password" });
    assert.match(enforced.headers.get("set-cookie") ?? "", /Secure/);
    // The prefixed cookie is accepted when sent back.
    const cookie = (viaProxy.headers.get("set-cookie") ?? "").split(";")[0]!;
    assert.equal((await call(db, "GET", "/api/ledger", undefined, { cookie, csrf: "" })).status, 200);
  });

  test("repeated wrong passwords lock the account out for a while", async () => {
    const { db } = await ready();
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await call(db, "POST", "/api/login", { username: "owner", password: `wrong-password-${i}` })).status, 401);
    }
    const locked = await call(db, "POST", "/api/login", { username: "owner", password: "a-long-enough-password" });
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get("retry-after")) > 0);
  });

  test("logout ends the session", async () => {
    const { db, auth } = await ready();
    assert.equal((await call(db, "POST", "/api/logout", {}, auth)).status, 200);
    assert.equal((await call(db, "GET", "/api/ledger", undefined, auth)).status, 401);
  });

  test("change password: needs the current one, enforces the policy, signs other sessions out", async () => {
    const { db, auth } = await ready();
    const second = await call(db, "POST", "/api/login", { username: "owner", password: "a-long-enough-password" });
    const otherAuth = { cookie: (second.headers.get("set-cookie") ?? "").split(";")[0]!, csrf: second.body.csrfToken as string };

    assert.equal((await call(db, "POST", "/api/account/password", { current: "wrong", next: "another-long-password" }, auth)).status, 400);
    assert.equal((await call(db, "POST", "/api/account/password", { current: "a-long-enough-password", next: "short" }, auth)).status, 400);
    assert.equal((await call(db, "POST", "/api/account/password", { current: "a-long-enough-password", next: "another-long-password" }, auth)).status, 200);

    assert.equal((await call(db, "GET", "/api/ledger", undefined, auth)).status, 200);
    assert.equal((await call(db, "GET", "/api/ledger", undefined, otherAuth)).status, 401);
    assert.equal((await call(db, "POST", "/api/login", { username: "owner", password: "a-long-enough-password" })).status, 401);
    assert.equal((await call(db, "POST", "/api/login", { username: "owner", password: "another-long-password" })).status, 200);
  });

  test("passwords are stored as scrypt hashes, never in clear", async () => {
    const { db } = await ready();
    const row = db.prepare("SELECT password_hash FROM users WHERE username = 'owner'").get() as { password_hash: string };
    assert.match(row.password_hash, /^scrypt\$32768\$8\$1\$/);
    assert.ok(!row.password_hash.includes("a-long-enough-password"));
    const session = db.prepare("SELECT id FROM sessions").get() as { id: string };
    assert.match(session.id, /^[0-9a-f]{64}$/); // only a hash of the token is stored
  });

  test("owners manage logins; members cannot; you can't remove yourself or the last owner", async () => {
    const { db, auth } = await ready();
    const added = await call(db, "POST", "/api/users", { username: "kid", password: "kid-long-password", displayName: "Kit", role: "member" }, auth);
    assert.equal(added.status, 201);
    assert.equal(added.body.user.role, "member");
    assert.equal((await call(db, "POST", "/api/users", { username: "KID", password: "kid-long-password" }, auth)).status, 409);
    assert.equal((await call(db, "POST", "/api/users", { username: "weak", password: "x" }, auth)).status, 400);

    const list = await call(db, "GET", "/api/users", undefined, auth);
    assert.equal(list.body.users.length, 2);
    assert.ok(!JSON.stringify(list.body).includes("hash"));

    const member = await call(db, "POST", "/api/login", { username: "kid", password: "kid-long-password" });
    const memberAuth = { cookie: (member.headers.get("set-cookie") ?? "").split(";")[0]!, csrf: member.body.csrfToken as string };
    assert.equal((await call(db, "GET", "/api/ledger", undefined, memberAuth)).status, 200);
    assert.equal((await call(db, "GET", "/api/users", undefined, memberAuth)).status, 403);
    assert.equal((await call(db, "POST", "/api/users", { username: "evil", password: "evil-long-password" }, memberAuth)).status, 403);

    const ownerId = list.body.users.find((u: { username: string }) => u.username === "owner").id;
    const kidId = added.body.user.id;
    assert.equal((await call(db, "DELETE", `/api/users/${ownerId}`, undefined, auth)).status, 409);
    assert.equal((await call(db, "DELETE", `/api/users/${kidId}`, undefined, auth)).status, 200);
    assert.equal((await call(db, "GET", "/api/ledger", undefined, memberAuth)).status, 401); // their session went with them
  });
});

describe("csrf and origin checks", () => {
  test("writes need the session's CSRF token; reads do not", async () => {
    const db = freshDb();
    const auth = owner(db);
    const gift = { direction: "given", title: "T", occasion: "Birthday", date: "2026-01-01", giverId: "p-avery", receiverId: "p-noah", status: "idea", thanked: false };
    assert.equal((await call(db, "GET", "/api/ledger", undefined, auth)).status, 200);
    // cookie only, no header
    const none = await handleApi(
      new Request("http://localhost:8080/api/gifts", { method: "POST", headers: { "content-type": "application/json", cookie: auth.cookie }, body: JSON.stringify(gift) }),
      db,
    );
    assert.equal(none.status, 403);
    assert.equal((await call(db, "POST", "/api/gifts", gift, { ...auth, csrf: "wrong" })).status, 403);
    assert.equal((await call(db, "DELETE", "/api/gifts/g1", undefined, { ...auth, csrf: "wrong" })).status, 403);
    assert.equal((await call(db, "POST", "/api/gifts", gift, auth)).status, 201);
  });

  test("cross-site Origin headers are rejected, same-site ones pass", async () => {
    const db = freshDb({ seed: false });
    const body = { familyName: "F", username: "owner", password: "a-long-enough-password" };
    assert.equal((await call(db, "POST", "/api/setup", body, null, { origin: "https://evil.example" })).status, 403);
    assert.equal((await call(db, "POST", "/api/login", { username: "a", password: "b" }, null, { origin: "https://evil.example" })).status, 403);
    assert.equal((await call(db, "POST", "/api/setup", body, null, { origin: "http://localhost:8080" })).status, 201);
  });

  test("JSON content type is required on writes", async () => {
    const db = freshDb();
    const auth = owner(db);
    const response = await handleApi(
      new Request("http://localhost:8080/api/gifts", { method: "POST", body: "x", headers: { cookie: auth.cookie, "x-csrf-token": auth.csrf } }),
      db,
    );
    assert.equal(response.status, 415);
  });
});

describe("version", () => {
  test("health reports the package version and the short commit", async () => {
    const db = freshDb();
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    delete process.env.GIT_COMMIT;
    const plain = await call(db, "GET", "/api/health");
    assert.deepEqual(plain.body, { ok: true, version: pkg.version, commit: null });
    assert.match(pkg.version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    process.env.GIT_COMMIT = "0123456789abcdef";
    assert.equal((await call(db, "GET", "/api/health")).body.commit, "0123456");
    assert.equal((await call(db, "GET", "/api/session")).body.version, pkg.version);
  });
});
