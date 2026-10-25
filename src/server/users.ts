// Accounts, sessions (stored in SQLite, only a hash of the token), and login lockout.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { devAccount, isProduction, seedSampleData } from "./config.ts";
import type { Db } from "./db.ts";
import { hashPasswordSync } from "./password.ts";

export type Role = "owner" | "member";
export type User = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  householdId: string;
  /** The person in the ledger who is this user ("this is me"); their own surprises are hidden from them. */
  personId: string | null;
  email: string | null;
};

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  password_hash: string;
  household_id: string;
  person_id: string | null;
  email: string | null;
};

const USER_COLS = "id, username, display_name, role, household_id, person_id, email";
type UserCols = Pick<UserRow, "id" | "username" | "display_name" | "role" | "household_id" | "person_id" | "email">;

const toUser = (row: UserCols): User => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  role: row.role,
  householdId: row.household_id,
  personId: row.person_id,
  email: row.email,
});

export const SESSION_DAYS = 14;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().toLowerCase();
  if (name.length < 3 || name.length > 80) return null;
  if (!/^[a-z0-9][a-z0-9._@+-]*$/.test(name)) return null;
  return name;
}

export function userCount(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

export function findUserByName(db: Db, username: string): UserRow | undefined {
  return db
    .prepare(`SELECT ${USER_COLS}, password_hash FROM users WHERE username = ?`)
    .get(username) as UserRow | undefined;
}

export function listUsers(db: Db, householdId: string): User[] {
  return (
    db
      .prepare(`SELECT ${USER_COLS} FROM users WHERE household_id = ? ORDER BY created_at, username`)
      .all(householdId) as UserCols[]
  ).map(toUser);
}

export function getUser(db: Db, id: string): User | undefined {
  const row = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) as UserCols | undefined;
  return row ? toUser(row) : undefined;
}

export function createUser(
  db: Db,
  input: {
    username: string;
    displayName?: string;
    role: Role;
    passwordHash: string;
    householdId?: string;
    personId?: string | null;
    email?: string | null;
  },
): User {
  const householdId =
    input.householdId ??
    (db.prepare("SELECT id FROM households ORDER BY created_at, id LIMIT 1").get() as { id: string } | undefined)?.id ??
    "h-main";
  const user: User = {
    id: randomUUID(),
    username: input.username,
    displayName: (input.displayName?.trim() || input.username).slice(0, 80),
    role: input.role,
    householdId,
    personId: input.personId ?? null,
    email: input.email ?? null,
  };
  db.prepare(
    "INSERT INTO users (id, username, display_name, role, password_hash, created_at, household_id, person_id, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    user.id,
    user.username,
    user.displayName,
    user.role,
    input.passwordHash,
    new Date().toISOString(),
    householdId,
    user.personId,
    user.email,
  );
  return user;
}

/** Link a login to the person in the ledger who is them (or clear it). */
export function setUserPerson(db: Db, userId: string, personId: string | null) {
  db.prepare("UPDATE users SET person_id = ? WHERE id = ?").run(personId, userId);
}

export function setPasswordHash(db: Db, userId: string, passwordHash: string) {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
}

export function getPasswordHash(db: Db, userId: string): string | undefined {
  return (db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as { password_hash: string } | undefined)
    ?.password_hash;
}

export type RemoveResult = { ok: true } | { ok: false; status: 404 | 409; reason: string };

