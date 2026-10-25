import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { handleApi } from "./api.ts";
import { resetOidcCaches } from "./oidc.ts";
import { startFakeProvider, type FakeProvider } from "./oidc-fake.ts";
import { call, freshDb, registerCleanup, signedIn } from "./test-helpers.ts";
import { createUser } from "./users.ts";
import { hashPasswordSync } from "./password.ts";
import type { Db } from "./db.ts";

registerCleanup();

let provider: FakeProvider;
const ENV = ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_SCOPES", "OIDC_AUTO_LINK_BY_EMAIL", "OIDC_BUTTON_LABEL", "DISABLE_PASSWORD_LOGIN", "PUBLIC_URL", "OIDC_ALLOW_HTTP_ISSUER"];

before(async () => {
  provider = await startFakeProvider();
});
after(async () => {
  await provider.close();
});
beforeEach(() => {
  for (const key of ENV) delete process.env[key];
  process.env.OIDC_ISSUER = provider.issuer;
  process.env.OIDC_CLIENT_ID = provider.clientId;
  process.env.OIDC_CLIENT_SECRET = provider.clientSecret;
  provider.profile = { sub: "user-1", email: "avery@example.com", email_verified: true, name: "Avery" };
  provider.tamper = {};
  provider.tokenRequests = [];
  resetOidcCaches();
});
afterEach(() => {
  for (const key of ENV) delete process.env[key];
});

const BASE = "http://localhost:8080";
const cookieJar = (response: Response) => (response.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]!).join("; ");

/** Drive start -> provider -> callback. Returns the callback response and the cookies it set. */
async function signInFlow(db: Db, options: { link?: boolean; auth?: { cookie: string } } = {}) {
  const start = await handleApi(new Request(`${BASE}/api/auth/oidc/start${options.link ? "?link=1" : ""}`, { headers: options.auth ? { cookie: options.auth.cookie } : {} }), db);
  assert.equal(start.status, 302, "start should redirect");
  const flowCookie = cookieJar(start);
  const providerResponse = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const back = new URL(providerResponse.headers.get("location")!);
  const callback = await handleApi(
    new Request(`${BASE}${back.pathname}${back.search}`, { headers: { cookie: [flowCookie, options.auth?.cookie].filter(Boolean).join("; ") } }),
    db,
  );
  return { start, callback, flowCookie, back };
}
const ssoError = (response: Response) => new URL(response.headers.get("location")!, BASE).searchParams.get("sso_error");
const signedInAs = async (db: Db, cookie: string) => (await call(db, "GET", "/api/session", undefined, { cookie, csrf: "" })).body.user?.username as string | undefined;

function linked(db: Db, userId: string, sub = "user-1") {
  db.prepare("INSERT INTO oidc_identities (issuer, subject, user_id, created_at) VALUES (?, ?, ?, ?)").run(provider.issuer, sub, userId, "now");
}

