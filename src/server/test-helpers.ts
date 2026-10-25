import { resetRateLimits } from "./ratelimit.ts";
// Shared helpers for the server tests (not itself a test file).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { handleApi } from "./api.ts";
import { openDb, type Db } from "./db.ts";
import { hashPasswordSync } from "./password.ts";
import { createSession, createUser, type Role } from "./users.ts";

const dirs: string[] = [];
const dbs: Db[] = [];

export function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "ribbon-test-"));
  dirs.push(dir);
  return dir;
}

export function freshDb(options: { dir?: string; seed?: boolean } = {}) {
  resetRateLimits(); // each test starts with a clean slate of in-memory brakes
  const db = openDb(options.dir ?? tempDir(), { seed: options.seed ?? true });
  dbs.push(db);
  return db;
}

export function registerCleanup() {
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
}

export type Auth = { cookie: string; csrf: string };

/** A signed-in user without going through the (slow, rate-limited) login endpoint. */
export function signedIn(
  db: Db,
  options: { username?: string; role?: Role; householdId?: string; personId?: string | null } = {},
): Auth & { id: string; householdId: string } {
  const user = createUser(db, {
    username: options.username ?? "owner",
    role: options.role ?? "owner",
    passwordHash: hashPasswordSync("correct horse battery"),
    householdId: options.householdId,
    personId: options.personId ?? null,
  });
  const made = createSession(db, user.id);
  return { id: user.id, householdId: user.householdId, cookie: `ribbon_session=${made.token}`, csrf: made.csrfToken };
}

export async function call(
  db: Db | undefined,
  method: string,
  path: string,
  body?: unknown,
  auth?: Auth | null,
  headers: Record<string, string> = {},
) {
  const sendsCsrf = auth && method !== "GET";
  const response = await handleApi(
    new Request(`http://localhost:8080${path}`, {
      method,
      headers: {
        ...(body !== undefined && !(body instanceof Uint8Array) ? { "content-type": "application/json" } : {}),
        ...(auth ? { cookie: auth.cookie } : {}),
        ...(sendsCsrf ? { "x-csrf-token": auth.csrf } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : body instanceof Uint8Array ? (body as unknown as BodyInit) : JSON.stringify(body),
    }),
    db,
  );
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON (csv, ics, db file) */
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, body: parsed as any, text, headers: response.headers };
}

/** Create a second household (with its own owner) in the same database. */
export function secondHousehold(db: Db, name = "The Riveras") {
  const hid = createHouseholdForTest(db, name);
  const auth = signedIn(db, { username: `owner-${name.replace(/\W/g, "").toLowerCase()}`, householdId: hid.id, personId: hid.selfId });
  return { ...auth, hid: hid.id, selfId: hid.selfId };
}

import { createHousehold } from "./ledger.ts";
import { randomUUID } from "node:crypto";
function createHouseholdForTest(db: Db, name: string) {
  const selfId = randomUUID();
  const id = createHousehold(db, name, [
    { id: selfId, name: `${name} Owner`, role: "You", relationship: "self", circle: "household" },
    { id: randomUUID(), name: `${name} Kid`, role: "Son", relationship: "son", circle: "household" },
  ]);
  return { id, selfId };
}
