// Scheduled and manual SQLite backups, listing, download, and restore.
import { DatabaseSync } from "node:sqlite";
import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, createReadStream } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { backupCron, backupKeep } from "./config.ts";
import { cronMatches, nextRun, parseCron } from "./cron.ts";
import { MIGRATIONS, migrate, type Db } from "./db.ts";
import { error, json, type Handler } from "./http.ts";
import type { User } from "./users.ts";

export type BackupKind = "auto" | "manual" | "pre-restore";
export type BackupFile = { name: string; kind: BackupKind; size: number; createdAt: string };

const NAME = /^(auto|manual|pre-restore)-(\d{8})-(\d{6})(?:-\d+)?\.db$/;
export const MAX_UPLOAD = 256 * 1024 * 1024;

export function dbFile(db: Db): string | null {
  const rows = db.prepare("PRAGMA database_list").all() as { name: string; file: string }[];
  return rows.find((row) => row.name === "main")?.file || null;
}

export function backupDir(db: Db): string {
  const file = dbFile(db);
  if (!file) throw new Error("This database has no file, so it can't be backed up.");
  return join(dirname(file), "backups");
}

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** A consistent copy of the live database, written with VACUUM INTO. */
export function createBackup(db: Db, kind: BackupKind, now = new Date()): BackupFile {
  const dir = backupDir(db);
  mkdirSync(dir, { recursive: true });
  let name = `${kind}-${stamp(now)}.db`;
  for (let n = 2; existsSync(join(dir, name)); n += 1) name = `${kind}-${stamp(now)}-${n}.db`;
  const tmp = join(dir, `.tmp-${randomBytes(4).toString("hex")}`);
  db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
  renameSync(tmp, join(dir, name));
  if (kind === "auto") pruneAuto(db, backupKeep());
  if (kind === "pre-restore") pruneKind(db, "pre-restore", 5);
  return describe(dir, name)!;
}

function describe(dir: string, name: string): BackupFile | null {
  const m = NAME.exec(name);
  if (!m) return null;
  let size: number;
  try {
    size = statSync(join(dir, name)).size;
  } catch {
    return null;
  }
  const d = m[2]!;
  const t = m[3]!;
  const local = new Date(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)), Number(t.slice(0, 2)), Number(t.slice(2, 4)), Number(t.slice(4, 6)));
  return { name, kind: m[1] as BackupKind, size, createdAt: local.toISOString() };
}

