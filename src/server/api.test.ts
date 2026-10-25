import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, test } from "node:test";
import { handleApi } from "./api.ts";
import { MIGRATIONS, migrate, openDb, type Db } from "./db.ts";

const dirs: string[] = [];
const dbs: Db[] = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "ribbon-test-"));
  dirs.push(dir);
  return dir;
}

function freshDb(dir = tempDir()) {
  const db = openDb(dir);
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

afterEach(() => {
  delete process.env.APP_PASSCODE;
});

async function call(db: Db, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await handleApi(
    new Request(`http://localhost:8080${path}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    db,
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

describe("storage", () => {
  test("a new database is migrated and seeded with the sample household", async () => {
    const db = freshDb();
    const { status, body } = await call(db, "GET", "/api/ledger");
    assert.equal(status, 200);
    assert.equal(body.householdName, "The Coles");
    assert.equal(body.demo, true);
    assert.equal(body.people.length, 8);
    assert.ok(body.gifts.length > 0);
    assert.equal(body.gifts[0].id, "g1");
    assert.ok(body.occasions.includes("Christmas"));
  });

  test("migrations are recorded and safe to re-run", () => {
    const db = freshDb();
    assert.deepEqual(migrate(db), []);
    const rows = db.prepare("SELECT id FROM _migrations").all();
    assert.equal(rows.length, MIGRATIONS.length);
  });

  test("data survives closing and reopening the file", async () => {
    const dir = tempDir();
    const first = freshDb(dir);
    await call(first, "PUT", "/api/household", { householdName: "The Rivers", demo: false, demoDismissed: true });
    await call(first, "POST", "/api/gifts", {
      id: "keep-me",
      direction: "given",
      title: "Kite",
      occasion: "Birthday",
      date: "2026-05-01",
      giverId: "p-avery",
      receiverId: "p-noah",
      amount: 12.5,
      status: "idea",
      thanked: false,
      note: "",
    });
    first.close();
    const second = freshDb(dir);
    const { body } = await call(second, "GET", "/api/ledger");
    assert.equal(body.householdName, "The Rivers");
    assert.equal(body.demo, false);
    assert.equal(body.gifts[0].id, "keep-me");
    assert.equal(body.gifts[0].amount, 12.5);
  });
});

describe("people", () => {
  test("create, update, delete", async () => {
    const db = freshDb();
    const created = await call(db, "POST", "/api/people", { name: " Kai ", role: "Cousin", circle: "outside" });
    assert.equal(created.status, 201);
    const id = created.body.person.id as string;
    assert.equal(created.body.person.name, "Kai");

    const updated = await call(db, "PATCH", `/api/people/${id}`, { role: "Friend" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.person.role, "Friend");
    assert.equal(updated.body.person.name, "Kai");

    assert.equal((await call(db, "DELETE", `/api/people/${id}`)).status, 200);
    assert.equal((await call(db, "DELETE", `/api/people/${id}`)).status, 404);
  });

  test("rejects bad input and protects people on gifts", async () => {
    const db = freshDb();
    assert.equal((await call(db, "POST", "/api/people", { name: "No circle", role: "x" })).status, 400);
    const blocked = await call(db, "DELETE", "/api/people/p-may");
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /on a gift/);
  });

  test("keeps at least one person", async () => {
    const db = freshDb();
    await call(db, "POST", "/api/import", { householdName: "Solo", people: [{ id: "a", name: "A", role: "You", circle: "household" }], gifts: [], occasions: [] });
    const result = await call(db, "DELETE", "/api/people/a");
    assert.equal(result.status, 409);
  });
});

describe("gifts", () => {
  const gift = {
    direction: "received",
    title: "Scarf",
    occasion: "Christmas",
    date: "2026-12-25",
    giverId: "p-may",
    receiverId: "p-avery",
    amount: null,
    status: "delivered",
    thanked: false,
    note: "",
  };

  test("create, read, update, delete; newest first", async () => {
    const db = freshDb();
    const created = await call(db, "POST", "/api/gifts", gift);
    assert.equal(created.status, 201);
    const id = created.body.gift.id as string;

    let ledger = (await call(db, "GET", "/api/ledger")).body;
    assert.equal(ledger.gifts[0].id, id);

    const updated = await call(db, "PATCH", `/api/gifts/${id}`, { thanked: true, amount: 40 });
    assert.equal(updated.body.gift.thanked, true);
    assert.equal(updated.body.gift.amount, 40);
    assert.equal(updated.body.gift.title, "Scarf");

    assert.equal((await call(db, "DELETE", `/api/gifts/${id}`)).status, 200);
    ledger = (await call(db, "GET", "/api/ledger")).body;
    assert.ok(!ledger.gifts.some((g: { id: string }) => g.id === id));
    assert.equal((await call(db, "PATCH", `/api/gifts/${id}`, { thanked: false })).status, 404);
  });

  test("rejects an invalid gift or status", async () => {
    const db = freshDb();
    assert.equal((await call(db, "POST", "/api/gifts", { ...gift, status: "lost" })).status, 400);
    assert.equal((await call(db, "PATCH", "/api/gifts/g1", { status: "lost" })).status, 400);
  });
});

describe("occasions", () => {
  test("add, rename (updates gifts), remove, and the rules", async () => {
    const db = freshDb();
    assert.equal((await call(db, "POST", "/api/occasions", { name: "Diwali" })).status, 201);
    assert.equal((await call(db, "POST", "/api/occasions", { name: "diwali" })).status, 409);
    assert.equal((await call(db, "POST", "/api/occasions", { name: "  " })).status, 400);

    const renamed = await call(db, "PATCH", `/api/occasions/${encodeURIComponent("Just because")}`, { name: "Surprise" });
    assert.equal(renamed.status, 200);
    assert.ok(renamed.body.occasions.includes("Surprise"));
    const ledger = (await call(db, "GET", "/api/ledger")).body;
    assert.ok(ledger.gifts.some((g: { occasion: string }) => g.occasion === "Surprise"));

    const inUse = await call(db, "DELETE", "/api/occasions/Christmas");
    assert.equal(inUse.status, 409);
    assert.equal((await call(db, "DELETE", "/api/occasions/Diwali")).status, 200);
    assert.equal((await call(db, "DELETE", "/api/occasions/Nope")).status, 404);
  });
});

describe("export and import", () => {
  test("export then import round-trips and replaces what was there", async () => {
    const db = freshDb();
    const exported = await call(db, "GET", "/api/export");
    assert.equal(exported.status, 200);
    assert.equal(exported.body.version, 1);

    const other = freshDb();
    await call(other, "POST", "/api/import", { householdName: "Temp", people: [{ id: "x", name: "X", role: "You", circle: "household" }], gifts: [], occasions: ["Only"] });
    const imported = await call(other, "POST", "/api/import", exported.body);
    assert.equal(imported.status, 200);
    assert.equal(imported.body.householdName, "The Coles");
    assert.deepEqual(imported.body.gifts, exported.body.gifts);
    assert.deepEqual(imported.body.people, exported.body.people);
    assert.equal(imported.body.demo, false);
  });

  test("import honours demo flags, drops duplicate ids, and rejects junk", async () => {
    const db = freshDb();
    const person = { id: "a", name: "A", role: "You", circle: "household" };
    const ok = await call(db, "POST", "/api/import", { householdName: "H", people: [person, person], gifts: [], occasions: [], demo: true, demoDismissed: false });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.people.length, 1);
    assert.equal(ok.body.demo, true);
    assert.equal(ok.body.demoDismissed, false);
    assert.ok(ok.body.occasions.length > 0);
    assert.equal((await call(db, "POST", "/api/import", { nope: true })).status, 400);
    const after = await call(db, "GET", "/api/ledger");
    assert.equal(after.body.householdName, "H");
  });
});

describe("api behavior", () => {
  test("health works without auth; unknown routes 404; JSON content type is required", async () => {
    process.env.APP_PASSCODE = "pie";
    const db = freshDb();
    assert.deepEqual((await call(db, "GET", "/api/health")).body, { ok: true });
    assert.equal((await call(db, "GET", "/api/nothing", undefined, { authorization: "Bearer pie" })).status, 404);
    const response = await handleApi(
      new Request("http://localhost/api/gifts", { method: "POST", body: "x", headers: { authorization: "Bearer pie" } }),
      db,
    );
    assert.equal(response.status, 415);
  });
});

describe("passcode", () => {
  test("no APP_PASSCODE means no auth", async () => {
    const db = freshDb();
    assert.deepEqual((await call(db, "GET", "/api/session")).body, { required: false, authed: true });
    assert.equal((await call(db, "GET", "/api/ledger")).status, 200);
  });

  test("with APP_PASSCODE the API is locked until login", async () => {
    process.env.APP_PASSCODE = "open-sesame";
    const db = freshDb();
    assert.equal((await call(db, "GET", "/api/ledger")).status, 401);
    assert.deepEqual((await call(db, "GET", "/api/session")).body, { required: true, authed: false });

    const bad = await call(db, "POST", "/api/login", { passcode: "nope" });
    assert.equal(bad.status, 401);

    const good = await call(db, "POST", "/api/login", { passcode: "open-sesame" });
    assert.equal(good.status, 200);
    const cookie = (good.headers.get("set-cookie") ?? "").split(";")[0];
    assert.match(cookie, /^ribbon_session=/);
    assert.match(good.headers.get("set-cookie") ?? "", /HttpOnly/);

    assert.equal((await call(db, "GET", "/api/ledger", undefined, { cookie })).status, 200);
    assert.deepEqual((await call(db, "GET", "/api/session", undefined, { cookie })).body, { required: true, authed: true });
    assert.equal((await call(db, "GET", "/api/ledger", undefined, { cookie: "ribbon_session=1.bad" })).status, 401);
    assert.equal((await call(db, "GET", "/api/ledger", undefined, { authorization: "Bearer open-sesame" })).status, 200);

    // Changing the passcode signs old sessions out.
    process.env.APP_PASSCODE = "different";
    assert.equal((await call(db, "GET", "/api/ledger", undefined, { cookie })).status, 401);
  });
});
