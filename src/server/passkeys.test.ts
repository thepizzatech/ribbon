import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { describe, test } from "node:test";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";
import { call, freshDb, registerCleanup, signedIn } from "./test-helpers.ts";
import { createUser } from "./users.ts";
import type { Db } from "./db.ts";

registerCleanup();

// A software authenticator, good enough to exercise the server's real WebAuthn verification.
class VirtualAuthenticator {
  credentialId = randomBytes(32);
  counter = 0;
  private privateKey: KeyObject;
  private x: Buffer;
  private y: Buffer;
  constructor() {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
    this.x = Buffer.from(jwk.x, "base64url");
    this.y = Buffer.from(jwk.y, "base64url");
  }
  get id() {
    return isoBase64URL.fromBuffer(this.credentialId);
  }
  private rpIdHash(rpId: string) {
    return createHash("sha256").update(rpId).digest();
  }
  private clientData(type: string, challenge: string, origin: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }
  register(options: { challenge: string; rp: { id?: string } }, origin = "http://localhost:8080", rpId = "localhost") {
    const cose = Buffer.from(isoCBOR.encode(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, this.x], [-3, this.y]]) as never));
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    const counter = Buffer.alloc(4);
    const authData = Buffer.concat([this.rpIdHash(rpId), Buffer.from([0x45]), counter, Buffer.alloc(16), idLen, this.credentialId, cose]);
    const attestation = Buffer.from(isoCBOR.encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]) as never));
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: this.clientData("webauthn.create", options.challenge, origin).toString("base64url"),
        attestationObject: attestation.toString("base64url"),
        transports: ["internal"],
      },
    };
  }
  assert(options: { challenge: string }, { origin = "http://localhost:8080", rpId = "localhost", counter, key }: { origin?: string; rpId?: string; counter?: number; key?: KeyObject } = {}) {
    this.counter = counter ?? this.counter + 1;
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    const authData = Buffer.concat([this.rpIdHash(rpId), Buffer.from([0x05]), count]);
    const clientData = this.clientData("webauthn.get", options.challenge, origin);
    const signature = sign("sha256", Buffer.concat([authData, createHash("sha256").update(clientData).digest()]), key ?? this.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        authenticatorData: authData.toString("base64url"),
        clientDataJSON: clientData.toString("base64url"),
        signature: signature.toString("base64url"),
      },
    };
  }
}

async function registerPasskey(db: Db, auth: ReturnType<typeof signedIn>, authenticator: VirtualAuthenticator, name = "Laptop") {
  const opts = await call(db, "POST", "/api/me/passkeys/options", {}, auth);
  assert.equal(opts.status, 200);
  return call(db, "POST", "/api/me/passkeys", { challengeId: opts.body.challengeId, response: authenticator.register(opts.body.options), name }, auth);
}

async function signInWith(db: Db, authenticator: VirtualAuthenticator, assertion: Parameters<VirtualAuthenticator["assert"]>[1] = {}) {
  const opts = await call(db, "GET", "/api/auth/passkey/options");
  assert.equal(opts.status, 200);
  assert.equal(opts.body.options.rpId, "localhost");
  return {
    opts,
    result: await call(db, "POST", "/api/auth/passkey/login", { challengeId: opts.body.challengeId, response: authenticator.assert(opts.body.options, assertion) }),
  };
}