export function listBackups(db: Db): BackupFile[] {
  const dir = backupDir(db);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => describe(dir, name))
    .filter((item): item is BackupFile => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

function pruneKind(db: Db, kind: BackupKind, keep: number) {
  const dir = backupDir(db);
  for (const file of listBackups(db).filter((f) => f.kind === kind).slice(keep)) rmSync(join(dir, file.name), { force: true });
}
const pruneAuto = (db: Db, keep: number) => pruneKind(db, "auto", keep);

export function backupPath(db: Db, name: string): string | null {
  if (!NAME.test(name)) return null;
  const path = join(backupDir(db), name);
  return existsSync(path) ? path : null;
}

/** The first owner is the one person who runs this Ribbon; backups hold every household's data. */
export function isInstanceAdmin(db: Db, user: Pick<User, "id" | "role">): boolean {
  if (user.role !== "owner") return false;
  const first = db.prepare("SELECT id FROM users WHERE role = 'owner' ORDER BY created_at, rowid LIMIT 1").get() as { id: string } | undefined;
  return first?.id === user.id;
}

// ---- restore ----

export type RestoreResult =
  | { ok: true; safetyBackup: string; tables: number }
  | { ok: false; status: 400 | 409 | 413; reason: string };

const KEEP_LIVE = new Set(["sessions", "_migrations"]);

function columns(conn: DatabaseSync, schema: string, table: string): string[] {
  return (conn.prepare(`PRAGMA ${schema}.table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);
}

/** Check that a file is a Ribbon database (and not newer than this app) and bring it up to the current schema. */
export function openBackupForRestore(path: string): { ok: true; conn: DatabaseSync } | { ok: false; reason: string } {
  let conn: DatabaseSync | undefined;
  try {
    const header = Buffer.alloc(16);
    const fd = openSync(path, "r");
    try {
      readSync(fd, header, 0, 16, 0);
    } finally {
      closeSync(fd);
    }
    if (header.toString("latin1") !== "SQLite format 3\u0000") return { ok: false, reason: "That isn’t a Ribbon backup (not an SQLite file)." };
    conn = new DatabaseSync(path);
    const check = conn.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    if (check.integrity_check !== "ok") throw new Error("The file is damaged (integrity check failed).");
    const tables = new Set((conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
    if (!tables.has("_migrations") || !tables.has("people") || !tables.has("gifts")) throw new Error("That isn’t a Ribbon backup.");
    const newest = (conn.prepare("SELECT MAX(id) AS id FROM _migrations").get() as { id: number | null }).id ?? 0;
    const ours = Math.max(...MIGRATIONS.map((m) => m.id));
    if (newest > ours) throw new Error("That backup comes from a newer Ribbon. Update Ribbon first, then restore.");
    migrate(conn);
    return { ok: true, conn };
  } catch (err) {
    try {
      conn?.close();
    } catch {
      /* ignore */
    }
    return { ok: false, reason: err instanceof Error ? err.message : "Couldn’t read that file." };
  }
}

/** Replace every household's data with the contents of a backup file. Takes a safety backup first. */
export function restoreFrom(db: Db, path: string): RestoreResult {
  const opened = openBackupForRestore(path);
  if (!opened.ok) return { ok: false, status: 400, reason: opened.reason };
  opened.conn.close();
  const safety = createBackup(db, "pre-restore");
  const tmpAlias = "restore_src";
  db.exec(`ATTACH DATABASE '${path.replaceAll("'", "''")}' AS ${tmpAlias}`);
  let count = 0;
  try {
    const tables = (db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
      .map((t) => t.name)
      .filter((name) => !KEEP_LIVE.has(name));
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const table of tables) {
        const exists = db.prepare(`SELECT 1 FROM ${tmpAlias}.sqlite_master WHERE type = 'table' AND name = ?`).get(table);
        db.exec(`DELETE FROM main."${table}"`);
        if (!exists) continue;
        const have = new Set(columns(db, tmpAlias, table));
        const shared = columns(db, "main", table).filter((c) => have.has(c));
        if (shared.length === 0) continue;
        const list = shared.map((c) => `"${c}"`).join(", ");
        db.exec(`INSERT INTO main."${table}" (${list}) SELECT ${list} FROM ${tmpAlias}."${table}"`);
        count += 1;
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(`DETACH DATABASE ${tmpAlias}`);
  }
  return { ok: true, safetyBackup: safety.name, tables: count };
}

// ---- scheduler ----

const timerKey = Symbol.for("ribbon.backup.timer");

/** Check once a minute; when the cron matches, take a scheduled backup. Returns a stop function. */
export function startBackupScheduler(db: Db, tick = 30_000): () => void {
  const g = globalThis as { [timerKey]?: ReturnType<typeof setInterval> };
  if (g[timerKey]) clearInterval(g[timerKey]);
  const expression = backupCron();
  if (expression.toLowerCase() === "off") {
    console.log("[ribbon] scheduled backups are off (BACKUP_CRON=off)");
    return () => {};
  }
  const cron = parseCron(expression);
  if (!cron) {
    console.error(`[ribbon] BACKUP_CRON "${expression}" isn't a valid five-field cron expression; scheduled backups are off.`);
    return () => {};
  }
  let lastMinute = -1;
  const run = () => {
    const now = new Date();
    const minute = Math.floor(now.getTime() / 60_000);
    if (minute === lastMinute || !cronMatches(cron, now)) return;
    lastMinute = minute;
    try {
      const made = createBackup(db, "auto", now);
      console.log(`[ribbon] backup written: ${made.name}`);
    } catch (err) {
      console.error("[ribbon] scheduled backup failed:", err instanceof Error ? err.message : err);
    }
  };
  const timer = setInterval(run, tick);
  timer.unref?.();
  g[timerKey] = timer;
  const next = nextRun(cron, new Date());
  console.log(`[ribbon] scheduled backups: "${expression}", keeping ${backupKeep()}${next ? `, next at ${next.toLocaleString()}` : ""}`);
  return () => clearInterval(timer);
}

export function scheduleInfo(db: Db) {
  const expression = backupCron();
  const cron = expression.toLowerCase() === "off" ? null : parseCron(expression);
  return {
    cron: expression,
    valid: expression.toLowerCase() === "off" || cron !== null,
    enabled: cron !== null,
    keep: backupKeep(),
    next: cron ? nextRun(cron, new Date())?.toISOString() ?? null : null,
    directory: "backups/",
    count: listBackups(db).length,
  };
}

// ---- API ----

export const backupsHandler: Handler = async (c) => {
  if (c.resource !== "backups") return null;
  if (!isInstanceAdmin(c.db, c.session.user)) {
    return error(403, "Only the person who set up Ribbon can manage backups, because they hold every household’s data.");
  }
  const { db, method, id, rest } = c;

  if (method === "GET" && id === undefined) return json({ backups: listBackups(db), schedule: scheduleInfo(db) });
  if (method === "POST" && id === undefined) {
    const made = createBackup(db, "manual");
    return json({ backup: made, backups: listBackups(db) }, { status: 201 });
  }

  if (method === "POST" && id === "restore-upload") {
    if (c.request.headers.get("x-confirm")?.toLowerCase() !== "restore") return error(400, "Confirm the restore first.");
    const length = Number(c.request.headers.get("content-length") ?? 0);
    if (length > MAX_UPLOAD) return error(413, "That file is too large.");
    const bytes = new Uint8Array(await c.request.arrayBuffer());
    if (bytes.length === 0) return error(400, "No file was sent.");
    if (bytes.length > MAX_UPLOAD) return error(413, "That file is too large.");
    const dir = backupDir(db);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.upload-${randomBytes(6).toString("hex")}`);
    writeFileSync(tmp, bytes);
    try {
      const result = restoreFrom(db, tmp);
      if (!result.ok) return error(result.status, result.reason);
      return json({ ok: true, safetyBackup: result.safetyBackup, signedOut: !stillSignedIn(db, c.session.user.id) });
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  if (id !== undefined) {
    const path = backupPath(db, id);
    if (!path) return error(404, "That backup is gone.");
    if (method === "GET" && rest[0] === "download") {
      const body = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream;
      return new Response(body, {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(statSync(path).size),
          "content-disposition": `attachment; filename="ribbon-${basename(id)}"`,
          "cache-control": "no-store",
        },
      });
    }
    if (method === "DELETE" && rest.length === 0) {
      rmSync(path, { force: true });
      return json({ backups: listBackups(db) });
    }
    if (method === "POST" && rest[0] === "restore") {
      if ((c.body as { confirm?: unknown } | null)?.confirm !== "restore") return error(400, "Confirm the restore first.");
      const result = restoreFrom(db, path);
      if (!result.ok) return error(result.status, result.reason);
      return json({ ok: true, safetyBackup: result.safetyBackup, signedOut: !stillSignedIn(db, c.session.user.id) });
    }
  }
  return null;
};

function stillSignedIn(db: Db, userId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId));
}
