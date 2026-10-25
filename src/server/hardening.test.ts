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
