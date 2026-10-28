// Ledger reads/writes against SQLite. The rules here mirror the browser store
// (keep one person, keep one occasion, no deleting what a gift still uses).
import { randomUUID } from "node:crypto";
import {
  DEFAULT_OCCASIONS,
  DEFAULT_OCCASION_DATES,
  cleanOccasionDate,
  cleanGift,
  cleanMonthDay,
  cleanOccasionName,
  cleanPerson,
  isGift,
  isIsoDate,
  isPerson,
  normalizeOccasions,
  type Backup,
  type Gift,
  type Ledger,
  type Person,
} from "../lib/gifts/model.ts";
import { purgeGuest, purgeParticipants } from "./exchange-cleanup.ts";
import { transaction, type Db } from "./db.ts";

export type Failure = { ok: false; status: 400 | 404 | 409; reason: string };
export type Result<T = object> = ({ ok: true } & T) | Failure;

const fail = (status: Failure["status"], reason: string): Failure => ({ ok: false, status, reason });

/** Whose ledger, and who is looking. `me` is the viewer's own person ("this is me"), if linked. */
export type Ctx = { db: Db; hid: string; me: string | null };

type PersonRow = {
  id: string;
  name: string;
  role: string;
  circle: Person["circle"];
  relationship: Person["relationship"];
  birthday: string | null;
  anniversary: string | null;
  shared: number;
};
const PERSON_COLS = "id, name, role, circle, relationship, birthday, anniversary, shared";
const GIFT_COLS = "id, direction, title, occasion, date, giver_id, receiver_id, amount, status, thanked, note";
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

const toPerson = (row: PersonRow): Person => ({
  id: row.id,
  name: row.name,
  role: row.role,
  circle: row.circle,
  relationship: row.relationship,
  birthday: row.birthday,
  anniversary: row.anniversary,
  shared: row.shared === 1,
});
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

/**
 * Surprise-safe: gifts someone is still planning or has bought for the viewer ("given", idea/purchased,
 * and the viewer is the receiver) never reach that viewer. SQL fragment and JS twin below.
 */
export function hiddenGiftSql(me: string | null): { sql: string; args: string[] } {
  return me
    ? { sql: "NOT (direction = 'given' AND receiver_id = ? AND status IN ('idea', 'purchased'))", args: [me] }
    : { sql: "1 = 1", args: [] };
}

export function isHiddenGift(gift: Pick<Gift, "direction" | "receiverId" | "status">, me: string | null): boolean {
  return Boolean(me) && gift.direction === "given" && gift.receiverId === me && gift.status !== "delivered";
}

export function listPeople(ctx: Ctx): Person[] {
  return (
    ctx.db.prepare(`SELECT ${PERSON_COLS} FROM people WHERE household_id = ? ORDER BY seq`).all(ctx.hid) as PersonRow[]
  ).map(toPerson);
}

export function listGifts(ctx: Ctx): Gift[] {
  const hidden = hiddenGiftSql(ctx.me);
  return (
    ctx.db
      .prepare(`SELECT ${GIFT_COLS} FROM gifts WHERE household_id = ? AND ${hidden.sql} ORDER BY seq DESC`)
      .all(ctx.hid, ...hidden.args) as GiftRow[]
  ).map(toGift);
}

export function listOccasions(ctx: Ctx): string[] {
  return (ctx.db.prepare("SELECT name FROM occasions WHERE household_id = ? ORDER BY seq").all(ctx.hid) as { name: string }[]).map(
    (row) => row.name,
  );
}

export function listOccasionDates(ctx: Ctx): Record<string, string> {
  const rows = ctx.db
    .prepare("SELECT name, month, day FROM occasions WHERE household_id = ? AND month IS NOT NULL AND day IS NOT NULL")
    .all(ctx.hid) as { name: string; month: number; day: number }[];
  return Object.fromEntries(rows.map((r) => [r.name, `${String(r.month).padStart(2, "0")}-${String(r.day).padStart(2, "0")}`]));
}

export function householdRow(db: Db, hid: string) {
  return db.prepare("SELECT id, name, demo, demo_dismissed FROM households WHERE id = ?").get(hid) as
    | { id: string; name: string; demo: number; demo_dismissed: number }
    | undefined;
}

