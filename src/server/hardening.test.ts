// Regression tests for the findings in docs/SECURITY-AUDIT.md.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { scryptSync, randomBytes } from "node:crypto";
import { hashPasswordSync, passwordNeedsRehash, verifyPassword } from "./password.ts";
import { clearMisses, getPasswordHash, lockedFor, recordMiss, resetLockouts } from "./users.ts";
import { call, freshDb, registerCleanup, signedIn } from "./test-helpers.ts";

registerCleanup();

const KEYS = ["SEED_SAMPLE_DATA", "SETUP_CODE", "ALLOW_PUBLIC_SETUP", "NODE_ENV", "TRUSTED_PROXIES"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  process.env.SEED_SAMPLE_DATA = "false";
  process.env.NODE_ENV = "test";
  delete process.env.SETUP_CODE;
  delete process.env.ALLOW_PUBLIC_SETUP;
  delete process.env.TRUSTED_PROXIES;
  resetLockouts();
});
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const ACCOUNT = { username: "sam@example.com", password: "a-long-enough-password" };
// A visitor from the internet arriving over HTTPS through a reverse proxy on the home network.
const PUBLIC = { "x-ribbon-peer": "10.0.0.2", "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https" };

describe("first-owner takeover", () => {
  test("a public address cannot create the owner without a SETUP_CODE; the home network can", async () => {
    const db = freshDb({ seed: false });
    const session = await call(db, "GET", "/api/session", undefined, null, PUBLIC);
    assert.match(session.body.setupBlocked, /SETUP_CODE/);
    const refused = await call(db, "POST", "/api/setup", ACCOUNT, null, PUBLIC);
    assert.equal(refused.status, 403);
    assert.equal((await call(db, "GET", "/api/session")).body.setupBlocked, null);
    assert.equal((await call(db, "POST", "/api/setup", ACCOUNT, null, { "x-ribbon-peer": "192.168.1.20" })).status, 201);
  });

  test("a public address may set up with the SETUP_CODE, or when ALLOW_PUBLIC_SETUP is on", async () => {
    process.env.SETUP_CODE = "open-sesame";
    const db = freshDb({ seed: false });
    assert.equal((await call(db, "POST", "/api/setup", { ...ACCOUNT, setupCode: "wrong" }, null, PUBLIC)).status, 403);
    assert.equal((await call(db, "POST", "/api/setup", { ...ACCOUNT, setupCode: "open-sesame" }, null, PUBLIC)).status, 201);
    delete process.env.SETUP_CODE;
    process.env.ALLOW_PUBLIC_SETUP = "true";
    const other = freshDb({ seed: false });
    assert.equal((await call(other, "POST", "/api/setup", ACCOUNT, null, PUBLIC)).status, 201);
  });

  test("SETUP_CODE guesses are rate limited, even for the right code afterwards", async () => {
    process.env.SETUP_CODE = "open-sesame";
    const db = freshDb({ seed: false });
    for (let i = 0; i < 10; i += 1) assert.equal((await call(db, "POST", "/api/setup", { ...ACCOUNT, setupCode: `guess-${i}` })).status, 403);
    const blocked = await call(db, "POST", "/api/setup", { ...ACCOUNT, setupCode: "open-sesame" });
    assert.equal(blocked.status, 429);
  });
});

