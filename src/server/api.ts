// The whole JSON API as one Request -> Response function, so the same code runs
// behind the TanStack Start route and in the tests.
import { randomUUID } from "node:crypto";
import {
  normalizeRelationship,
  parseBackupData,
  relationshipLabel,
  type Person,
} from "../lib/gifts/model.ts";
import { seedSampleData, setupCode } from "./config.ts";
import {
  burnPasswordCheck,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "./password.ts";
import { clientAddress, insecureLoginReason, isPrivateAddress, isSecureRequest, originAllowed } from "./security.ts";
import {
  clearMisses,
  createSession,
  createUser,
  csrfMatches,
  destroySession,
  destroyUserSessions,
  findUserByName,
  getPasswordHash,
  listUsers,
  lockedFor,
  normalizeUsername,
  readSession,
  recordMiss,
  removeUser,
  setPasswordHash,
  userCount,
  type Role,
  type Session,
} from "./users.ts";
import { versionInfo } from "./version.ts";
import { getDb, type Db } from "./db.ts";
import {
  addGift,
  addOccasion,
  addPerson,
  createHousehold,
  exportLedger,
  getLedger,
  hasHousehold,
  removeGift,
  removeOccasion,
  removePerson,
  renameOccasion,
  replaceLedger,
  updateGift,
  updateHousehold,
  updatePerson,
  type Result,
} from "./ledger.ts";

const MAX_BODY = 5 * 1024 * 1024;

function json(data: unknown, init: ResponseInit & { cookie?: string } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  if (init.cookie) headers.append("set-cookie", init.cookie);
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers });
}

const error = (status: number, message: string) => json({ error: message }, { status });

function respond(result: Result<object>, okStatus = 200): Response {
  if (!result.ok) return error(result.status, result.reason);
  const { ok: _ok, ...rest } = result;
  return json(rest, { status: okStatus });
}

const clientKey = clientAddress;

type Body = { ok: true; value: unknown } | { ok: false; response: Response };

async function readJson(request: Request): Promise<Body> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    return { ok: false, response: error(415, "Send JSON with Content-Type: application/json.") };
  }
  const text = await request.text();
  if (text.length > MAX_BODY) return { ok: false, response: error(413, "That request is too large.") };
  if (!text.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: error(400, "That is not valid JSON.") };
  }
}

const decode = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

function cookieName(secure: boolean) {
  return secure ? "__Host-ribbon_session" : "ribbon_session";
}

function readSessionToken(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name === cookieName(true) || name === cookieName(false)) return part.slice(index + 1).trim();
  }
  return undefined;
}