export function removeUser(db: Db, id: string, actingUserId: string, actingHouseholdId?: string): RemoveResult {
  const row = db.prepare("SELECT id, role, household_id FROM users WHERE id = ?").get(id) as
    | { id: string; role: Role; household_id: string }
    | undefined;
  if (!row || (actingHouseholdId && row.household_id !== actingHouseholdId)) return { ok: false, status: 404, reason: "That login is gone." };
  if (id === actingUserId) return { ok: false, status: 409, reason: "You can’t remove your own login." };
  if (row.role === "owner") {
    const owners = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND household_id = ?").get(row.household_id) as { n: number }).n;
    if (owners <= 1) return { ok: false, status: 409, reason: "Keep at least one owner." };
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  return { ok: true };
}

// ---- sessions ----

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type Session = { user: User; csrfToken: string; sessionId: string };

export function createSession(db: Db, userId: string, now = Date.now()): { token: string; csrfToken: string } {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare(
    "INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(hashToken(token), userId, csrfToken, now, now + SESSION_MS, now);
  return { token, csrfToken };
}

export function readSession(db: Db, token: string | undefined, now = Date.now()): Session | null {
  if (!token) return null;
  const id = hashToken(token);
  const row = db
    .prepare(
      `SELECT s.id AS sid, s.csrf_token, s.expires_at, s.last_seen_at, u.id, u.username, u.display_name, u.role,
              u.household_id, u.person_id, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .get(id) as
    | (UserCols & {
        sid: string;
        csrf_token: string;
        expires_at: number;
        last_seen_at: number;
      })
    | undefined;
  if (!row || row.expires_at < now) return null;
  if (now - row.last_seen_at > RENEW_AFTER_MS) {
    db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?").run(now, now + SESSION_MS, id);
  }
  return { user: toUser(row), csrfToken: row.csrf_token, sessionId: row.sid };
}

export function destroySession(db: Db, token: string | undefined) {
  if (token) db.prepare("DELETE FROM sessions WHERE id = ?").run(hashToken(token));
}

/** Sign a user out everywhere, except (optionally) the session they are using now. */
export function destroyUserSessions(db: Db, userId: string, exceptSessionId?: string) {
  if (exceptSessionId) db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(userId, exceptSessionId);
  else db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function csrfMatches(expected: string, given: string | null): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- lockout (in memory: 5 misses per account or 20 per address in 15 minutes) ----

const WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_LIMIT = 5;
const ADDRESS_LIMIT = 20;
const misses = new Map<string, { count: number; since: number }>();

function bucket(key: string, now: number) {
  const entry = misses.get(key);
  return entry && now - entry.since <= WINDOW_MS ? entry : null;
}

/** Seconds until another attempt is allowed, or 0. */
export function lockedFor(username: string, address: string, now = Date.now()): number {
  let wait = 0;
  for (const [key, limit] of [
    [`u:${username}`, ACCOUNT_LIMIT],
    [`a:${address}`, ADDRESS_LIMIT],
  ] as const) {
    const entry = bucket(key, now);
    if (entry && entry.count >= limit) wait = Math.max(wait, Math.ceil((entry.since + WINDOW_MS - now) / 1000));
  }
  return wait;
}

export function recordMiss(username: string, address: string, now = Date.now()) {
  for (const key of [`u:${username}`, `a:${address}`]) {
    const entry = bucket(key, now);
    if (entry) entry.count += 1;
    else misses.set(key, { count: 1, since: now });
  }
}

export function clearMisses(username: string, address: string) {
  misses.delete(`u:${username}`);
  void address; // address misses age out on their own so one good login can't reset a guessing run
}

export function resetLockouts() {
  misses.clear();
}

// ---- development account ----

/** With sample data on (development only) and no users yet, create admin/dev-password and say so loudly. */
export function ensureDevAccount(db: Db): User | null {
  if (!seedSampleData() || isProduction() || userCount(db) > 0) return null;
  const { username, password } = devAccount();
  const user = createUser(db, {
    username,
    displayName: "Dev admin",
    role: "owner",
    passwordHash: hashPasswordSync(password),
    personId: db.prepare("SELECT id FROM people WHERE id = 'p-avery'").get() ? "p-avery" : null,
  });
  console.warn(
    `[ribbon] DEVELOPMENT ONLY: created owner login "${username}" with password "${password}" (SEED_SAMPLE_DATA is on). ` +
      "Never run this configuration in production.",
  );
  return user;
}
