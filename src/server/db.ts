// SQLite storage (node:sqlite, built into Node 22.13+; no native addon to compile).
// The database file lives in DATA_DIR (default /data) as ribbon.db.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_OCCASIONS, SEED_GIFTS, SEED_PEOPLE } from "../lib/gifts/model.ts";
import { seedSampleData } from "./config.ts";
import { ensureDevAccount } from "./users.ts";

export type Db = DatabaseSync;

type Migration = { id: number; name: string; sql: string };

// Append new migrations to the end; never edit one that has shipped.
export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "initial schema",
    sql: `
      CREATE TABLE household (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        name TEXT NOT NULL,
        demo INTEGER NOT NULL DEFAULT 0,
        demo_dismissed INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE people (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        circle TEXT NOT NULL CHECK (circle IN ('household', 'outside'))
      );
      CREATE TABLE occasions (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      );
      CREATE TABLE gifts (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('received', 'given')),
        title TEXT NOT NULL,
        occasion TEXT NOT NULL,
        date TEXT NOT NULL,
        giver_id TEXT NOT NULL,
        receiver_id TEXT NOT NULL,
        amount REAL,
        status TEXT NOT NULL CHECK (status IN ('idea', 'purchased', 'delivered')),
        thanked INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX gifts_seq ON gifts (seq);
      CREATE INDEX gifts_giver ON gifts (giver_id);
      CREATE INDEX gifts_receiver ON gifts (receiver_id);
    `,
  },
  {
    id: 2,
    name: "accounts, sessions, relationships",
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
      CREATE INDEX sessions_user ON sessions (user_id);
      ALTER TABLE people ADD COLUMN relationship TEXT NOT NULL DEFAULT 'other';
      UPDATE people SET relationship = CASE lower(trim(role))
        WHEN 'you' THEN 'self' WHEN 'me' THEN 'self' WHEN 'self' THEN 'self'
        WHEN 'partner' THEN 'partner' WHEN 'spouse' THEN 'partner'
        WHEN 'wife' THEN 'wife' WHEN 'husband' THEN 'husband'
        WHEN 'son' THEN 'son' WHEN 'daughter' THEN 'daughter'
        WHEN 'mother' THEN 'mother' WHEN 'mom' THEN 'mother' WHEN 'mum' THEN 'mother'
        WHEN 'father' THEN 'father' WHEN 'dad' THEN 'father'
        WHEN 'brother' THEN 'brother' WHEN 'sister' THEN 'sister'
        WHEN 'grandmother' THEN 'grandmother' WHEN 'grandma' THEN 'grandmother'
        WHEN 'grandfather' THEN 'grandfather' WHEN 'grandpa' THEN 'grandfather'
        WHEN 'aunt' THEN 'aunt' WHEN 'uncle' THEN 'uncle' WHEN 'cousin' THEN 'cousin'
        WHEN 'friend' THEN 'friend'
        ELSE 'other' END;
    `,
  },
];

export function dataDir(): string {
  return process.env.DATA_DIR?.trim() || "/data";
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Apply pending migrations in order; each runs in its own transaction. */
export function migrate(db: Db): number[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const done = new Set(
    (db.prepare("SELECT id FROM _migrations").all() as { id: number }[]).map((row) => row.id),
  );
  const applied: number[] = [];
  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue;
    transaction(db, () => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
        migration.id,
        migration.name,
        new Date().toISOString(),
      );
    });
    applied.push(migration.id);
  }
  return applied;
}

/** With SEED_SAMPLE_DATA on, a brand-new database starts with the sample household (development). */
function seedIfEmpty(db: Db) {
  const row = db.prepare("SELECT id FROM household WHERE id = 1").get();
  if (row) return;
  transaction(db, () => {
    db.prepare("INSERT INTO household (id, name, demo, demo_dismissed) VALUES (1, ?, 1, 0)").run("The Coles");
    const person = db.prepare("INSERT INTO people (id, seq, name, role, circle, relationship) VALUES (?, ?, ?, ?, ?, ?)");
    SEED_PEOPLE.forEach((p, i) => person.run(p.id, i + 1, p.name, p.role, p.circle, p.relationship));
    const occasion = db.prepare("INSERT INTO occasions (name) VALUES (?)");
    for (const name of DEFAULT_OCCASIONS) occasion.run(name);
    const gift = db.prepare(
      `INSERT INTO gifts (id, seq, direction, title, occasion, date, giver_id, receiver_id, amount, status, thanked, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // Newest-first display order: the first seed gift gets the highest seq.
    SEED_GIFTS.forEach((g, i) =>
      gift.run(g.id, SEED_GIFTS.length - i, g.direction, g.title, g.occasion, g.date, g.giverId, g.receiverId, g.amount, g.status, g.thanked ? 1 : 0, g.note),
    );
  });
}

/** Open (creating the directory and file if needed), migrate, and seed. */
export function openDb(dir: string = dataDir(), options: { seed?: boolean } = {}): Db {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    throw new Error(
      `Cannot create the data directory "${dir}" (${error instanceof Error ? error.message : error}). Set DATA_DIR to a writable folder.`,
    );
  }
  const db = new DatabaseSync(join(dir, "ribbon.db"));
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  if (options.seed ?? seedSampleData()) seedIfEmpty(db);
  return db;
}

const globalKey = Symbol.for("ribbon.db");
type Holder = { [globalKey]?: { dir: string; db: Db } };

/** One shared connection per process (also survives dev-server module reloads). */
export function getDb(): Db {
  const holder = globalThis as Holder;
  const dir = dataDir();
  const current = holder[globalKey];
  if (current && current.dir === dir) return current.db;
  current?.db.close();
  const db = openDb(dir);
  ensureDevAccount(db);
  holder[globalKey] = { dir, db };
  return db;
}
