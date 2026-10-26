import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { open, resetSecretCache, seal } from "./secrets.ts";
import { freshDb, registerCleanup, tempDir } from "./test-helpers.ts";

registerCleanup();
afterEach(() => {
  delete process.env.APP_SECRET;
  resetSecretCache();
});

describe("credential encryption", () => {
  it("generates a 0600 secret file in DATA_DIR and round-trips", () => {
    const dir = tempDir();
    const db = freshDb({ dir, seed: false });
    const sealed = seal(db, "p@ss word", "row-1");
    assert.match(sealed, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.ok(!sealed.includes("p@ss"));
    assert.equal(open(db, sealed, "row-1"), "p@ss word");
    const file = join(dir, "app-secret");
    assert.ok(existsSync(file));
    assert.equal(statSync(file).mode & 0o777, 0o600);
    // a restart (cold cache) reads the same file, so values stay readable
    resetSecretCache();
    assert.equal(open(db, sealed, "row-1"), "p@ss word");
  });

  it("is bound to its row and to the key, and tampering is detected", () => {
    const db = freshDb({ seed: false });
    const sealed = seal(db, "secret", "row-1");
    assert.equal(open(db, sealed, "row-2"), null);
    const parts = sealed.split(".");
    parts[3] = Buffer.from("evil").toString("base64url");
    assert.equal(open(db, parts.join("."), "row-1"), null);
    assert.equal(open(db, "garbage", "row-1"), null);
    assert.equal(open(db, null, "row-1"), null);
    process.env.APP_SECRET = "a-completely-different-secret-value";
    assert.equal(open(db, sealed, "row-1"), null, "a different APP_SECRET cannot read it");
  });

  it("derives the key from APP_SECRET when set, and refuses a short one", () => {
    const db = freshDb({ seed: false });
    process.env.APP_SECRET = "0123456789abcdef-long-enough";
    const sealed = seal(db, "x", "r");
    resetSecretCache();
    assert.equal(open(db, sealed, "r"), "x");
    process.env.APP_SECRET = "short";
    assert.throws(() => seal(db, "x", "r"), /at least 16/);
  });

  it("an existing secret file is reused and a truncated one is an error, not a silent new key", () => {
    const dir = tempDir();
    const db = freshDb({ dir, seed: false });
    writeFileSync(join(dir, "app-secret"), "this-is-a-long-enough-secret\n", { mode: 0o600 });
    const sealed = seal(db, "keep", "r");
    assert.equal(readFileSync(join(dir, "app-secret"), "utf8").trim(), "this-is-a-long-enough-secret");
    writeFileSync(join(dir, "app-secret"), "x\n", { mode: 0o600 });
    resetSecretCache();
    assert.throws(() => open(db, sealed, "r"), /too short/);
  });
});
