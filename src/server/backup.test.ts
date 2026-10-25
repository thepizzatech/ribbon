import assert from "node:assert/strict";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";
import { backupDir, createBackup, isInstanceAdmin, listBackups, startBackupScheduler } from "./backup.ts";
import { cronMatches, nextRun, parseCron } from "./cron.ts";
import { call, freshDb, registerCleanup, signedIn, tempDir } from "./test-helpers.ts";

registerCleanup();

describe("cron", () => {
  test("parses and matches", () => {
    const daily = parseCron("0 3 * * *")!;
    assert.ok(cronMatches(daily, new Date(2026, 5, 1, 3, 0)));
    assert.ok(!cronMatches(daily, new Date(2026, 5, 1, 3, 1)));
    assert.ok(cronMatches(parseCron("*/15 * * * *")!, new Date(2026, 5, 1, 7, 45)));
    assert.ok(cronMatches(parseCron("30 2 * * 1-5")!, new Date(2026, 5, 1, 2, 30))); // a Monday
    assert.ok(!cronMatches(parseCron("30 2 * * 1-5")!, new Date(2026, 5, 6, 2, 30))); // a Saturday
    assert.ok(cronMatches(parseCron("0 0 1,15 * *")!, new Date(2026, 5, 15, 0, 0)));
    assert.equal(parseCron("nonsense"), null);
    assert.equal(parseCron("61 * * * *"), null);
    assert.equal(parseCron("* * * *"), null);
    const next = nextRun(daily, new Date(2026, 5, 1, 3, 0))!;
    assert.equal(next.getDate(), 2);
    assert.equal(next.getHours(), 3);
  });
});

