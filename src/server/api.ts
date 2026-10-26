// The whole JSON API as one Request -> Response function, so the same code runs
// behind the TanStack Start route and in the tests. Feature modules (wishlists, budgets,
// backups, ...) plug in through the two handler lists at the bottom of this file.
import { randomUUID } from "node:crypto";
import type { Person } from "../lib/gifts/model.ts";
import { seedSampleCalendars } from "./calendar-sample.ts";
import { passwordLoginDisabled, seedSampleData, setupCode } from "./config.ts";
import { createHash, timingSafeEqual } from "node:crypto";
import { clearCookies, readSessionToken, sessionCookie } from "./cookies.ts";
import { getDb, type Db } from "./db.ts";
import { error, json, readJson, decode, type ApiCall, type Handler, type PublicCall, type PublicHandler } from "./http.ts";
import { ledgerHandler } from "./routes-ledger.ts";
import { burnUnlessHash, hashPassword, passwordNeedsRehash, passwordProblem, verifyPassword } from "./password.ts";
import { throttle } from "./ratelimit.ts";
import { clientAddress, insecureLoginReason, isPrivateAddress, isSecureRequest, originAllowed, setupRefusedReason } from "./security.ts";
import {
  clearMisses,
  createSession,
  createUser,
  csrfMatches,
  destroySession,
  destroyUserSessions,
  findUserByName,
  getPasswordHash,
  getUser,
  listUsers,
  lockedFor,
  normalizeUsername,
  readSession,
  recordMiss,
  removeUser,
  setPasswordHash,
  setUserPerson,
  userCount,
  type Role,
  type Session,
} from "./users.ts";
import { isInstanceAdmin } from "./backup.ts";
import { versionInfo } from "./version.ts";
import { createHousehold, firstHouseholdId, getPerson, hasHousehold, householdRow, type Ctx } from "./ledger.ts";
import { extraSessionFields, extraPublicHandlers, extraHandlers } from "./features.ts";
import { allowedDuringWelcome, readMembers, welcomeHandler, welcomePending } from "./welcome.ts";

export { readSessionToken } from "./cookies.ts";

export function sessionPayload(db: Db, session: Session | null, request: Request) {
  const setupRequired = userCount(db) === 0;
  const hasLedger = hasHousehold(db);
  const firstHid = firstHouseholdId(db);
  const household = session ? householdRow(db, session.user.householdId) : undefined;
  return {
    ...versionInfo(),
    setupRequired,
    // After an upgrade the household already exists; setup then only creates the owner login.
    hasLedger,
    householdName: setupRequired && hasLedger && firstHid ? (householdRow(db, firstHid)?.name ?? null) : null,
    setupCodeRequired: setupRequired && Boolean(setupCode()),
    // Set when the first owner can't be created from this connection (no SETUP_CODE and not on the home network).
    setupBlocked: setupRequired ? setupRefusedReason(request) : null,
    secure: isSecureRequest(request),
    insecureLoginBlocked: insecureLoginReason(request),
    privateNetwork: isPrivateAddress(clientAddress(request)),
    sampleData: seedSampleData(),
    authed: Boolean(session),
    user: session?.user ?? null,
    household: household ? { id: household.id, name: household.name } : null,
    // An owner whose household has not finished the Welcome setup is sent there (and the server holds the rest of the API closed).
    welcomeRequired: session ? welcomePending(db, session.user) : false,
    csrfToken: session?.csrfToken ?? null,
    ...extraSessionFields(db, session, request),
  };
}

/** The signed-in session for a request (used by server functions outside /api), or null. */
export function requestSession(request: Request, db?: Db): Session | null {
  return readSession(db ?? getDb(), readSessionToken(request));
}

const PUBLIC_HANDLERS: PublicHandler[] = [...extraPublicHandlers];
const HANDLERS: Handler[] = [accountHandler, welcomeHandler, ...extraHandlers, ledgerHandler];

/** Used by sign-in flows (password, SSO, passkey) once the person is verified. */
export function startSession(db: Db, userId: string, request: Request, extra: Record<string, unknown> = {}) {
  const made = createSession(db, userId);
  const fresh = readSession(db, made.token, Date.now());
  return json(
    { ...sessionPayload(db, fresh, request), ...extra },
    { cookie: sessionCookie(made.token, isSecureRequest(request)) },
  );
}