describe("password hashing", () => {
  test("new hashes use the stronger scrypt settings and old ones are upgraded at sign-in", async () => {
    const db = freshDb({ seed: false });
    const owner = signedIn(db, { username: "sam" });
    const fresh = getPasswordHash(db, owner.id)!;
    assert.match(fresh, /^scrypt\$65536\$8\$2\$/);
    assert.equal(passwordNeedsRehash(fresh), false);

    const salt = randomBytes(16);
    const legacy = `scrypt$32768$8$1$${salt.toString("base64url")}$${scryptSync("correct horse battery", salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }).toString("base64url")}`;
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(legacy, owner.id);
    assert.ok(passwordNeedsRehash(legacy));
    assert.equal((await call(db, "POST", "/api/login", { username: "sam", password: "correct horse battery" })).status, 200);
    const upgraded = getPasswordHash(db, owner.id)!;
    assert.match(upgraded, /^scrypt\$65536\$8\$2\$/);
    assert.ok(await verifyPassword("correct horse battery", upgraded));
  });

  test("a tampered stored hash can't ask for absurd scrypt costs", async () => {
    const hash = hashPasswordSync("correct horse battery");
    const [scheme, , r, p, salt, key] = hash.split("$");
    const huge = [scheme, String(1 << 30), r, p, salt, key].join("$");
    const started = Date.now();
    assert.equal(await verifyPassword("correct horse battery", huge), false);
    assert.equal(await verifyPassword("x", ["scrypt", "1000", "8", "1", salt, key].join("$")), false);
    assert.ok(Date.now() - started < 1000);
  });

  test("a single-sign-on-only login (no password) takes as long to refuse as a wrong password", async () => {
    const db = freshDb({ seed: false });
    const owner = signedIn(db, { username: "sam" });
    db.prepare("UPDATE users SET password_hash = '!' WHERE id = ?").run(owner.id);
    const wrong = await call(db, "POST", "/api/login", { username: "sam", password: "whatever-it-is" });
    assert.equal(wrong.status, 401);
  });
});

describe("sign-in lockout", () => {
  test("rotating addresses (or forging X-Forwarded-For through a proxy) can't dodge the per-account limit", () => {
    for (let i = 0; i < 20; i += 1) recordMiss("sam", `198.51.100.${i}`);
    assert.ok(lockedFor("sam", "198.51.100.250") > 0, "a brand new address is still locked out of that account");
    assert.equal(lockedFor("someone-else", "198.51.100.250"), 0, "other accounts are untouched");
  });

  test("five misses from one address lock that address out of that account only", () => {
    for (let i = 0; i < 5; i += 1) recordMiss("sam", "203.0.113.7");
    assert.ok(lockedFor("sam", "203.0.113.7") > 0);
    assert.equal(lockedFor("sam", "203.0.113.8"), 0, "a few typos from elsewhere don't lock the owner out");
    assert.equal(lockedFor("kid", "203.0.113.7"), 0);
  });

  test("one address spraying many usernames is stopped", () => {
    for (let i = 0; i < 30; i += 1) recordMiss(`user${i}`, "203.0.113.7");
    assert.ok(lockedFor("fresh-name", "203.0.113.7") > 0);
  });

  test("a good sign-in forgives that address's own misses only", () => {
    for (let i = 0; i < 4; i += 1) recordMiss("sam", "203.0.113.7");
    clearMisses("sam", "203.0.113.7");
    for (let i = 0; i < 4; i += 1) recordMiss("sam", "203.0.113.7");
    assert.equal(lockedFor("sam", "203.0.113.7"), 0);
  });

  test("login answers 429 with Retry-After once locked, using the forwarded client address behind a proxy", async () => {
    const db = freshDb({ seed: false });
    signedIn(db, { username: "sam" });
    const via = { "x-ribbon-peer": "10.0.0.2", "x-forwarded-for": "203.0.113.50", "x-forwarded-proto": "https" };
    for (let i = 0; i < 5; i += 1) assert.equal((await call(db, "POST", "/api/login", { username: "sam", password: "nope-nope-nope" }, null, via)).status, 401);
    const locked = await call(db, "POST", "/api/login", { username: "sam", password: "correct horse battery" }, null, via);
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get("retry-after")) > 0);
    // a different real client behind the same proxy is not locked out by those typos
    const ok = await call(db, "POST", "/api/login", { username: "sam", password: "correct horse battery" }, null, { ...via, "x-forwarded-for": "203.0.113.51" });
    assert.equal(ok.status, 200);
  });
});