describe("backups", () => {
  test("creates consistent copies, lists newest first, prunes only scheduled ones to BACKUP_KEEP", () => {
    const db = freshDb();
    process.env.BACKUP_KEEP = "2";
    try {
      const manual = createBackup(db, "manual", new Date(2026, 0, 1, 1, 0, 0));
      for (let i = 1; i <= 4; i += 1) createBackup(db, "auto", new Date(2026, 0, 1, 2 + i, 0, 0));
      const files = listBackups(db);
      assert.equal(files.filter((f) => f.kind === "auto").length, 2);
      assert.equal(files.filter((f) => f.kind === "manual").length, 1);
      assert.equal(files[0]!.kind, "auto");
      assert.ok(files.every((f) => f.size > 0));
      // the copy opens and has the data
      const copy = new DatabaseSync(join(backupDir(db), manual.name));
      assert.equal((copy.prepare("SELECT COUNT(*) AS n FROM people").get() as { n: number }).n, 8);
      copy.close();
      // same-second backups don't collide
      const a = createBackup(db, "manual", new Date(2026, 0, 2));
      const b = createBackup(db, "manual", new Date(2026, 0, 2));
      assert.notEqual(a.name, b.name);
    } finally {
      delete process.env.BACKUP_KEEP;
    }
  });

  test("the scheduler writes a backup when the cron matches", async () => {
    const db = freshDb();
    process.env.BACKUP_CRON = "* * * * *";
    const stop = startBackupScheduler(db, 10);
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
    } finally {
      stop();
      delete process.env.BACKUP_CRON;
    }
    assert.equal(listBackups(db).filter((f) => f.kind === "auto").length, 1);
  });

  test("API: owner-only; make, list, download, restore from a listed backup with a safety copy", async () => {
    const db = freshDb();
    const owner = signedIn(db, { username: "avery", personId: "p-avery" });
    const member = signedIn(db, { username: "noah", role: "member", personId: "p-noah" });
    assert.equal((await call(db, "GET", "/api/backups", undefined, member)).status, 403);
    assert.equal((await call(db, "POST", "/api/backups", {}, member)).status, 403);
    const made = await call(db, "POST", "/api/backups", {}, owner);
    assert.equal(made.status, 201);
    const name = made.body.backup.name as string;
    const list = await call(db, "GET", "/api/backups", undefined, owner);
    assert.equal(list.body.backups.length, 1);
    assert.equal(list.body.schedule.cron, "0 3 * * *");
    assert.equal(list.body.schedule.keep, 14);

    // change the data, then roll back
    await call(db, "POST", "/api/gifts", {
      direction: "given", title: "After backup", occasion: "Birthday", date: "2026-01-01", giverId: "p-avery",
      receiverId: "p-june", amount: 1, status: "idea", thanked: false, note: "",
    }, owner);
    const noConfirm = await call(db, "POST", `/api/backups/${name}/restore`, {}, owner);
    assert.equal(noConfirm.status, 400);
    const restored = await call(db, "POST", `/api/backups/${name}/restore`, { confirm: "restore" }, owner);
    assert.equal(restored.status, 200);
    assert.match(restored.body.safetyBackup, /^pre-restore-/);
    const gifts = (await call(db, "GET", "/api/gifts", undefined, owner)).body.gifts as { title: string }[];
    assert.ok(!gifts.some((g) => g.title === "After backup"));
    // the safety backup has the pre-restore state
    const safety = new DatabaseSync(join(backupDir(db), restored.body.safetyBackup));
    assert.equal((safety.prepare("SELECT COUNT(*) AS n FROM gifts WHERE title = 'After backup'").get() as { n: number }).n, 1);
    safety.close();
    // path tricks don't work
    assert.equal((await call(db, "GET", "/api/backups/..%2Fribbon.db/download", undefined, owner)).status, 404);
    assert.equal((await call(db, "DELETE", `/api/backups/${name}`, undefined, owner)).body.backups.some((b: { name: string }) => b.name === name), false);
  });

  test("API: download then restore from an upload; bad files are refused and change nothing", async () => {
    const db = freshDb();
    const owner = signedIn(db, { username: "avery", personId: "p-avery" });
    const made = await call(db, "POST", "/api/backups", {}, owner);
    const path = join(backupDir(db), made.body.backup.name);
    const dl = await call(db, "GET", `/api/backups/${made.body.backup.name}/download`, undefined, owner);
    assert.equal(dl.status, 200);
    assert.match(String(dl.headers.get("content-disposition")), /attachment/);

    await call(db, "DELETE", "/api/gifts/g1", undefined, owner);
    const bytes = new Uint8Array(readFileSync(path));
    const noHeader = await call(db, "POST", "/api/backups/restore-upload", bytes, owner, { "content-type": "application/octet-stream" });
    assert.equal(noHeader.status, 400);
    const ok = await call(db, "POST", "/api/backups/restore-upload", bytes, owner, { "content-type": "application/octet-stream", "x-confirm": "restore" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.signedOut, false);
    assert.equal((await call(db, "GET", "/api/gifts", undefined, owner)).body.gifts.length, 13);

    const junk = new TextEncoder().encode("definitely not a database");
    const bad = await call(db, "POST", "/api/backups/restore-upload", junk, owner, { "content-type": "application/octet-stream", "x-confirm": "restore" });
    assert.equal(bad.status, 400);
    assert.equal((await call(db, "GET", "/api/gifts", undefined, owner)).body.gifts.length, 13);

    // a database from a newer Ribbon, or some other SQLite file, is refused
    const newer = join(tempDir(), "newer.db");
    copyFileSync(path, newer);
    const nconn = new DatabaseSync(newer);
    nconn.prepare("INSERT INTO _migrations (id, name, applied_at) VALUES (999, 'future', 'now')").run();
    nconn.close();
    const future = await call(db, "POST", "/api/backups/restore-upload", new Uint8Array(readFileSync(newer)), owner, { "content-type": "application/octet-stream", "x-confirm": "restore" });
    assert.equal(future.status, 400);
    assert.match(future.body.error, /newer Ribbon/);
    const other = join(tempDir(), "other.db");
    const oconn = new DatabaseSync(other);
    oconn.exec("CREATE TABLE t (a)");
    oconn.close();
    const foreign = await call(db, "POST", "/api/backups/restore-upload", new Uint8Array(readFileSync(other)), owner, { "content-type": "application/octet-stream", "x-confirm": "restore" });
    assert.equal(foreign.status, 400);
    assert.equal(existsSync(path), true);
  });

  test("restoring a backup that lacks your account signs you out", async () => {
    const db = freshDb();
    const first = signedIn(db, { username: "avery", personId: "p-avery" });
    const made = await call(db, "POST", "/api/backups", {}, first);
    const later = signedIn(db, { username: "noah", role: "member", personId: "p-noah" });
    assert.ok(isInstanceAdmin(db, { id: first.id, role: "owner" }));
    assert.ok(!isInstanceAdmin(db, { id: later.id, role: "member" }));
    await call(db, "POST", `/api/backups/${made.body.backup.name}/restore`, { confirm: "restore" }, first);
    assert.equal((await call(db, "GET", "/api/session", undefined, later)).body.signedIn ?? false, false);
  });
});
