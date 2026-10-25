// Single sign-on with OpenID Connect: authorization-code flow with PKCE, state and nonce.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { oidcConfig, passwordLoginDisabled, publicUrl, type OidcConfig } from "./config.ts";
import { readCookie, sessionCookie } from "./cookies.ts";
import type { Db } from "./db.ts";
import { error, json, type Handler, type PublicHandler } from "./http.ts";
import { isPrivateAddress, isSecureRequest, requestHost, requestScheme } from "./security.ts";
import { createSession, getUser } from "./users.ts";

const FLOW_MS = 10 * 60 * 1000;
const FLOW_COOKIE = "ribbon_oidc";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const b64url = (buf: Buffer) => buf.toString("base64url");

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
};

const discoveryCache = new Map<string, { at: number; meta: Discovery }>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export const resetOidcCaches = () => {
  discoveryCache.clear();
  jwksCache.clear();
};

/** HTTPS is required for the provider, except on a loopback or private address (or OIDC_ALLOW_HTTP_ISSUER=true). */
function issuerProblem(issuer: string): string | null {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return "OIDC_ISSUER is not a valid URL.";
  }
  if (url.protocol === "https:") return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const local = host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":") ? isPrivateAddress(host === "localhost" ? "127.0.0.1" : host) : false;
  if (url.protocol === "http:" && (local || /^(1|true|yes|on)$/i.test(process.env.OIDC_ALLOW_HTTP_ISSUER ?? ""))) return null;
  return "OIDC_ISSUER must be an https:// address (or set OIDC_ALLOW_HTTP_ISSUER=true for a provider on your own network).";
}

async function discover(cfg: OidcConfig): Promise<Discovery> {
  const cached = discoveryCache.get(cfg.issuer);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.meta;
  const problem = issuerProblem(cfg.issuer);
  if (problem) throw new Error(problem);
  const response = await fetch(`${cfg.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Provider discovery failed (${response.status}).`);
  const meta = (await response.json()) as Discovery;
  if (meta.issuer?.replace(/\/+$/, "") !== cfg.issuer) throw new Error("The provider's issuer does not match OIDC_ISSUER.");
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
    if (typeof meta[key] !== "string") throw new Error(`The provider's discovery document has no ${key}.`);
  }
  discoveryCache.set(cfg.issuer, { at: Date.now(), meta });
  return meta;
}

/** Where the provider sends people back: PUBLIC_URL when set, otherwise the address they used. */
export function redirectUri(request: Request): string {
  const pub = publicUrl();
  const base = pub ?? `${requestScheme(request)}://${requestHost(request)}`;
  return `${base}/api/auth/oidc/callback`;
}

export function oidcSummary(db: Db, userId?: string) {
  const cfg = oidcConfig();
  if (!cfg) return { enabled: false };
  const linked = userId ? Boolean(db.prepare("SELECT 1 FROM oidc_identities WHERE user_id = ? AND issuer = ?").get(userId, cfg.issuer)) : false;
  return { enabled: true, label: cfg.buttonLabel, passwordDisabled: passwordLoginDisabled(), linked };
}

const redirect = (to: string, headers: Record<string, string> = {}, cookies: string[] = []) => {
  const h = new Headers({ location: to, "cache-control": "no-store", ...headers });
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(null, { status: 302, headers: h });
};
const failure = (code: string, secure: boolean, link = false) =>
  redirect(`${link ? "/settings?tab=account&" : "/?"}sso_error=${code}`, {}, [clearFlowCookie(secure)]);