export function getLedger(ctx: Ctx): Ledger {
  const house = householdRow(ctx.db, ctx.hid);
  return {
    householdName: house?.name ?? "Our household",
    people: listPeople(ctx),
    gifts: listGifts(ctx),
    occasions: listOccasions(ctx),
    occasionDates: listOccasionDates(ctx),
    demo: house?.demo === 1,
    demoDismissed: house ? house.demo_dismissed === 1 : true,
  };
}

/** The file the Settings sheet has always exported (what this viewer is allowed to see). */
export function exportLedger(ctx: Ctx) {
  const ledger = getLedger(ctx);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    householdName: ledger.householdName,
    people: ledger.people,
    gifts: ledger.gifts,
    occasions: ledger.occasions,
    occasionDates: ledger.occasionDates,
  };
}

export type HouseholdPatch = { householdName?: unknown; demo?: unknown; demoDismissed?: unknown };

export function updateHousehold(ctx: Ctx, patch: HouseholdPatch): Result {
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
  if (sets.length > 0) ctx.db.prepare(`UPDATE households SET ${sets.join(", ")} WHERE id = ?`).run(...values, ctx.hid);
  return { ok: true };
}

// ---- people ----

function nextSeq(db: Db, table: "people" | "gifts"): number {
  const row = db.prepare(`SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM ${table}`).get() as { next: number };
  return row.next;
}

export function getPerson(ctx: Ctx, id: string): Person | undefined {
  const row = ctx.db.prepare(`SELECT ${PERSON_COLS} FROM people WHERE id = ? AND household_id = ?`).get(id, ctx.hid) as
    | PersonRow
    | undefined;
  return row ? toPerson(row) : undefined;
}

export function addPerson(ctx: Ctx, input: unknown): Result<{ person: Person }> {
  const draft = { id: randomUUID(), ...(input && typeof input === "object" ? input : {}) } as Person;
  if (!isPerson(draft)) return fail(400, "That person is missing a name, role, or circle.");
  const person = cleanPerson(draft);
  if (!person.name) return fail(400, "Name the person.");
  if (ctx.db.prepare("SELECT 1 FROM people WHERE id = ?").get(person.id)) return fail(409, "That person already exists.");
  ctx.db
    .prepare(
      "INSERT INTO people (id, seq, name, role, circle, relationship, household_id, birthday, anniversary, shared) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      person.id,
      nextSeq(ctx.db, "people"),
      person.name,
      person.role,
      person.circle,
      person.relationship,
      ctx.hid,
      person.birthday ?? null,
      person.anniversary ?? null,
      person.shared ? 1 : 0,
    );
  return { ok: true, person };
}

export function updatePerson(ctx: Ctx, id: string, patch: unknown): Result<{ person: Person }> {
  const current = getPerson(ctx, id);
  if (!current) return fail(404, "That person is gone.");
  const body = patch && typeof patch === "object" ? (patch as Partial<Person>) : {};
  const merged = { ...current } as Record<string, unknown>;
  for (const key of ["name", "role", "circle", "relationship", "birthday", "anniversary", "shared"] as const) {
    if (body[key] !== undefined) merged[key] = body[key];
  }
  if (!isPerson(merged)) return fail(400, "That person is missing a name, role, or circle.");
  for (const key of ["birthday", "anniversary"] as const) {
    const raw = body[key];
    if (raw !== undefined && raw !== null && raw !== "" && cleanMonthDay(raw) === null) {
      return fail(400, "Dates look like 2026-12-25, or --12-25 when the year is unknown.");
    }
    if (raw === "") merged[key] = null;
  }
  const person = cleanPerson(merged as Person);
  if (!person.name) return fail(400, "Name the person.");
  ctx.db
    .prepare(
      "UPDATE people SET name = ?, role = ?, circle = ?, relationship = ?, birthday = ?, anniversary = ?, shared = ? WHERE id = ?",
    )
    .run(
      person.name,
      person.role,
      person.circle,
      person.relationship,
      person.birthday ?? null,
      person.anniversary ?? null,
      person.shared ? 1 : 0,
      id,
    );
  if (!person.shared) purgeGuest(ctx.db, id, ctx.hid);
  return { ok: true, person };
}