export async function handleApi(request: Request, db?: Db): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean); // ["api", ...]
  if (parts[0] !== "api") return error(404, "Not found.");
  const [, resource, rawId, ...rest] = parts;
  const write = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";

  try {
    // Health is open and never needs the database to be signed in to.
    if (resource === "health" && method === "GET" && !rawId) {
      (db ?? getDb()).prepare("SELECT 1").get();
      return json({ ok: true, ...versionInfo() });
    }

    if (write && !originAllowed(request)) return error(403, "Cross-site request blocked.");

    const store = db ?? getDb();
    const secure = isSecureRequest(request);
    const token = readSessionToken(request);
    const session = readSession(store, token);
    const id = rawId === undefined ? undefined : decode(rawId);
    if (id === null) return error(400, "Bad id in the address.");

    // ---- endpoints that work before sign-in ----
    if (resource === "session" && method === "GET" && !rawId) return json(sessionPayload(store, session, request));

    if (resource === "setup" && method === "POST" && !rawId) return setup(store, request, secure);
    if (resource === "login" && method === "POST" && !rawId) return login(store, request);

    const pub: PublicCall = { request, url, method, db: store, session, resource, id, rest, secure };
    for (const handler of PUBLIC_HANDLERS) {
      const response = await handler(pub);
      if (response) return response;
    }

    // ---- everything below needs a session, and writes need the CSRF token ----
    if (!session) return error(401, "Sign in required.");
    if (write && !csrfMatches(session.csrfToken, request.headers.get("x-csrf-token"))) {
      return error(403, "Your page is out of date. Reload and try again.");
    }

    if (resource === "logout" && method === "POST") {
      destroySession(store, token);
      const response = json({ ok: true });
      for (const cookie of clearCookies()) response.headers.append("set-cookie", cookie);
      return response;
    }

    if (welcomePending(store, session.user) && !allowedDuringWelcome(resource, id, method)) {
      return json({ error: "Finish the welcome setup first.", code: "welcome_setup_required" }, { status: 409 });
    }

    // JSON bodies are read for the usual write verbs; feature modules that take raw bytes read the request themselves.
    let body: unknown = {};
    if ((method === "POST" || method === "PUT" || method === "PATCH") && !RAW_BODY.has(`${resource}/${id}`)) {
      const parsed = await readJson(request);
      if (!parsed.ok) return parsed.response;
      body = parsed.value;
    }

    const ctx: Ctx = { db: store, hid: session.user.householdId, me: session.user.personId };
    const call: ApiCall = {
      request,
      url,
      method,
      db: store,
      session,
      ctx,
      resource,
      id,
      rest,
      body,
      isOwner: session.user.role === "owner",
    };
    for (const handler of HANDLERS) {
      const response = await handler(call);
      if (response) return response;
    }
    return error(resource ? 405 : 404, resource ? "That method is not allowed here." : "Not found.");
  } catch (err) {
    console.error("[ribbon] api error:", err instanceof Error ? err.stack ?? err.message : err);
    return error(500, "Something went wrong on the server.");
  }
}

/** Endpoints whose body is not JSON (the feature module reads it). */
const RAW_BODY = new Set(["backups/restore-upload"]);

// ---- sign-in ----