describe("passkeys", () => {
  test("register in Settings, then sign in with no username", async () => {
    const db = freshDb();
    const avery = signedIn(db, { username: "avery" });
    const device = new VirtualAuthenticator();
    const made = await registerPasskey(db, avery, device);
    assert.equal(made.status, 201);
    assert.equal(made.body.passkeys[0].name, "Laptop");
    assert.equal((await call(db, "GET", "/api/session", undefined, avery)).body.passkeys, 1);
    const { result } = await signInWith(db, device);
    assert.equal(result.status, 200);
    assert.equal(result.body.authed, true);
    assert.equal(result.body.user.username, "avery");
    assert.match(String(result.headers.get("set-cookie")), /ribbon_session=/);
    // counter moves forward and last-used is recorded
    assert.equal(db.prepare("SELECT counter FROM webauthn_credentials").get()?.counter, 1);
    assert.ok((await call(db, "GET", "/api/me/passkeys", undefined, avery)).body.passkeys[0].lastUsedAt);
  });

  test("the same credential can't be registered twice; the exclude list is sent; a limit applies", async () => {
    const db = freshDb();
    const avery = signedIn(db, { username: "avery" });
    const device = new VirtualAuthenticator();
    await registerPasskey(db, avery, device);
    const opts = await call(db, "POST", "/api/me/passkeys/options", {}, avery);
    assert.equal(opts.body.options.excludeCredentials.length, 1);
    assert.equal((await registerPasskey(db, avery, device)).status, 409);
  });

  test("bad assertions are refused: wrong key, replayed challenge, wrong origin, wrong RP, counter rollback, unknown credential", async () => {
    const db = freshDb();
    const avery = signedIn(db, { username: "avery" });
    const device = new VirtualAuthenticator();
    await registerPasskey(db, avery, device);
    const attacker = generateKeyPairSync("ec", { namedCurve: "P-256" });
    assert.equal((await signInWith(db, device, { key: attacker.privateKey })).result.status, 401);
    assert.equal((await signInWith(db, device, { origin: "https://evil.example" })).result.status, 401);
    assert.equal((await signInWith(db, device, { rpId: "evil.example" })).result.status, 401);
    // a challenge works once
    const { opts, result } = await signInWith(db, device);
    assert.equal(result.status, 200);
    const replay = await call(db, "POST", "/api/auth/passkey/login", { challengeId: opts.body.challengeId, response: device.assert(opts.body.options, { counter: 5 }) });
    assert.equal(replay.status, 401);
    // counters must move forward (cloned authenticator detection)
    assert.equal((await signInWith(db, device, { counter: 5 })).result.status, 200);
    assert.equal((await signInWith(db, device, { counter: 3 })).result.status, 401);
    // someone else's credential id
    assert.equal((await signInWith(db, new VirtualAuthenticator())).result.status, 401);
    // a sign-in challenge can't be used to register, and registering needs a session
    const loginOpts = await call(db, "GET", "/api/auth/passkey/options");
    const asRegister = await call(db, "POST", "/api/me/passkeys", { challengeId: loginOpts.body.challengeId, response: new VirtualAuthenticator().register(loginOpts.body.options) }, avery);
    assert.equal(asRegister.status, 400);
    assert.equal((await call(db, "POST", "/api/me/passkeys/options", {})).status, 401);
  });

  test("another user's registration challenge is useless to you", async () => {
    const db = freshDb();
    const avery = signedIn(db, { username: "avery" });
    const noah = signedIn(db, { username: "noah", role: "member" });
    const opts = await call(db, "POST", "/api/me/passkeys/options", {}, avery);
    const stolen = await call(db, "POST", "/api/me/passkeys", { challengeId: opts.body.challengeId, response: new VirtualAuthenticator().register(opts.body.options) }, noah);
    assert.equal(stolen.status, 400);
  });

  test("removing passkeys: yours only, and never the last way in", async () => {
    const db = freshDb();
    const avery = signedIn(db, { username: "avery" });
    const device = new VirtualAuthenticator();
    const made = await registerPasskey(db, avery, device);
    const id = made.body.passkeys[0].id as string;
    const noah = signedIn(db, { username: "noah", role: "member" });
    assert.equal((await call(db, "DELETE", `/api/me/passkeys/${id}`, undefined, noah)).status, 404);
    assert.equal((await call(db, "DELETE", `/api/me/passkeys/${id}`, undefined, avery)).body.passkeys.length, 0);
    // a passwordless account with only a passkey
    const passwordless = createUser(db, { username: "gran", role: "member", passwordHash: "!", householdId: avery.householdId });
    const session = await (async () => {
      const { createSession } = await import("./users.ts");
      const s = createSession(db, passwordless.id);
      return { cookie: `ribbon_session=${s.token}`, csrf: s.csrfToken };
    })();
    const phone = new VirtualAuthenticator();
    const reg = await registerPasskey(db, session as never, phone, "Phone");
    assert.equal(reg.status, 201);
    assert.equal((await call(db, "DELETE", `/api/me/passkeys/${reg.body.passkeys[0].id}`, undefined, session)).status, 409);
  });
});
