// Passkeys (WebAuthn) as a second way to sign in. Registration happens in Settings; sign-in needs no username.
import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { publicUrl } from "./config.ts";
import type { Db } from "./db.ts";
import { error, json, readJson, type Handler, type PublicHandler } from "./http.ts";
import { clientAddress, requestHost, requestScheme } from "./security.ts";
import { clearMisses, getUser, lockedFor, recordMiss } from "./users.ts";

const CHALLENGE_MS = 5 * 60 * 1000;
const MAX_PASSKEYS = 10;

/** Relying party: the host (without port) people see, and the exact origin the browser reports. */
export function relyingParty(request: Request): { rpID: string; origin: string; name: string } {
  const pub = publicUrl();
  let host = requestHost(request);
  let scheme: string = requestScheme(request);
  if (pub) {
    try {
      const url = new URL(pub);
      if (url.host === host) {
        host = url.host;
        scheme = url.protocol.replace(":", "");
      }
    } catch {
      /* ignore a bad PUBLIC_URL */
    }
  }
  return { rpID: host.replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1"), origin: `${scheme}://${host}`, name: "Ribbon" };
}

function saveChallenge(db: Db, kind: "register" | "login", challenge: string, userId: string | null): string {
  const id = randomBytes(18).toString("base64url");
  db.prepare("DELETE FROM webauthn_challenges WHERE created_at < ?").run(Date.now() - CHALLENGE_MS);
  db.prepare("INSERT INTO webauthn_challenges (id, kind, user_id, challenge, created_at) VALUES (?, ?, ?, ?, ?)").run(id, kind, userId, challenge, Date.now());
  return id;
}

/** Challenges are single use. */
function takeChallenge(db: Db, id: unknown, kind: "register" | "login", userId: string | null): string | null {
  if (typeof id !== "string") return null;
  const row = db.prepare("SELECT challenge, user_id, created_at FROM webauthn_challenges WHERE id = ? AND kind = ?").get(id, kind) as
    | { challenge: string; user_id: string | null; created_at: number }
    | undefined;
  db.prepare("DELETE FROM webauthn_challenges WHERE id = ?").run(id);
  if (!row || Date.now() - row.created_at > CHALLENGE_MS || row.user_id !== userId) return null;
  return row.challenge;
}

type CredRow = { id: string; user_id: string; public_key: Uint8Array; counter: number; transports: string; name: string; created_at: string; last_used_at: string | null };

const toTransports = (value: string) => (value ? (value.split(",") as AuthenticatorTransport[]) : undefined);

export function listPasskeys(db: Db, userId: string) {
  return (db.prepare("SELECT id, name, created_at, last_used_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at").all(userId) as CredRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
}

export const passkeyPublicHandler: PublicHandler = async (c) => {
  if (c.resource !== "auth" || c.id !== "passkey") return null;
  const rp = relyingParty(c.request);

  if (c.method === "GET" && c.rest[0] === "options") {
    const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "preferred", timeout: 120_000 });
    return json({ options, challengeId: saveChallenge(c.db, "login", options.challenge, null) });
  }

  if (c.method === "POST" && c.rest[0] === "login") {
    const parsed = await readJson(c.request);
    if (!parsed.ok) return parsed.response;
    const body = (parsed.value ?? {}) as { challengeId?: unknown; response?: AuthenticationResponseJSON };
    const address = clientAddress(c.request);
    if (lockedFor("passkey", address) > 0) return error(429, "Too many tries. Wait a few minutes and try again.");
    const challenge = takeChallenge(c.db, body.challengeId, "login", null);
    const response = body.response;
    const fail = () => {
      recordMiss("passkey", address);
      return error(401, "That passkey didn’t work. Try again, or use your password.");
    };
    if (!challenge || !response || typeof response.id !== "string") return fail();
    const row = c.db.prepare("SELECT id, user_id, public_key, counter, transports FROM webauthn_credentials WHERE id = ?").get(response.id) as CredRow | undefined;
    if (!row || !getUser(c.db, row.user_id)) return fail();
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: false,
        credential: { id: row.id, publicKey: new Uint8Array(row.public_key), counter: row.counter, transports: toTransports(row.transports) },
      });
      if (!result.verified) return fail();
      c.db.prepare("UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE id = ?").run(result.authenticationInfo.newCounter, new Date().toISOString(), row.id);
    } catch (err) {
      console.error("[ribbon] passkey sign-in failed:", err instanceof Error ? err.message : err);
      return fail();
    }
    clearMisses("passkey", address);
    // loaded lazily: api.ts imports this module through features.ts
    const { startSession } = await import("./api.ts");
    return startSession(c.db, row.user_id, c.request);
  }
  return null;
};