function sessionCookie(token: string, secure: boolean): string {
  const maxAge = 14 * 24 * 60 * 60;
  return `${cookieName(secure)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function clearCookies(): string[] {
  return [
    `${cookieName(true)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
    `${cookieName(false)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  ];
}

function sessionPayload(db: Db, session: Session | null, request: Request) {
  const setupRequired = userCount(db) === 0;
  const hasLedger = hasHousehold(db);
  return {
    ...versionInfo(),
    setupRequired,
    // After an upgrade the household already exists; setup then only creates the owner login.
    hasLedger,
    householdName: setupRequired && hasLedger ? getLedger(db).householdName : null,
    setupCodeRequired: setupRequired && Boolean(setupCode()),
    secure: isSecureRequest(request),
    insecureLoginBlocked: insecureLoginReason(request),
    privateNetwork: isPrivateAddress(clientAddress(request)),
    sampleData: seedSampleData(),
    authed: Boolean(session),
    user: session?.user ?? null,
    csrfToken: session?.csrfToken ?? null,
  };
}

type Member = { name: string; relationship: string; role?: string; household: boolean };

function readMembers(input: unknown): Person[] | string {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 30) return "Add up to 30 family members.";
  const people: Person[] = [];
  for (const item of input as Partial<Member>[]) {
    const name = typeof item?.name === "string" ? item.name.trim().slice(0, 80) : "";
    if (!name) return "Every family member needs a name.";
    const relationship = normalizeRelationship(item.relationship, item.role);
    const custom = typeof item.role === "string" ? item.role.trim().slice(0, 40) : "";
    people.push({
      id: randomUUID(),
      name,
      relationship,
      role: relationship === "other" && custom ? custom : relationshipLabel(relationship),
      circle: item.household === false ? "outside" : "household",
    });
  }
  return people;
}

/** The signed-in session for a request (used by server functions outside /api), or null. */
export function requestSession(request: Request, db?: Db): Session | null {
  return readSession(db ?? getDb(), readSessionToken(request));
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

    // ---- endpoints that work before sign-in ----
    if (resource === "session" && method === "GET" && !rawId) return json(sessionPayload(store, session, request));

    if (resource === "setup" && method === "POST" && !rawId) {
      if (userCount(store) > 0) return error(409, "Ribbon is already set up. Sign in instead.");
      const refused = insecureLoginReason(request);
      if (refused) return error(403, refused);
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
      if (code && (typeof body.setupCode !== "string" || body.setupCode.trim() !== code)) {
        return error(403, "That setup code is not right.");
      }
      const username = normalizeUsername(body.username);
      if (!username) return error(400, "Pick a username of 3 or more letters or numbers (an email works too).");
      const problem = passwordProblem(body.password, username);
      if (problem) return error(400, problem);
      const existing = hasHousehold(store);
      let people: Person[] = [];
      let familyName = "";
      if (!existing) {
        familyName = typeof body.familyName === "string" ? body.familyName.trim().slice(0, 80) : "";
        if (!familyName) return error(400, "Give your family a name.");
        const members = readMembers(body.people);
        if (typeof members === "string") return error(400, members);
        const yourName = typeof body.yourName === "string" ? body.yourName.trim().slice(0, 80) : "";
        people = [
          {
            id: randomUUID(),
            name: yourName || username,
            role: "You",
            relationship: "self",
            circle: "household",
          },
          ...members,
        ];
      }
      const passwordHash = await hashPassword(body.password as string);
      if (userCount(store) > 0) return error(409, "Ribbon is already set up. Sign in instead.");
      if (!existing) createHousehold(store, familyName, people);
      const owner = createUser(store, {
        username,
        displayName: typeof body.yourName === "string" && body.yourName.trim() ? body.yourName : username,
        role: "owner",
        passwordHash,
      });
      const made = createSession(store, owner.id);
      const fresh = readSession(store, made.token);
      return json(sessionPayload(store, fresh, request), { status: 201, cookie: sessionCookie(made.token, secure) });
    }

    if (resource === "login" && method === "POST" && !rawId) {
      const refused = insecureLoginReason(request);
      if (refused) return error(403, refused);
      const parsed = await readJson(request);
      if (!parsed.ok) return parsed.response;
      const body = (parsed.value ?? {}) as { username?: unknown; password?: unknown };
      const username = normalizeUsername(body.username) ?? "invalid";
      const address = clientKey(request);
      const wait = lockedFor(username, address);
      if (wait > 0) {
        const response = error(429, "Too many tries. Wait a few minutes and try again.");
        response.headers.set("retry-after", String(wait));
        return response;
      }
      const row = username === "invalid" ? undefined : findUserByName(store, username);
      const password = typeof body.password === "string" ? body.password.slice(0, 400) : "";
      const ok = row ? await verifyPassword(password, row.password_hash) : (await burnPasswordCheck(password), false);
      if (!row || !ok) {
        recordMiss(username, address);
        await new Promise((resolve) => setTimeout(resolve, 300));
        return error(401, "Incorrect username or password.");
      }
      clearMisses(username, address);
      const made = createSession(store, row.id);
      return json(sessionPayload(store, readSession(store, made.token), request), { cookie: sessionCookie(made.token, secure) });
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

    let body: unknown = {};
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const parsed = await readJson(request);
      if (!parsed.ok) return parsed.response;
      body = parsed.value;
    }

    const id = rawId === undefined ? undefined : decode(rawId);
    if (id === null) return error(400, "Bad id in the address.");

    if (resource === "account" && id === "password" && method === "POST" && rest.length === 0) {
      const { current, next } = (body ?? {}) as { current?: unknown; next?: unknown };
      const hash = getPasswordHash(store, session.user.id);
      if (typeof current !== "string" || !hash || !(await verifyPassword(current, hash))) {
        return error(400, "Your current password is not right.");
      }
      const problem = passwordProblem(next, session.user.username);
      if (problem) return error(400, problem);
      setPasswordHash(store, session.user.id, await hashPassword(next as string));
      destroyUserSessions(store, session.user.id, session.sessionId);
      return json({ ok: true });
    }

    if (resource === "users" && rest.length === 0) {
      if (session.user.role !== "owner") return error(403, "Only an owner can manage logins.");
      if (method === "GET" && id === undefined) return json({ users: listUsers(store) });
      if (method === "POST" && id === undefined) {
        const input = (body ?? {}) as { username?: unknown; password?: unknown; displayName?: unknown; role?: unknown };
        const username = normalizeUsername(input.username);
        if (!username) return error(400, "Pick a username of 3 or more letters or numbers (an email works too).");
        const problem = passwordProblem(input.password, username);
        if (problem) return error(400, problem);
        if (findUserByName(store, username)) return error(409, "That username is taken.");
        const role: Role = input.role === "owner" ? "owner" : "member";
        const user = createUser(store, {
          username,
          displayName: typeof input.displayName === "string" ? input.displayName : undefined,
          role,
          passwordHash: await hashPassword(input.password as string),
        });
        return json({ user }, { status: 201 });
      }
      if (method === "DELETE" && id !== undefined) {
        const result = removeUser(store, id, session.user.id);
        return result.ok ? json({ ok: true }) : error(result.status, result.reason);
      }
      return error(405, "That method is not allowed here.");
    }

    if (rest.length > 0) return error(404, "Not found.");

    switch (resource) {
      case "ledger":
        if (method === "GET" && id === undefined) return json(getLedger(store));
        break;
      case "household":
        if (method === "PUT" && id === undefined) {
          const result = updateHousehold(store, (body ?? {}) as object);
          return result.ok ? json(getLedger(store)) : respond(result);
        }
        break;
      case "people":
        if (method === "GET" && id === undefined) return json({ people: getLedger(store).people });
        if (method === "POST" && id === undefined) return respond(addPerson(store, body), 201);
        if (method === "PATCH" && id !== undefined) return respond(updatePerson(store, id, body));
        if (method === "DELETE" && id !== undefined) return respond(removePerson(store, id));
        break;
      case "gifts":
        if (method === "GET" && id === undefined) return json({ gifts: getLedger(store).gifts });
        if (method === "POST" && id === undefined) return respond(addGift(store, body), 201);
        if (method === "PATCH" && id !== undefined) return respond(updateGift(store, id, body));
        if (method === "DELETE" && id !== undefined) return respond(removeGift(store, id));
        break;
      case "occasions":
        if (method === "GET" && id === undefined) return json({ occasions: getLedger(store).occasions });
        if (method === "POST" && id === undefined) return respond(addOccasion(store, body), 201);
        if (method === "PATCH" && id !== undefined) return respond(renameOccasion(store, id, body));
        if (method === "DELETE" && id !== undefined) return respond(removeOccasion(store, id));
        break;
      case "export":
        if (method === "GET" && id === undefined) {
          const response = json(exportLedger(store));
          response.headers.set("content-disposition", 'attachment; filename="ribbon-ledger.json"');
          return response;
        }
        break;
      case "import":
        if (method === "POST" && id === undefined) {
          const record = (body ?? {}) as { demo?: unknown; demoDismissed?: unknown };
          const backup = parseBackupData(body);
          if (!backup) return error(400, "That file is not a Ribbon ledger.");
          replaceLedger(store, backup, {
            demo: record.demo === true,
            demoDismissed: record.demoDismissed !== false,
          });
          return json(getLedger(store));
        }
        break;
      default:
        return error(404, "Not found.");
    }
    return error(405, "That method is not allowed here.");
  } catch (err) {
    console.error("[ribbon] api error:", err instanceof Error ? err.message : err);
    return error(500, "Something went wrong on the server.");
  }
}
