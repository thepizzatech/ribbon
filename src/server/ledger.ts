// Ledger reads/writes against SQLite. The rules here mirror the browser store
// (keep one person, keep one occasion, no deleting what a gift still uses).
import { randomUUID } from "node:crypto";
import {
  DEFAULT_OCCASIONS,
  cleanGift,
  cleanOccasionName,
  cleanPerson,
  isGift,
  isPerson,
  normalizeOccasions,
  type Backup,
  type Gift,
  type Ledger,
  type Person,
} from "../lib/gifts/model.ts";
import { transaction, type Db } from "./db.ts";

export type Failure = { ok: false; status: 400 | 404 | 409; reason: string };
export type Result<T = object> = ({ ok: true } & T) | Failure;

const fail = (status: Failure["status"], reason: string): Failure => ({ ok: false, status, reason });

type PersonRow = { id: string; name: string; role: string; circle: Person["circle"] };
type GiftRow = {
  id: string;
  direction: Gift["direction"];
  title: string;
  occasion: string;
  date: string;
  giver_id: string;
  receiver_id: string;
  amount: number | null;
  status: Gift["status"];
  thanked: number;
  note: string;
};

const toPerson = (row: PersonRow): Person => ({ id: row.id, name: row.name, role: row.role, circle: row.circle });
const toGift = (row: GiftRow): Gift => ({
  id: row.id,
  direction: row.direction,
  title: row.title,
  occasion: row.occasion,
  date: row.date,
  giverId: row.giver_id,
  receiverId: row.receiver_id,
  amount: row.amount,
  status: row.status,
  thanked: row.thanked === 1,
  note: row.note,
});

export function listPeople(db: Db): Person[] {
  return (db.prepare("SELECT id, name, role, circle FROM people ORDER BY seq").all() as PersonRow[]).map(toPerson);
}

export function listGifts(db: Db): Gift[] {
  return (
    db
      .prepare(
        "SELECT id, direction, title, occasion, date, giver_id, receiver_id, amount, status, thanked, note FROM gifts ORDER BY seq DESC",
      )
      .all() as GiftRow[]
  ).map(toGift);
}

export function listOccasions(db: Db): string[] {
  return (db.prepare("SELECT name FROM occasions ORDER BY seq").all() as { name: string }[]).map((row) => row.name);
}

export function getLedger(db: Db): Ledger {
  const house = db.prepare("SELECT name, demo, demo_dismissed FROM household WHERE id = 1").get() as
    | { name: string; demo: number; demo_dismissed: number }
    | undefined;
  return {
    householdName: house?.name ?? "Our household",
    people: listPeople(db),
    gifts: listGifts(db),
    occasions: listOccasions(db),
    demo: house?.demo === 1,
    demoDismissed: house ? house.demo_dismissed === 1 : true,
  };
}

/** The file the Settings sheet has always exported. */
export function exportLedger(db: Db) {
  const ledger = getLedger(db);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    householdName: ledger.householdName,
    people: ledger.people,
    gifts: ledger.gifts,
    occasions: ledger.occasions,
  };
}

export type HouseholdPatch = { householdName?: unknown; demo?: unknown; demoDismissed?: unknown };

export function updateHousehold(db: Db, patch: HouseholdPatch): Result {
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (patch.householdName !== undefined) {
    if (typeof patch.householdName !== "string") return fail(400, "householdName must be text.");
    sets.push("name = ?");
    values.push(patch.householdName.trim().slice(0, 80) || "Our household");
  }
  for (const [key, column] of [
    ["demo", "demo"],
    ["demoDismissed", "demo_dismissed"],
  ] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") return fail(400, `${key} must be true or false.`);
    sets.push(`${column} = ?`);
    values.push(value ? 1 : 0);
  }
  if (sets.length > 0) db.prepare(`UPDATE household SET ${sets.join(", ")} WHERE id = 1`).run(...values);
  return { ok: true };
}

// ---- people ----

function nextSeq(db: Db, table: "people" | "gifts"): number {
  const row = db.prepare(`SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM ${table}`).get() as { next: number };
  return row.next;
}