export function removePerson(ctx: Ctx, id: string): Result {
  if (!getPerson(ctx, id)) return fail(404, "That person is gone.");
  // Never answer "is on a gift" about yourself: for a login that would reveal a surprise planned for them.
  if (ctx.me === id) return fail(409, "You can’t remove yourself from the ledger. Ask another owner.");
  const count = ctx.db.prepare("SELECT COUNT(*) AS n FROM people WHERE household_id = ?").get(ctx.hid) as { n: number };
  if (count.n <= 1) return fail(409, "Keep at least one person in the ledger.");
  if (ctx.db.prepare("SELECT 1 FROM gifts WHERE giver_id = ? OR receiver_id = ?").get(id, id)) {
    return fail(409, "This person is on a gift. Change those gifts first.");
  }
  transaction(ctx.db, () => {
    ctx.db.prepare("UPDATE users SET person_id = NULL WHERE person_id = ?").run(id);
    ctx.db.prepare("DELETE FROM wishlist_items WHERE person_id = ?").run(id);
    purgeParticipants(ctx.db, [id]);
    ctx.db.prepare("DELETE FROM budgets WHERE household_id = ? AND scope = 'person' AND key = ?").run(ctx.hid, id);
    ctx.db.prepare("DELETE FROM people WHERE id = ?").run(id);
  });
  return { ok: true };
}

// ---- gifts ----