async function setup(store: Db, request: Request, secure: boolean): Promise<Response> {
  void secure;
  if (userCount(store) > 0) return error(409, "Ribbon is already set up. Sign in instead.");
  const refused = insecureLoginReason(request) ?? setupRefusedReason(request);
  if (refused) return error(403, refused);
  // A guessable setup code is only as good as the brake on guessing it.
  if (throttle(`setup:${clientAddress(request)}`, 10, 15 * 60 * 1000) > 0) {
    return error(429, "Too many tries. Wait a few minutes and try again.");
  }
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.value ?? {}) as {
    setupCode?: unknown;
    familyName?: unknown;
    yourName?: unknown;
    people?: unknown;
    username?: unknown;
    password?: unknown;
  };
  const code = setupCode();
  if (code && (typeof body.setupCode !== "string" || !sameSecret(body.setupCode.trim(), code))) {
    return error(403, "That setup code is not right.");
  }
  const username = normalizeUsername(body.username);
  if (!username) return error(400, "Pick a username of 3 or more letters or numbers (an email works too).");
  const problem = passwordProblem(body.password, username);
  if (problem) return error(400, problem);
  const existingHid = firstHouseholdId(store);
  const yourName = typeof body.yourName === "string" ? body.yourName.trim().slice(0, 80) : "";
  const passwordHash = await hashPassword(body.password as string);
  // Hashing took a moment: make sure nobody else finished setup meanwhile. Everything below is synchronous.
  if (userCount(store) > 0) return error(409, "Ribbon is already set up. Sign in instead.");
  if (existingHid) {
    // An upgrade from before accounts: the household already exists, only the owner login is missing.
    const owner = createUser(store, { username, displayName: yourName || username, role: "owner", passwordHash, householdId: existingHid });
    if (seedSampleData()) seedSampleCalendars(store, owner); // the sample household comes with sample calendar events
    return startSessionWith(store, owner.id, request, 201);
  }
  const selfId = randomUUID();
  let hid: string;
  if (body.familyName !== undefined) {
    // Optional, for scripts: a caller that already knows the family can skip the Welcome setup.
    const familyName = typeof body.familyName === "string" ? body.familyName.trim().slice(0, 80) : "";
    if (!familyName) return error(400, "Give your family a name.");
    const members = readMembers(body.people);
    if (typeof members === "string") return error(400, members);
    const people: Person[] = [
      { id: selfId, name: yourName || username, role: "You", relationship: "self", circle: "household" },
      ...members,
    ];
    hid = createHousehold(store, familyName, people);
  } else {
    // The normal first visit: just the owner. The Welcome setup after the first sign-in collects the rest.
    hid = createHousehold(store, "", [{ id: selfId, name: yourName || username, role: "You", relationship: "self", circle: "household" }], { pendingSetup: true });
  }
  const owner = createUser(store, { username, displayName: yourName || username, role: "owner", passwordHash, householdId: hid, personId: selfId });
  return startSessionWith(store, owner.id, request, 201);
}

/** Constant-time comparison (both sides are hashed first so their lengths don't leak). */
function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function startSessionWith(store: Db, userId: string, request: Request, status = 200): Response {
  const made = createSession(store, userId);
  const fresh = readSession(store, made.token);
  return json(sessionPayload(store, fresh, request), {
    status,
    cookie: sessionCookie(made.token, isSecureRequest(request)),
  });
}

async function login(store: Db, request: Request): Promise<Response> {
  const refused = insecureLoginReason(request);
  if (refused) return error(403, refused);
  if (passwordLoginDisabled()) return error(403, "Password sign-in is turned off. Use single sign-on.");
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.value ?? {}) as { username?: unknown; password?: unknown };
  const username = normalizeUsername(body.username) ?? "invalid";
  const address = clientAddress(request);
  const wait = lockedFor(username, address);
  if (wait > 0) {
    const response = error(429, "Too many tries. Wait a few minutes and try again.");
    response.headers.set("retry-after", String(wait));
    return response;
  }
  const row = username === "invalid" ? undefined : findUserByName(store, username);
  const password = typeof body.password === "string" ? body.password.slice(0, 400) : "";
  const hash = row?.password_hash;
  // Unknown names and single-sign-on-only logins ("!") burn one hash too, so timing doesn't tell them apart.
  const ok = await burnUnlessHash(password, hash);
  if (!row || !ok) {
    recordMiss(username, address);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return error(401, "Incorrect username or password.");
  }
  clearMisses(username, address);
  // Hashes made with older, cheaper settings are upgraded now that the plaintext is in hand.
  if (hash && passwordNeedsRehash(hash)) setPasswordHash(store, row.id, await hashPassword(password));
  return startSessionWith(store, row.id, request);
}


// ---- account, logins ----