export function addPerson(db: Db, input: unknown): Result<{ person: Person }> {
  const draft = { id: randomUUID(), ...(input && typeof input === "object" ? input : {}) } as Person;
  if (!isPerson(draft)) return fail(400, "That person is missing a name, role, or circle.");
  const person = cleanPerson(draft);
  if (!person.name) return fail(400, "Name the person.");
  if (db.prepare("SELECT 1 FROM people WHERE id = ?").get(person.id)) return fail(409, "That person already exists.");
  db.prepare("INSERT INTO people (id, seq, name, role, circle) VALUES (?, ?, ?, ?, ?)").run(
    person.id,
    nextSeq(db, "people"),
    person.name,
    person.role,
    person.circle,
  );
  return { ok: true, person };
}

export function updatePerson(db: Db, id: string, patch: unknown): Result<{ person: Person }> {
  const row = db.prepare("SELECT id, name, role, circle FROM people WHERE id = ?").get(id) as PersonRow | undefined;
  if (!row) return fail(404, "That person is gone.");
  const body = patch && typeof patch === "object" ? (patch as Partial<Person>) : {};
  const merged = {
    ...toPerson(row),
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.role !== undefined ? { role: body.role } : {}),
    ...(body.circle !== undefined ? { circle: body.circle } : {}),
  } as Person;
  if (!isPerson(merged)) return fail(400, "That person is missing a name, role, or circle.");
  const person = cleanPerson(merged);
  if (!person.name) return fail(400, "Name the person.");
  db.prepare("UPDATE people SET name = ?, role = ?, circle = ? WHERE id = ?").run(
    person.name,
    person.role,
    person.circle,
    id,
  );
  return { ok: true, person };
}

export function removePerson(db: Db, id: string): Result {
  if (!db.prepare("SELECT 1 FROM people WHERE id = ?").get(id)) return fail(404, "That person is gone.");
  const count = db.prepare("SELECT COUNT(*) AS n FROM people").get() as { n: number };
  if (count.n <= 1) return fail(409, "Keep at least one person in the ledger.");
  if (db.prepare("SELECT 1 FROM gifts WHERE giver_id = ? OR receiver_id = ?").get(id, id)) {
    return fail(409, "This person is on a gift. Change those gifts first.");
  }
  db.prepare("DELETE FROM people WHERE id = ?").run(id);
  return { ok: true };
}

// ---- gifts ----