// ---------------------------------------------------------------------------------------------
import { chmodSync, statSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { handleApi } from "./api.ts";
import { backupDir } from "./backup.ts";
import { tempDir } from "./test-helpers.ts";

const PERSON = { name: "Kid", role: "Son", relationship: "son", circle: "household" };

describe("request bodies", () => {
  test("a chunked upload with no Content-Length is cut off at the size cap instead of being buffered", async () => {
    const db = freshDb({ seed: false });
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 12) return controller.close();
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const response = await handleApi(
      new Request("http://localhost:8080/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit),
      db,
    );
    assert.equal(response.status, 413);
    assert.ok(sent < 12, `stopped reading after ${sent} MiB`);
  });
});

describe("backups and restore", () => {
  test("backup files are private on disk, and a backup with no owner login is refused", async () => {
    const db = freshDb();
    const admin = signedIn(db, { username: "avery", personId: "p-avery" });
    const made = await call(db, "POST", "/api/backups", {}, admin);
    const file = join(backupDir(db), made.body.backup.name);
    assert.equal(statSync(file).mode & 0o077, 0, "no group/other access to a backup");
    assert.equal(statSync(backupDir(db)).mode & 0o077, 0);

    const stripped = join(tempDir(), "no-owner.db");
    copyFileSync(file, stripped);
    const conn = new DatabaseSync(stripped);
    conn.exec("PRAGMA foreign_keys = OFF; DELETE FROM users; DELETE FROM sessions;");
    conn.close();
    const refused = await call(db, "POST", "/api/backups/restore-upload", new Uint8Array(readFileSync(stripped)), admin, { "content-type": "application/octet-stream", "x-confirm": "restore" });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /no owner/);
    assert.equal((await call(db, "GET", "/api/session", undefined, admin)).body.authed, true, "still signed in");
  });

  test("a restore file with a hostile view or trigger can't run code or pollute the live database", async () => {
    const db = freshDb();
    const admin = signedIn(db, { username: "avery", personId: "p-avery" });
    const made = await call(db, "POST", "/api/backups", {}, admin);
    const evil = join(tempDir(), "evil.db");
    copyFileSync(join(backupDir(db), made.body.backup.name), evil);
    const conn = new DatabaseSync(evil);
    conn.exec("CREATE VIEW sneaky AS SELECT load_extension('x') AS y");
    conn.exec("CREATE TRIGGER sneaky_t AFTER INSERT ON gifts BEGIN DELETE FROM users; END");
    conn.close();
    const result = await call(db, "POST", "/api/backups/restore-upload", new Uint8Array(readFileSync(evil)), admin, { "content-type": "application/octet-stream", "x-confirm": "restore" });
    assert.equal(result.status, 200);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'sneaky%'").all() as { name: string }[]).length;
    assert.equal(names, 0, "views and triggers from an uploaded file are never copied in");
    assert.equal((await call(db, "GET", "/api/session", undefined, admin)).body.authed, true);
  });
});

describe("the person who set up Ribbon", () => {
  test("another owner can't demote or remove them (which would hand over every household's backups)", async () => {
    const db = freshDb();
    const first = signedIn(db, { username: "avery", personId: "p-avery" });
    const second = signedIn(db, { username: "jordan", personId: "p-jordan" });
    const demote = await call(db, "PATCH", `/api/users/${first.id}`, { role: "member" }, second);
    assert.equal(demote.status, 409);
    const remove = await call(db, "DELETE", `/api/users/${first.id}`, undefined, second);
    assert.equal(remove.status, 409);
    assert.equal((await call(db, "GET", "/api/backups", undefined, second)).status, 403);
    assert.equal((await call(db, "GET", "/api/backups", undefined, first)).status, 200);
    // the second owner is an ordinary owner: they can still be demoted
    assert.equal((await call(db, "PATCH", `/api/users/${second.id}`, { role: "member" }, first)).status, 200);
  });
});

describe("secret santa", () => {
  test("the organiser can't switch peeking on after the names are drawn", async () => {
    const db = freshDb();
    const avery = signedIn(db, { username: "avery", personId: "p-avery" });
    for (const [name, person] of [["jordan", "p-jordan"], ["noah", "p-noah"], ["june", "p-june"]] as const) signedIn(db, { username: name, role: "member", personId: person });
    const made = await call(db, "POST", "/api/exchanges", { name: "Santa", date: "2026-12-20", budget: 25 }, avery);
    const id = made.body.exchange.id as string;
    await call(db, "PUT", `/api/exchanges/${id}/participants`, { personIds: ["p-jordan", "p-noah", "p-june"] }, avery);
    assert.equal((await call(db, "POST", `/api/exchanges/${id}/draw`, {}, avery)).status, 200);
    const late = await call(db, "PATCH", `/api/exchanges/${id}`, { organiserPeek: true }, avery);
    assert.equal(late.status, 409);
    const view = (await call(db, "GET", `/api/exchanges/${id}`, undefined, avery)).body.exchange;
    assert.equal(view.assignments, undefined);
    // before the draw it is still allowed
    const other = await call(db, "POST", "/api/exchanges", { name: "Santa 2", date: "2026-12-21", budget: 25 }, avery);
    assert.equal((await call(db, "PATCH", `/api/exchanges/${other.body.exchange.id}`, { organiserPeek: true }, avery)).status, 200);
  });
});