export const passkeyHandler: Handler = async (c) => {
  if (c.resource !== "me" || c.id !== "passkeys") return null;
  const user = c.session.user;
  const rp = relyingParty(c.request);

  if (c.method === "GET" && c.rest.length === 0) return json({ passkeys: listPasskeys(c.db, user.id) });

  if (c.method === "POST" && c.rest[0] === "options") {
    if (listPasskeys(c.db, user.id).length >= MAX_PASSKEYS) return error(409, `You can register up to ${MAX_PASSKEYS} passkeys.`);
    const existing = c.db.prepare("SELECT id, transports FROM webauthn_credentials WHERE user_id = ?").all(user.id) as { id: string; transports: string }[];
    const options = await generateRegistrationOptions({
      rpName: rp.name,
      rpID: rp.rpID,
      userName: user.username,
      userDisplayName: user.displayName,
      userID: new TextEncoder().encode(user.id),
      attestationType: "none",
      excludeCredentials: existing.map((e) => ({ id: e.id, transports: toTransports(e.transports) })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      timeout: 120_000,
    });
    return json({ options, challengeId: saveChallenge(c.db, "register", options.challenge, user.id) });
  }

  if (c.method === "POST" && c.rest.length === 0) {
    const body = (c.body ?? {}) as { challengeId?: unknown; response?: RegistrationResponseJSON; name?: unknown };
    const challenge = takeChallenge(c.db, body.challengeId, "register", user.id);
    if (!challenge || !body.response) return error(400, "That passkey request expired. Try again.");
    try {
      const result = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: false,
      });
      if (!result.verified || !result.registrationInfo) return error(400, "That passkey couldn’t be verified.");
      const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
      if (c.db.prepare("SELECT 1 FROM webauthn_credentials WHERE id = ?").get(credential.id)) return error(409, "That passkey is already registered.");
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 40) : `Passkey ${listPasskeys(c.db, user.id).length + 1}`;
      c.db
        .prepare(
          `INSERT INTO webauthn_credentials (id, user_id, public_key, counter, transports, name, device_type, backed_up, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(credential.id, user.id, credential.publicKey, credential.counter, (credential.transports ?? []).join(","), name, credentialDeviceType, credentialBackedUp ? 1 : 0, new Date().toISOString());
      return json({ passkeys: listPasskeys(c.db, user.id) }, { status: 201 });
    } catch (err) {
      console.error("[ribbon] passkey registration failed:", err instanceof Error ? err.message : err);
      return error(400, "That passkey couldn’t be verified.");
    }
  }

  if (c.method === "DELETE" && c.rest.length === 1) {
    const credId = decodeURIComponent(c.rest[0]!);
    const mine = c.db.prepare("SELECT 1 FROM webauthn_credentials WHERE id = ? AND user_id = ?").get(credId, user.id);
    if (!mine) return error(404, "That passkey is gone.");
    const count = listPasskeys(c.db, user.id).length;
    const hasPassword = (c.db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as { password_hash: string }).password_hash !== "!";
    const hasSso = Boolean(c.db.prepare("SELECT 1 FROM oidc_identities WHERE user_id = ?").get(user.id));
    if (count <= 1 && !hasPassword && !hasSso) return error(409, "That’s your only way to sign in. Set a password first.");
    c.db.prepare("DELETE FROM webauthn_credentials WHERE id = ?").run(credId);
    return json({ passkeys: listPasskeys(c.db, user.id) });
  }
  return null;
};