function insertGift(db: Db, gift: Gift, seq: number) {
  db.prepare(
    `INSERT INTO gifts (id, seq, direction, title, occasion, date, giver_id, receiver_id, amount, status, thanked, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    gift.id,
    seq,
    gift.direction,
    gift.title,
    gift.occasion,
    gift.date,
    gift.giverId,
    gift.receiverId,
    gift.amount,
    gift.status,
    gift.thanked ? 1 : 0,
    gift.note,
  );
}

export function addGift(db: Db, input: unknown): Result<{ gift: Gift }> {
  const draft = {
    id: randomUUID(),
    occasion: "",
    amount: null,
    note: "",
    ...(input && typeof input === "object" ? input : {}),
  } as Gift;
  if (!isGift(draft)) return fail(400, "That gift is missing a title, date, people, or status.");
  const gift = cleanGift(draft);
  if (db.prepare("SELECT 1 FROM gifts WHERE id = ?").get(gift.id)) return fail(409, "That gift already exists.");
  insertGift(db, gift, nextSeq(db, "gifts"));
  return { ok: true, gift };
}

const GIFT_FIELDS = [
  "direction",
  "title",
  "occasion",
  "date",
  "giverId",
  "receiverId",
  "amount",
  "status",
  "thanked",
  "note",
] as const;

export function updateGift(db: Db, id: string, patch: unknown): Result<{ gift: Gift }> {
  const row = db
    .prepare(
      "SELECT id, direction, title, occasion, date, giver_id, receiver_id, amount, status, thanked, note FROM gifts WHERE id = ?",
    )
    .get(id) as GiftRow | undefined;
  if (!row) return fail(404, "That gift is gone.");
  const body = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  const merged = { ...toGift(row) } as Record<string, unknown>;
  for (const key of GIFT_FIELDS) if (body[key] !== undefined) merged[key] = body[key];
  if (!isGift(merged)) return fail(400, "That gift is missing a title, date, people, or status.");
  const gift = cleanGift(merged);
  db.prepare(
    `UPDATE gifts SET direction = ?, title = ?, occasion = ?, date = ?, giver_id = ?, receiver_id = ?,
       amount = ?, status = ?, thanked = ?, note = ? WHERE id = ?`,
  ).run(
    gift.direction,
    gift.title,
    gift.occasion,
    gift.date,
    gift.giverId,
    gift.receiverId,
    gift.amount,
    gift.status,
    gift.thanked ? 1 : 0,
    gift.note,
    id,
  );
  return { ok: true, gift };
}

export function removeGift(db: Db, id: string): Result {
  const result = db.prepare("DELETE FROM gifts WHERE id = ?").run(id);
  return result.changes === 0 ? fail(404, "That gift is gone.") : { ok: true };
}

// ---- occasions (addressed by name) ----

export function addOccasion(db: Db, input: unknown): Result<{ occasions: string[] }> {
  const raw = input && typeof input === "object" ? (input as { name?: unknown }).name : undefined;
  const name = cleanOccasionName(typeof raw === "string" ? raw : "");
  if (!name) return fail(400, "Name the occasion.");
  const names = listOccasions(db);
  if (names.some((item) => item.toLowerCase() === name.toLowerCase())) {
    return fail(409, "That occasion is already on the list.");
  }
  if (names.length >= 40) return fail(409, "40 occasions is the limit.");
  db.prepare("INSERT INTO occasions (name) VALUES (?)").run(name);
  return { ok: true, occasions: listOccasions(db) };
}

export function renameOccasion(db: Db, from: string, input: unknown): Result<{ occasions: string[] }> {
  const names = listOccasions(db);
  if (!names.includes(from)) return fail(404, "That occasion is gone.");
  const raw = input && typeof input === "object" ? (input as { name?: unknown }).name : undefined;
  const name = cleanOccasionName(typeof raw === "string" ? raw : "");
  if (!name) return fail(400, "Occasion needs a name.");
  if (names.some((item) => item !== from && item.toLowerCase() === name.toLowerCase())) {
    return fail(409, "That occasion is already on the list.");
  }
  if (name !== from) {
    transaction(db, () => {
      db.prepare("UPDATE occasions SET name = ? WHERE name = ?").run(name, from);
      db.prepare("UPDATE gifts SET occasion = ? WHERE occasion = ?").run(name, from);
    });
  }
  return { ok: true, occasions: listOccasions(db) };
}

export function removeOccasion(db: Db, name: string): Result<{ occasions: string[] }> {
  const names = listOccasions(db);
  if (!names.includes(name)) return fail(404, "That occasion is gone.");
  if (names.length <= 1) return fail(409, "Keep at least one occasion.");
  if (db.prepare("SELECT 1 FROM gifts WHERE occasion = ?").get(name)) {
    return fail(409, "Gifts still use this. Rename it, or change those gifts first.");
  }
  db.prepare("DELETE FROM occasions WHERE name = ?").run(name);
  return { ok: true, occasions: listOccasions(db) };
}

// ---- import (replaces everything) ----

export function replaceLedger(
  db: Db,
  input: Backup,
  flags: { demo?: boolean; demoDismissed?: boolean } = {},
): void {
  // A hand-edited file may repeat an id; keep the first.
  const firstById = <T extends { id: string }>(items: T[]) => {
    const seen = new Set<string>();
    return items.filter((item) => !seen.has(item.id) && !!seen.add(item.id));
  };
  const backup: Backup = { ...input, people: firstById(input.people), gifts: firstById(input.gifts) };
  const occasions = backup.occasions.length > 0 ? backup.occasions : [...DEFAULT_OCCASIONS];
  const normalized = normalizeOccasions(occasions, backup.gifts);
  transaction(db, () => {
    db.exec("DELETE FROM gifts; DELETE FROM people; DELETE FROM occasions;");
    db.prepare(
      `INSERT INTO household (id, name, demo, demo_dismissed) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, demo = excluded.demo, demo_dismissed = excluded.demo_dismissed`,
    ).run(backup.householdName.trim().slice(0, 80) || "Our household", flags.demo ? 1 : 0, flags.demoDismissed === false ? 0 : 1);
    const person = db.prepare("INSERT INTO people (id, seq, name, role, circle) VALUES (?, ?, ?, ?, ?)");
    backup.people.forEach((p, i) => person.run(p.id, i + 1, p.name, p.role, p.circle));
    const occasion = db.prepare("INSERT INTO occasions (name) VALUES (?)");
    for (const name of normalized) occasion.run(name);
    // First gift in the file stays first on screen (highest seq).
    backup.gifts.forEach((g, i) => insertGift(db, g, backup.gifts.length - i));
  });
}