function insertGift(db: Db, hid: string, gift: Gift, seq: number) {
  db.prepare(
    `INSERT INTO gifts (id, seq, direction, title, occasion, date, giver_id, receiver_id, amount, status, thanked, note, household_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    hid,
  );
}

function peopleExist(ctx: Ctx, gift: Gift): boolean {
  const n = (
    ctx.db
      .prepare("SELECT COUNT(DISTINCT id) AS n FROM people WHERE household_id = ? AND id IN (?, ?)")
      .get(ctx.hid, gift.giverId, gift.receiverId) as { n: number }
  ).n;
  return n === new Set([gift.giverId, gift.receiverId]).size;
}

const BAD_DATE_MESSAGE = "Pick a real date, like 2026-12-02.";
const SURPRISE_MESSAGE = "Surprises for you stay hidden from you, so plan gifts for other people here.";

export function addGift(ctx: Ctx, input: unknown): Result<{ gift: Gift }> {
  const draft = {
    id: randomUUID(),
    occasion: "",
    amount: null,
    note: "",
    ...(input && typeof input === "object" ? input : {}),
  } as Gift;
  if (!isGift(draft)) return fail(400, "That gift is missing a title, date, people, or status.");
  const gift = cleanGift(draft);
  if (!isIsoDate(gift.date)) return fail(400, BAD_DATE_MESSAGE);
  if (!peopleExist(ctx, gift)) return fail(400, "Pick people from this household.");
  if (isHiddenGift(gift, ctx.me)) return fail(400, SURPRISE_MESSAGE);
  if (ctx.db.prepare("SELECT 1 FROM gifts WHERE id = ?").get(gift.id)) return fail(409, "That gift already exists.");
  insertGift(ctx.db, ctx.hid, gift, nextSeq(ctx.db, "gifts"));
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

export function getGift(ctx: Ctx, id: string): Gift | undefined {
  const hidden = hiddenGiftSql(ctx.me);
  const row = ctx.db
    .prepare(`SELECT ${GIFT_COLS} FROM gifts WHERE id = ? AND household_id = ? AND ${hidden.sql}`)
    .get(id, ctx.hid, ...hidden.args) as GiftRow | undefined;
  return row ? toGift(row) : undefined;
}

export function updateGift(ctx: Ctx, id: string, patch: unknown): Result<{ gift: Gift }> {
  const current = getGift(ctx, id);
  if (!current) return fail(404, "That gift is gone.");
  const body = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  const merged = { ...current } as Record<string, unknown>;
  for (const key of GIFT_FIELDS) if (body[key] !== undefined) merged[key] = body[key];
  if (!isGift(merged)) return fail(400, "That gift is missing a title, date, people, or status.");
  const gift = cleanGift(merged);
  // A date saved by an older version stays editable (marking it bought, say); only a date being changed has to be real.
  if (gift.date !== current.date && !isIsoDate(gift.date)) return fail(400, BAD_DATE_MESSAGE);
  if (!peopleExist(ctx, gift)) return fail(400, "Pick people from this household.");
  if (isHiddenGift(gift, ctx.me)) return fail(400, SURPRISE_MESSAGE);
  ctx.db
    .prepare(
      `UPDATE gifts SET direction = ?, title = ?, occasion = ?, date = ?, giver_id = ?, receiver_id = ?,
         amount = ?, status = ?, thanked = ?, note = ? WHERE id = ?`,
    )
    .run(
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

export function removeGift(ctx: Ctx, id: string): Result {
  if (!getGift(ctx, id)) return fail(404, "That gift is gone.");
  ctx.db.prepare("DELETE FROM gifts WHERE id = ?").run(id);
  return { ok: true };
}

// ---- occasions (addressed by name) ----

export function addOccasion(ctx: Ctx, input: unknown): Result<{ occasions: string[]; occasionDates: Record<string, string> }> {
  const body = (input && typeof input === "object" ? input : {}) as { name?: unknown; date?: unknown };
  const name = cleanOccasionName(typeof body.name === "string" ? body.name : "");
  if (!name) return fail(400, "Name the occasion.");
  const names = listOccasions(ctx);
  if (names.some((item) => item.toLowerCase() === name.toLowerCase())) {
    return fail(409, "That occasion is already on the list.");
  }
  if (names.length >= 40) return fail(409, "40 occasions is the limit.");
  const date = body.date === undefined || body.date === null || body.date === "" ? null : cleanOccasionDate(body.date);
  if (body.date && !date) return fail(400, "Dates look like 12-25 (month-day).");
  ctx.db
    .prepare("INSERT INTO occasions (household_id, name, month, day) VALUES (?, ?, ?, ?)")
    .run(ctx.hid, name, date ? Number(date.slice(0, 2)) : null, date ? Number(date.slice(3)) : null);
  return { ok: true, occasions: listOccasions(ctx), occasionDates: listOccasionDates(ctx) };
}

export function renameOccasion(
  ctx: Ctx,
  from: string,
  input: unknown,
): Result<{ occasions: string[]; occasionDates: Record<string, string> }> {
  const names = listOccasions(ctx);
  if (!names.includes(from)) return fail(404, "That occasion is gone.");
  const body = (input && typeof input === "object" ? input : {}) as { name?: unknown; date?: unknown };
  const name = body.name === undefined ? from : cleanOccasionName(typeof body.name === "string" ? body.name : "");
  if (!name) return fail(400, "Occasion needs a name.");
  if (names.some((item) => item !== from && item.toLowerCase() === name.toLowerCase())) {
    return fail(409, "That occasion is already on the list.");
  }
  let date: string | null | undefined;
  if (body.date !== undefined) {
    date = body.date === null || body.date === "" ? null : cleanOccasionDate(body.date);
    if (body.date && !date) return fail(400, "Dates look like 12-25 (month-day).");
  }
  transaction(ctx.db, () => {
    if (name !== from) {
      ctx.db.prepare("UPDATE occasions SET name = ? WHERE name = ? AND household_id = ?").run(name, from, ctx.hid);
      ctx.db.prepare("UPDATE gifts SET occasion = ? WHERE occasion = ? AND household_id = ?").run(name, from, ctx.hid);
      ctx.db.prepare("UPDATE budgets SET key = ? WHERE scope = 'occasion' AND key = ? AND household_id = ?").run(name, from, ctx.hid);
    }
    if (date !== undefined) {
      ctx.db
        .prepare("UPDATE occasions SET month = ?, day = ? WHERE name = ? AND household_id = ?")
        .run(date ? Number(date.slice(0, 2)) : null, date ? Number(date.slice(3)) : null, name, ctx.hid);
    }
  });
  return { ok: true, occasions: listOccasions(ctx), occasionDates: listOccasionDates(ctx) };
}

export function removeOccasion(ctx: Ctx, name: string): Result<{ occasions: string[]; occasionDates: Record<string, string> }> {
  const names = listOccasions(ctx);
  if (!names.includes(name)) return fail(404, "That occasion is gone.");
  if (names.length <= 1) return fail(409, "Keep at least one occasion.");
  if (ctx.db.prepare("SELECT 1 FROM gifts WHERE occasion = ? AND household_id = ?").get(name, ctx.hid)) {
    return fail(409, "Gifts still use this. Rename it, or change those gifts first.");
  }
  ctx.db.prepare("DELETE FROM occasions WHERE name = ? AND household_id = ?").run(name, ctx.hid);
  ctx.db.prepare("DELETE FROM budgets WHERE scope = 'occasion' AND key = ? AND household_id = ?").run(name, ctx.hid);
  return { ok: true, occasions: listOccasions(ctx), occasionDates: listOccasionDates(ctx) };
}

// ---- import (replaces everything) ----

/** How many gifts this viewer cannot see (surprises planned for them). A replace-all import would erase them. */
export function hiddenGiftCount(ctx: Ctx): number {
  if (!ctx.me) return 0;
  return (
    ctx.db
      .prepare("SELECT COUNT(*) AS n FROM gifts WHERE household_id = ? AND NOT (" + hiddenGiftSql(ctx.me).sql + ")")
      .get(ctx.hid, ...hiddenGiftSql(ctx.me).args) as { n: number }
  ).n;
}

export function replaceLedger(
  ctx: Ctx,
  input: Backup,
  flags: { demo?: boolean; demoDismissed?: boolean } = {},
): Result {
  if (hiddenGiftCount(ctx) > 0) {
    return fail(409, "Some gifts here are surprises planned for you, so replacing everything would erase them. Ask someone else in the family to import.");
  }
  // A hand-edited file may repeat an id; keep the first.
  const firstById = <T extends { id: string }>(items: T[]) => {
    const seen = new Set<string>();
    return items.filter((item) => !seen.has(item.id) && !!seen.add(item.id));
  };
  let people = firstById(input.people);
  let gifts = firstById(input.gifts);
  // ids are global: if a file brings ids another household already uses, give them fresh ones.
  const taken = new Set(
    (ctx.db.prepare("SELECT id FROM people WHERE household_id != ?").all(ctx.hid) as { id: string }[]).map((r) => r.id),
  );
  const giftTaken = new Set(
    (ctx.db.prepare("SELECT id FROM gifts WHERE household_id != ?").all(ctx.hid) as { id: string }[]).map((r) => r.id),
  );
  const remap = new Map<string, string>();
  people = people.map((p) => {
    if (!taken.has(p.id)) return p;
    const fresh = randomUUID();
    remap.set(p.id, fresh);
    return { ...p, id: fresh };
  });
  gifts = gifts.map((g) => ({
    ...g,
    id: giftTaken.has(g.id) ? randomUUID() : g.id,
    giverId: remap.get(g.giverId) ?? g.giverId,
    receiverId: remap.get(g.receiverId) ?? g.receiverId,
  }));
  const backup: Backup = { ...input, people, gifts };
  const occasions = backup.occasions.length > 0 ? backup.occasions : [...DEFAULT_OCCASIONS];
  const normalized = normalizeOccasions(occasions, backup.gifts);
  const dates = backup.occasionDates ?? {};
  const myPeople = (ctx.db.prepare("SELECT id FROM people WHERE household_id = ?").all(ctx.hid) as { id: string }[]).map((r) => r.id);
  transaction(ctx.db, () => {
    // Wishlist items (and later budgets) belong to people: keep those whose person is still in the file.
    const keepIds = people.map((p) => p.id);
    const marks = keepIds.map(() => "?").join(",") || "''";
    ctx.db.prepare(`DELETE FROM wishlist_items WHERE household_id = ? AND person_id NOT IN (${marks})`).run(ctx.hid, ...keepIds);
    ctx.db.prepare(`DELETE FROM budgets WHERE household_id = ? AND scope = 'person' AND key NOT IN (${marks})`).run(ctx.hid, ...keepIds);
    purgeParticipants(ctx.db, myPeople.filter((pid) => !keepIds.includes(pid)));
    const keep = new Set(people.map((p) => p.id));
    for (const id of myPeople) if (!keep.has(id)) ctx.db.prepare("UPDATE users SET person_id = NULL WHERE person_id = ?").run(id);
    ctx.db.prepare("DELETE FROM gifts WHERE household_id = ?").run(ctx.hid);
    ctx.db.prepare("DELETE FROM people WHERE household_id = ?").run(ctx.hid);
    ctx.db.prepare("DELETE FROM occasions WHERE household_id = ?").run(ctx.hid);
    ctx.db
      .prepare("UPDATE households SET name = ?, demo = ?, demo_dismissed = ? WHERE id = ?")
      .run(backup.householdName.trim().slice(0, 80) || "Our household", flags.demo ? 1 : 0, flags.demoDismissed === false ? 0 : 1, ctx.hid);
    const person = ctx.db.prepare(
      "INSERT INTO people (id, seq, name, role, circle, relationship, household_id, birthday, anniversary, shared) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    let seq = nextSeq(ctx.db, "people");
    for (const p of backup.people) {
      person.run(p.id, seq++, p.name, p.role, p.circle, p.relationship, ctx.hid, p.birthday ?? null, p.anniversary ?? null, p.shared ? 1 : 0);
    }
    const occasion = ctx.db.prepare("INSERT INTO occasions (household_id, name, month, day) VALUES (?, ?, ?, ?)");
    for (const name of normalized) {
      const date = dates[name] ?? DEFAULT_OCCASION_DATES[name];
      occasion.run(ctx.hid, name, date ? Number(date.slice(0, 2)) : null, date ? Number(date.slice(3)) : null);
    }
    // First gift in the file stays first on screen (highest seq).
    let gseq = nextSeq(ctx.db, "gifts") + backup.gifts.length;
    for (const g of backup.gifts) insertGift(ctx.db, ctx.hid, g, --gseq);
  });
  return { ok: true };
}

// ---- first-run setup ----

export function hasHousehold(db: Db): boolean {
  return Boolean(db.prepare("SELECT 1 FROM households LIMIT 1").get());
}

export function firstHouseholdId(db: Db): string | undefined {
  return (db.prepare("SELECT id FROM households ORDER BY created_at, id LIMIT 1").get() as { id: string } | undefined)?.id;
}

/**
 * Create a household with its default occasions and family members; returns its id.
 * `pendingSetup` starts it in the Welcome setup (the first owner names the family and adds people after signing in).
 */
export function createHousehold(db: Db, name: string, people: Person[], options: { pendingSetup?: boolean } = {}): string {
  const hid = randomUUID();
  transaction(db, () => {
    db.prepare("INSERT INTO households (id, name, demo, demo_dismissed, created_at, setup_complete, setup_step) VALUES (?, ?, 0, 1, ?, ?, 1)").run(
      hid,
      options.pendingSetup ? name.trim().slice(0, 80) : name.trim().slice(0, 80) || "Our household",
      new Date().toISOString(),
      options.pendingSetup ? 0 : 1,
    );
    const insert = db.prepare(
      "INSERT INTO people (id, seq, name, role, circle, relationship, household_id, birthday, anniversary, shared) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    let seq = nextSeq(db, "people");
    for (const p of people) insert.run(p.id, seq++, p.name, p.role, p.circle, p.relationship, hid, p.birthday ?? null, p.anniversary ?? null, p.shared ? 1 : 0);
    const occasion = db.prepare("INSERT INTO occasions (household_id, name, month, day) VALUES (?, ?, ?, ?)");
    for (const item of DEFAULT_OCCASIONS) {
      const date = DEFAULT_OCCASION_DATES[item];
      occasion.run(hid, item, date ? Number(date.slice(0, 2)) : null, date ? Number(date.slice(3)) : null);
    }
  });
  return hid;
}