async function accountHandler(c: ApiCall): Promise<Response | null> {
  const { db, session, method, id, rest, body, resource } = c;

  if (resource === "account" && id === "password" && method === "POST" && rest.length === 0) {
    const { current, next } = (body ?? {}) as { current?: unknown; next?: unknown };
    const hash = getPasswordHash(db, session.user.id);
    if (typeof current !== "string" || !hash || !(await verifyPassword(current, hash))) {
      return error(400, "Your current password is not right.");
    }
    const problem = passwordProblem(next, session.user.username);
    if (problem) return error(400, problem);
    setPasswordHash(db, session.user.id, await hashPassword(next as string));
    destroyUserSessions(db, session.user.id, session.sessionId);
    return json({ ok: true });
  }

  if (resource === "me" && id === "person" && method === "PUT") {
    // "This is me": hides surprises planned for that person from this login. Setting it is a one-way door
    // for the person themselves (otherwise anyone could unset it to peek); another owner can change it.
    const { personId } = (body ?? {}) as { personId?: unknown };
    if (session.user.personId) return error(409, "Your login is already linked. Ask another owner to change it.");
    if (typeof personId !== "string" || !getPerson(c.ctx, personId)) return error(400, "Pick a person from your household.");
    const taken = db.prepare("SELECT 1 FROM users WHERE person_id = ?").get(personId);
    if (taken) return error(409, "Another login is already linked to that person.");
    setUserPerson(db, session.user.id, personId);
    return json({ user: getUser(db, session.user.id) });
  }

  if (resource === "users" && rest.length === 0) {
    if (!c.isOwner) return error(403, "Only an owner can manage logins.");
    const hid = session.user.householdId;
    if (method === "GET" && id === undefined) return json({ users: listUsers(db, hid) });
    if (method === "POST" && id === undefined) {
      const input = (body ?? {}) as {
        username?: unknown;
        password?: unknown;
        displayName?: unknown;
        role?: unknown;
        personId?: unknown;
        email?: unknown;
      };
      const username = normalizeUsername(input.username);
      if (!username) return error(400, "Pick a username of 3 or more letters or numbers (an email works too).");
      const noPassword = input.password === undefined || input.password === "";
      if (noPassword && !process.env.OIDC_ISSUER?.trim()) return error(400, "Enter a password.");
      if (!noPassword) {
        const problem = passwordProblem(input.password, username);
        if (problem) return error(400, problem);
      }
      if (findUserByName(db, username)) return error(409, "That username is taken.");
      const role: Role = input.role === "owner" ? "owner" : "member";
      let personId: string | null = null;
      if (typeof input.personId === "string" && input.personId) {
        if (!getPerson(c.ctx, input.personId)) return error(400, "Pick a person from your household.");
        if (db.prepare("SELECT 1 FROM users WHERE person_id = ?").get(input.personId)) {
          return error(409, "Another login is already linked to that person.");
        }
        personId = input.personId;
      }
      const email = typeof input.email === "string" && /^[^@\s]+@[^@\s]+$/.test(input.email.trim()) ? input.email.trim().toLowerCase() : null;
      // A login with no password can only sign in through single sign-on.
      const passwordHash = noPassword ? "!" : await hashPassword(input.password as string);
      const user = createUser(db, {
        username,
        displayName: typeof input.displayName === "string" ? input.displayName : undefined,
        role,
        passwordHash,
        householdId: hid,
        personId,
        email,
      });
      return json({ user }, { status: 201 });
    }
    if (method === "PATCH" && id !== undefined) {
      const target = getUser(db, id);
      if (!target || target.householdId !== hid) return error(404, "That login is gone.");
      const input = (body ?? {}) as { personId?: unknown; role?: unknown; displayName?: unknown };
      if (input.personId !== undefined) {
        if (target.id === session.user.id && target.personId) {
          return error(409, "Ask another owner to change your own link.");
        }
        if (input.personId === null || input.personId === "") setUserPerson(db, id, null);
        else {
          if (typeof input.personId !== "string" || !getPerson(c.ctx, input.personId)) {
            return error(400, "Pick a person from your household.");
          }
          const taken = db.prepare("SELECT id FROM users WHERE person_id = ? AND id != ?").get(input.personId, id);
          if (taken) return error(409, "Another login is already linked to that person.");
          setUserPerson(db, id, input.personId);
        }
      }
      if (input.role !== undefined) {
        if (input.role !== "owner" && input.role !== "member") return error(400, "Role is owner or member.");
        if (target.role === "owner" && input.role === "member") {
          // The person who set up Ribbon holds the backups and every household; no one (not even them) demotes that login.
          if (isInstanceAdmin(db, target)) return error(409, "The person who set up Ribbon has to stay an owner.");
          const owners = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND household_id = ?").get(hid) as { n: number }).n;
          if (owners <= 1) return error(409, "Keep at least one owner.");
        }
        db.prepare("UPDATE users SET role = ? WHERE id = ?").run(input.role, id);
      }
      if (typeof input.displayName === "string" && input.displayName.trim()) {
        db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(input.displayName.trim().slice(0, 80), id);
      }
      return json({ user: getUser(db, id) });
    }
    if (method === "DELETE" && id !== undefined) {
      const target = getUser(db, id);
      if (target && isInstanceAdmin(db, target)) return error(409, "The person who set up Ribbon can’t be removed.");
      const result = removeUser(db, id, session.user.id, hid);
      return result.ok ? json({ ok: true }) : error(result.status, result.reason);
    }
    return error(405, "That method is not allowed here.");
  }
  return null;
}