describe("OIDC sign-in", () => {
  test("session reports SSO settings; the button label is configurable", async () => {
    const db = freshDb();
    process.env.OIDC_BUTTON_LABEL = "Continue with Authentik";
    const session = (await call(db, "GET", "/api/session")).body;
    assert.deepEqual({ enabled: session.sso.enabled, label: session.sso.label, passwordDisabled: session.sso.passwordDisabled }, { enabled: true, label: "Continue with Authentik", passwordDisabled: false });
    delete process.env.OIDC_ISSUER;
    assert.equal((await call(db, "GET", "/api/session")).body.sso.enabled, false);
    assert.equal((await handleApi(new Request(`${BASE}/api/auth/oidc/start`), db)).status, 404);
  });

  test("a linked identity signs in: PKCE (S256), state and nonce are sent; the redirect URI follows PUBLIC_URL", async () => {
    const db = freshDb();
    const user = signedIn(db, { username: "avery" });
    linked(db, user.id);
    process.env.PUBLIC_URL = "https://ribbon.example.com";
    const start = await handleApi(new Request(`${BASE}/api/auth/oidc/start`), db);
    const auth = new URL(start.headers.get("location")!);
    assert.equal(auth.searchParams.get("response_type"), "code");
    assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
    assert.ok((auth.searchParams.get("code_challenge") ?? "").length >= 40);
    assert.ok(auth.searchParams.get("state") && auth.searchParams.get("nonce"));
    assert.equal(auth.searchParams.get("scope"), "openid profile email");
    assert.equal(auth.searchParams.get("redirect_uri"), "https://ribbon.example.com/api/auth/oidc/callback");
    assert.ok(!auth.toString().includes(provider.clientSecret));
    delete process.env.PUBLIC_URL;
    const { callback } = await signInFlow(db);
    assert.equal(callback.status, 302);
    assert.equal(new URL(callback.headers.get("location")!, BASE).pathname, "/");
    const cookie = cookieJar(callback);
    assert.match(cookie, /ribbon_session=/);
    assert.equal(await signedInAs(db, cookie), "avery");
    // the secret went in the Authorization header, never in the URL or body
    assert.match(provider.tokenRequests[0]!.auth ?? "", /^Basic /);
    assert.equal(provider.tokenRequests[0]!.body.get("client_secret"), null);
    assert.ok(provider.tokenRequests[0]!.body.get("code_verifier"));
  });

  test("an unknown identity is refused unless auto-link by email applies (verified email only, opt-in)", async () => {
    const db = freshDb();
    const user = signedIn(db, { username: "avery" });
    db.prepare("UPDATE users SET email = 'avery@example.com' WHERE id = ?").run(user.id);
    // default: no auto-link
    let { callback } = await signInFlow(db);
    assert.equal(ssoError(callback), "nolink");
    assert.ok(!cookieJar(callback).includes("ribbon_session=") || cookieJar(callback).includes("ribbon_session=;"));
    // on, but the provider says the email is unverified
    process.env.OIDC_AUTO_LINK_BY_EMAIL = "true";
    provider.profile = { sub: "user-1", email: "avery@example.com", email_verified: false };
    ({ callback } = await signInFlow(db));
    assert.equal(ssoError(callback), "nolink");
    // on and verified: links and signs in
    provider.profile = { sub: "user-1", email: "Avery@Example.com", email_verified: true };
    ({ callback } = await signInFlow(db));
    assert.equal(callback.headers.get("location"), "/");
    assert.equal(await signedInAs(db, cookieJar(callback)), "avery");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM oidc_identities").get()?.n, 1);
    // a different email never matches
    provider.profile = { sub: "user-2", email: "stranger@example.com", email_verified: true };
    ({ callback } = await signInFlow(db));
    assert.equal(ssoError(callback), "nolink");
    // two accounts sharing one email: ambiguous, so no auto-link
    createUser(db, { username: "twin", role: "member", passwordHash: hashPasswordSync("correct horse battery"), email: "twin@example.com" });
    createUser(db, { username: "twin2", role: "member", passwordHash: hashPasswordSync("correct horse battery"), email: "twin@example.com" });
    provider.profile = { sub: "user-3", email: "twin@example.com", email_verified: true };
    ({ callback } = await signInFlow(db));
    assert.equal(ssoError(callback), "nolink");
  });

  test("state is bound to the browser and single-use; tampering is rejected", async () => {
    const db = freshDb();
    const user = signedIn(db, { username: "avery" });
    linked(db, user.id);
    // no cookie (login CSRF): someone else's callback URL in this browser
    const start = await handleApi(new Request(`${BASE}/api/auth/oidc/start`), db);
    const back = new URL((await fetch(start.headers.get("location")!, { redirect: "manual" })).headers.get("location")!);
    const noCookie = await handleApi(new Request(`${BASE}${back.pathname}${back.search}`), db);
    assert.equal(ssoError(noCookie), "state");
    // that attempt burned the state: even with the right cookie it fails now
    const replay = await handleApi(new Request(`${BASE}${back.pathname}${back.search}`, { headers: { cookie: cookieJar(start) } }), db);
    assert.equal(ssoError(replay), "state");
    // made-up state
    const forged = await handleApi(new Request(`${BASE}/api/auth/oidc/callback?code=x&state=nope`, { headers: { cookie: "ribbon_oidc=nope" } }), db);
    assert.equal(ssoError(forged), "state");
    // a completed callback can't be replayed
    const ok = await signInFlow(db);
    assert.equal(ok.callback.headers.get("location"), "/");
    const again = await handleApi(new Request(`${BASE}${ok.back.pathname}${ok.back.search}`, { headers: { cookie: ok.flowCookie } }), db);
    assert.equal(ssoError(again), "state");
    // the provider denying access
    provider.tamper = { denied: true };
    assert.equal(ssoError((await signInFlow(db)).callback), "denied");
  });

  test("bad ID tokens are refused: wrong nonce, audience, issuer, expired, wrong signing key, missing", async () => {
    const db = freshDb();
    const user = signedIn(db, { username: "avery" });
    linked(db, user.id);
    for (const tamper of [{ nonce: "other" }, { aud: "someone-else" }, { iss: "http://evil.example" }, { expired: true }, { wrongKey: true }, { noIdToken: true }]) {
      provider.tamper = tamper;
      const { callback } = await signInFlow(db);
      assert.equal(ssoError(callback), "verify", JSON.stringify(tamper));
      assert.ok(!/ribbon_session=[^;]/.test((callback.headers.getSetCookie?.() ?? []).join(";")), JSON.stringify(tamper));
    }
  });

  test("a provider on plain http outside the private network is refused", async () => {
    const db = freshDb();
    process.env.OIDC_ISSUER = "http://idp.example.com";
    const start = await handleApi(new Request(`${BASE}/api/auth/oidc/start`), db);
    assert.equal(ssoError(start), "provider");
  });

  test("linking from Settings: needs a session, can't take another user's identity; unlink keeps a way in", async () => {
    const db = freshDb();
    const avery = signedIn(db, { username: "avery" });
    const noah = signedIn(db, { username: "noah", role: "member" });
    // starting a link while signed out fails
    const anon = await handleApi(new Request(`${BASE}/api/auth/oidc/start?link=1`), db);
    assert.equal(ssoError(anon), "session");
    const { callback } = await signInFlow(db, { link: true, auth: avery });
    assert.equal(new URL(callback.headers.get("location")!, BASE).pathname, "/settings");
    assert.equal(db.prepare("SELECT user_id FROM oidc_identities WHERE subject = 'user-1'").get()?.user_id, avery.id);
    assert.equal((await call(db, "GET", "/api/session", undefined, avery)).body.sso.linked, true);
    // Noah can't claim Avery's identity
    assert.equal(ssoError((await signInFlow(db, { link: true, auth: noah })).callback), "taken");
    // sign-in now works for Avery
    assert.equal(await signedInAs(db, cookieJar((await signInFlow(db)).callback)), "avery");
    // unlink
    assert.equal((await call(db, "DELETE", "/api/me/sso", undefined, avery)).status, 200);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM oidc_identities").get()?.n, 0);
  });

  test("SSO-only accounts can't unlink their only way in; DISABLE_PASSWORD_LOGIN only counts when SSO is configured", async () => {
    const db = freshDb();
    const owner = signedIn(db, { username: "avery" });
    const sso = createUser(db, { username: "noah", role: "member", passwordHash: "!", householdId: owner.householdId });
    linked(db, sso.id, "noah-sub");
    // sign in as the SSO-only user to get a session
    provider.profile = { sub: "noah-sub", email: "noah@example.com", email_verified: true };
    const { callback } = await signInFlow(db);
    const cookie = cookieJar(callback);
    assert.equal(await signedInAs(db, cookie), "noah");
    const session = (await call(db, "GET", "/api/session", undefined, { cookie, csrf: "" })).body;
    assert.equal((await call(db, "DELETE", "/api/me/sso", undefined, { cookie, csrf: session.csrfToken })).status, 409);
    // the passwordless login can't use the password form
    const attempt = await call(db, "POST", "/api/login", { username: "noah", password: "!" });
    assert.equal(attempt.status, 401);
    // password sign-in off
    process.env.DISABLE_PASSWORD_LOGIN = "true";
    assert.equal((await call(db, "POST", "/api/login", { username: "avery", password: "correct horse battery" })).status, 403);
    assert.equal((await call(db, "GET", "/api/session")).body.sso.passwordDisabled, true);
    delete process.env.OIDC_ISSUER;
    assert.equal((await call(db, "POST", "/api/login", { username: "avery", password: "correct horse battery" })).status, 200);
  });
});

describe("hardening", () => {
  test("starting sign-in is rate limited per address", async () => {
    const db = freshDb();
    let last: Response | undefined;
    for (let i = 0; i < 31; i += 1) last = await handleApi(new Request(`${BASE}/api/auth/oidc/start`), db);
    assert.equal(last!.status, 302);
    assert.match(last!.headers.get("location")!, /sso_error=provider/);
    assert.ok(!last!.headers.get("location")!.startsWith(provider.issuer), "no provider redirect once over the limit");
  });

  test("a discovery document that names a plain-HTTP public endpoint is refused", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => {
      const self = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ issuer: self, authorization_endpoint: `${self}/auth`, token_endpoint: "http://8.8.8.8/token", jwks_uri: `${self}/jwks` }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      process.env.OIDC_ISSUER = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      resetOidcCaches();
      const start = await handleApi(new Request(`${BASE}/api/auth/oidc/start`), freshDb());
      assert.match(start.headers.get("location")!, /sso_error=provider/);
    } finally {
      server.close();
    }
  });
});