describe("wishlist links and calendar text", () => {
  test("CSV-imported wishlist links follow the same rule as the form", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const text = "person,item,link\nNoah Cole,Good,example.com/bike\nNoah Cole,Bad,https://javascript:alert(1).x\nNoah Cole,Worse,javascript:alert(1)\n";
    const done = (await call(db, "POST", "/api/csv/import", { type: "wishlist", text }, me)).body;
    assert.equal(done.added, 1);
    assert.equal(done.invalid + done.failed.length, 2, "both bad links are refused, one at preview and one at insert");
    const items = (await call(db, "GET", "/api/wishlist?personId=p-noah", undefined, me)).body.items as { url: string }[];
    for (const item of items) assert.match(item.url, /^https?:\/\//);
  });

  test("a person's name can't inject calendar lines with a bare carriage return", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const added = await call(db, "POST", "/api/people", { ...PERSON, name: "Kid\rATTENDEE:mailto:evil@example.com\u0000", birthday: "2015-03-03" }, me);
    assert.equal(added.status, 201);
    const token = (await call(db, "POST", "/api/calendar/token", {}, me)).body.token as string;
    const ics = (await call(db, "GET", `/api/calendar/${token}.ics`)).text;
    assert.ok(!/\rATTENDEE/.test(ics.replace(/\r\n/g, "\n")), "no injected property line");
    assert.ok(!ics.split(/\r\n/).some((line) => line.startsWith("ATTENDEE")));
    assert.ok(!ics.includes("\u0000"));
  });
});

describe("small oracles", () => {
  test("removing yourself from the ledger never reveals whether a surprise is planned for you", async () => {
    const db = freshDb();
    const owner = signedIn(db, { username: "avery", personId: "p-avery" });
    const noah = signedIn(db, { username: "noah", role: "member", personId: "p-noah" });
    const surprise = await call(db, "POST", "/api/gifts", { direction: "given", title: "Surprise", occasion: "Birthday", date: "2026-12-01", giverId: "p-avery", receiverId: "p-noah", amount: 10, status: "idea", thanked: false, note: "" }, owner);
    assert.equal(surprise.status, 201);
    const withSurprise = await call(db, "DELETE", "/api/people/p-noah", undefined, noah);
    assert.equal(withSurprise.status, 409);
    assert.doesNotMatch(withSurprise.body.error, /gift/i);
    const june = signedIn(db, { username: "june", role: "member", personId: "p-june" });
    const without = await call(db, "DELETE", "/api/people/p-june", undefined, june);
    assert.equal(without.status, withSurprise.status);
    assert.equal(without.body.error, withSurprise.body.error);
  });

  test("a passkey id with broken percent-encoding is a 400, not a crash", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    assert.equal((await call(db, "DELETE", "/api/me/passkeys/%E0%A4%A", undefined, me)).status, 400);
  });
});

import { pathIsWellFormed } from "../../server/plugins/path-guard.ts";

describe("path guard", () => {
  test("paths with broken percent-encoding are rejected before the router sees them", () => {
    for (const bad of ["http://x/%E0%A4%A", "http://x/api/%ZZ", "http://x/assets/%C0%AF%"]) assert.equal(pathIsWellFormed(bad), false, bad);
    for (const good of ["http://x/", "http://x/api/gifts/a%20b", "http://x/%F0%9F%8E%81", "http://x/api/me?x=%ZZ"]) assert.equal(pathIsWellFormed(good), true, good);
  });
});