function flowCookie(state: string, secure: boolean) {
  return `${FLOW_COOKIE}=${state}; Path=/api/auth/oidc; HttpOnly; SameSite=Lax; Max-Age=${FLOW_MS / 1000}${secure ? "; Secure" : ""}`;
}
const clearFlowCookie = (secure: boolean) => `${FLOW_COOKIE}=; Path=/api/auth/oidc; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

type Claims = { sub: string; email?: string; email_verified?: boolean | string; name?: string; preferred_username?: string; nonce?: string };

async function exchange(cfg: OidcConfig, meta: Discovery, code: string, verifier: string, redirectUriValue: string) {
  const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUriValue, code_verifier: verifier });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (cfg.clientSecret) {
    const methods = meta.token_endpoint_auth_methods_supported;
    if (!methods || methods.includes("client_secret_basic")) {
      headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString("base64")}`;
    } else {
      form.set("client_id", cfg.clientId);
      form.set("client_secret", cfg.clientSecret);
    }
  } else form.set("client_id", cfg.clientId);
  const response = await fetch(meta.token_endpoint, { method: "POST", headers, body: form, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Token exchange failed (${response.status}).`);
  return (await response.json()) as { id_token?: string; access_token?: string };
}

async function verifyIdToken(cfg: OidcConfig, meta: Discovery, idToken: string, nonce: string): Promise<Claims> {
  let jwks = jwksCache.get(meta.jwks_uri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(meta.jwks_uri), { timeoutDuration: 10_000, cooldownDuration: 30_000 });
    jwksCache.set(meta.jwks_uri, jwks);
  }
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: meta.issuer,
    audience: cfg.clientId,
    // asymmetric algorithms only: never "none" and never an HMAC keyed by a public value
    algorithms: ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"],
    clockTolerance: 30,
  });
  const claims = payload as unknown as Claims;
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("The ID token has no subject.");
  const a = Buffer.from(String(claims.nonce ?? ""));
  const b = Buffer.from(nonce);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("The ID token nonce does not match.");
  return claims;
}

function findUserForClaims(db: Db, cfg: OidcConfig, claims: Claims): { userId: string } | { error: string } {
  const known = db.prepare("SELECT user_id FROM oidc_identities WHERE issuer = ? AND subject = ?").get(cfg.issuer, claims.sub) as { user_id: string } | undefined;
  if (known && getUser(db, known.user_id)) return { userId: known.user_id };
  const verified = claims.email_verified === true || claims.email_verified === "true";
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (cfg.autoLinkByEmail && email && verified) {
    const matches = db.prepare("SELECT id FROM users WHERE lower(email) = ?").all(email) as { id: string }[];
    if (matches.length === 1) {
      db.prepare("INSERT OR REPLACE INTO oidc_identities (issuer, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)").run(cfg.issuer, claims.sub, matches[0]!.id, email, new Date().toISOString());
      return { userId: matches[0]!.id };
    }
  }
  return { error: "nolink" };
}

export const oidcPublicHandler: PublicHandler = async (c) => {
  if (c.resource !== "auth" || c.id !== "oidc" || c.method !== "GET" || c.rest.length !== 1) return null;
  const cfg = oidcConfig();
  const secure = isSecureRequest(c.request);
  if (!cfg) return error(404, "Single sign-on is not set up.");
  const step = c.rest[0];

  if (step === "start") {
    const link = c.url.searchParams.get("link") === "1";
    if (link && !c.session) return failure("session", secure);
    try {
      const meta = await discover(cfg);
      const state = b64url(randomBytes(24));
      const nonce = b64url(randomBytes(24));
      const verifier = b64url(randomBytes(48));
      const uri = redirectUri(c.request);
      c.db.prepare("DELETE FROM oidc_flows WHERE created_at < ?").run(Date.now() - FLOW_MS);
      c.db.prepare("INSERT INTO oidc_flows (state_hash, nonce, verifier, redirect_uri, link_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
        sha(state), nonce, verifier, uri, link ? c.session!.user.id : null, Date.now(),
      );
      const auth = new URL(meta.authorization_endpoint);
      auth.searchParams.set("response_type", "code");
      auth.searchParams.set("client_id", cfg.clientId);
      auth.searchParams.set("redirect_uri", uri);
      auth.searchParams.set("scope", cfg.scopes);
      auth.searchParams.set("state", state);
      auth.searchParams.set("nonce", nonce);
      auth.searchParams.set("code_challenge", b64url(createHash("sha256").update(verifier).digest()));
      auth.searchParams.set("code_challenge_method", "S256");
      return redirect(auth.toString(), {}, [flowCookie(state, secure)]);
    } catch (err) {
      console.error("[ribbon] sso start failed:", err instanceof Error ? err.message : err);
      return failure("provider", secure, link);
    }
  }

  if (step === "callback") {
    const q = c.url.searchParams;
    const state = q.get("state") ?? "";
    const row = state
      ? (c.db.prepare("SELECT nonce, verifier, redirect_uri, link_user_id, created_at FROM oidc_flows WHERE state_hash = ?").get(sha(state)) as
          | { nonce: string; verifier: string; redirect_uri: string; link_user_id: string | null; created_at: number }
          | undefined)
      : undefined;
    const link = Boolean(row?.link_user_id);
    if (state) c.db.prepare("DELETE FROM oidc_flows WHERE state_hash = ?").run(sha(state)); // single use
    const cookie = readCookie(c.request, FLOW_COOKIE) ?? "";
    const same = cookie.length === state.length && cookie.length > 0 && timingSafeEqual(Buffer.from(cookie), Buffer.from(state));
    if (!row || !same || Date.now() - row.created_at > FLOW_MS) return failure("state", secure);
    if (q.get("error")) return failure("denied", secure, link);
    const code = q.get("code");
    if (!code) return failure("state", secure, link);
    try {
      const meta = await discover(cfg);
      const tokens = await exchange(cfg, meta, code, row.verifier, row.redirect_uri);
      if (!tokens.id_token) throw new Error("The provider returned no ID token.");
      const claims = await verifyIdToken(cfg, meta, tokens.id_token, row.nonce);
      if (!claims.email && meta.userinfo_endpoint && tokens.access_token) {
        const info = await fetch(meta.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10_000) });
        if (info.ok) {
          const profile = (await info.json()) as Claims;
          if (profile.sub === claims.sub) Object.assign(claims, { email: profile.email, email_verified: profile.email_verified });
        }
      }
      if (row.link_user_id) {
        const owner = c.db.prepare("SELECT user_id FROM oidc_identities WHERE issuer = ? AND subject = ?").get(cfg.issuer, claims.sub) as { user_id: string } | undefined;
        if (owner && owner.user_id !== row.link_user_id) return failure("taken", secure, true);
        if (!c.session || c.session.user.id !== row.link_user_id) return failure("session", secure, true);
        c.db.prepare("INSERT OR REPLACE INTO oidc_identities (issuer, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)").run(
          cfg.issuer, claims.sub, row.link_user_id, typeof claims.email === "string" ? claims.email : null, new Date().toISOString(),
        );
        return redirect("/settings?tab=account&sso=linked", {}, [clearFlowCookie(secure)]);
      }
      const found = findUserForClaims(c.db, cfg, claims);
      if ("error" in found) return failure(found.error, secure);
      const made = createSession(c.db, found.userId);
      return redirect("/", {}, [sessionCookie(made.token, secure), clearFlowCookie(secure)]);
    } catch (err) {
      console.error("[ribbon] sso callback failed:", err instanceof Error ? err.message : err);
      return failure("verify", secure, link);
    }
  }
  return null;
};

/** Signed-in management: see and remove the SSO link. */
export const oidcHandler: Handler = (c) => {
  if (c.resource === "me" && c.id === "sso" && c.method === "DELETE") {
    const hasOther =
      (c.db.prepare("SELECT password_hash FROM users WHERE id = ?").get(c.session.user.id) as { password_hash: string }).password_hash !== "!" ||
      Boolean(c.db.prepare("SELECT 1 FROM webauthn_credentials WHERE user_id = ?").get(c.session.user.id));
    if (!hasOther) return error(409, "That’s your only way to sign in. Set a password or add a passkey first.");
    if (passwordLoginDisabled() && !c.db.prepare("SELECT 1 FROM webauthn_credentials WHERE user_id = ?").get(c.session.user.id)) {
      return error(409, "Password sign-in is turned off on this server, so SSO is your only way in.");
    }
    c.db.prepare("DELETE FROM oidc_identities WHERE user_id = ?").run(c.session.user.id);
    return json({ ok: true });
  }
  return null;
};
