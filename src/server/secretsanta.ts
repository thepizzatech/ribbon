// Secret Santa exchanges across a household and its linked households. Every read is shaped for the viewer:
// a participant sees only who they drew; the organiser sees the draw only if they opted in and are the organiser.
import { randomUUID } from "node:crypto";
import { draw, solvable } from "../lib/gifts/santa.ts";
import { transaction, type Db } from "./db.ts";
import { error, json, type Handler } from "./http.ts";
import { householdRow } from "./ledger.ts";
import { removeFromExchange } from "./exchange-cleanup.ts";
import { areLinked, linkedHouseholdIds } from "./sharing.ts";
import type { User } from "./users.ts";

type ExchangeRow = {
  id: string;
  household_id: string;
  organiser_user_id: string;
  name: string;
  event_date: string;
  budget: number | null;
  organiser_peek: number;
  avoid_previous: number;
  status: "draft" | "drawn";
  draw_count: number;
  drawn_at: string | null;
  created_at: string;
};

const COLS = "id, household_id, organiser_user_id, name, event_date, budget, organiser_peek, avoid_previous, status, draw_count, drawn_at, created_at";

type PersonInfo = { personId: string; name: string; householdId: string; householdName: string; hasLogin: boolean };

function personInfo(db: Db, personId: string): PersonInfo | null {
  const row = db
    .prepare(
      `SELECT p.id, p.name, p.household_id, h.name AS hname,
              EXISTS (SELECT 1 FROM users u WHERE u.person_id = p.id) AS has_login
       FROM people p JOIN households h ON h.id = p.household_id WHERE p.id = ?`,
    )
    .get(personId) as { id: string; name: string; household_id: string; hname: string; has_login: number } | undefined;
  return row ? { personId: row.id, name: row.name, householdId: row.household_id, householdName: row.hname, hasLogin: row.has_login === 1 } : null;
}

const participantIds = (db: Db, exchangeId: string) =>
  (db.prepare("SELECT person_id FROM exchange_participants WHERE exchange_id = ? ORDER BY rowid").all(exchangeId) as { person_id: string }[]).map((r) => r.person_id);

const isParticipant = (db: Db, exchangeId: string, personId: string | null) =>
  Boolean(personId && db.prepare("SELECT 1 FROM exchange_participants WHERE exchange_id = ? AND person_id = ?").get(exchangeId, personId));

const canSee = (db: Db, ex: ExchangeRow, user: User) => ex.household_id === user.householdId || isParticipant(db, ex.id, user.personId);

const canManage = (ex: ExchangeRow, user: User) =>
  ex.household_id === user.householdId && (ex.organiser_user_id === user.id || user.role === "owner");

const SHAPE_MESSAGE = "Not found.";

/** The people a household may put in an exchange: its own, plus shared people of linked households. */
export function candidates(db: Db, user: User): PersonInfo[] {
  const out: PersonInfo[] = [];
  const own = db.prepare("SELECT id FROM people WHERE household_id = ? ORDER BY seq").all(user.householdId) as { id: string }[];
  for (const p of own) out.push(personInfo(db, p.id)!);
  for (const other of linkedHouseholdIds(db, user.householdId)) {
    const shared = db.prepare("SELECT id FROM people WHERE household_id = ? AND shared = 1 ORDER BY seq").all(other) as { id: string }[];
    for (const p of shared) out.push(personInfo(db, p.id)!);
  }
  return out;
}

export function viewExchange(db: Db, ex: ExchangeRow, user: User) {
  const manage = canManage(ex, user);
  const ids = participantIds(db, ex.id);
  const participants = ids.map((id) => personInfo(db, id)).filter((p): p is PersonInfo => p !== null);
  const organiser = db.prepare("SELECT display_name FROM users WHERE id = ?").get(ex.organiser_user_id) as { display_name: string } | undefined;
  const iAmIn = isParticipant(db, ex.id, user.personId);
  let mine: PersonInfo | null = null;
  if (iAmIn && ex.status === "drawn" && user.personId) {
    const row = db.prepare("SELECT receiver_id FROM exchange_assignments WHERE exchange_id = ? AND giver_id = ?").get(ex.id, user.personId) as { receiver_id: string } | undefined;
    mine = row ? personInfo(db, row.receiver_id) : null;
  }
  const peeking = ex.organiser_user_id === user.id && ex.organiser_peek === 1 && ex.status === "drawn";
  const assignments = peeking
    ? (db.prepare("SELECT giver_id, receiver_id FROM exchange_assignments WHERE exchange_id = ?").all(ex.id) as { giver_id: string; receiver_id: string }[]).map((a) => ({
        giver: personInfo(db, a.giver_id)?.name ?? "", receiver: personInfo(db, a.receiver_id)?.name ?? "",
      }))
    : undefined;
  const exclusions = manage
    ? (db.prepare("SELECT giver_id, receiver_id FROM exchange_exclusions WHERE exchange_id = ?").all(ex.id) as { giver_id: string; receiver_id: string }[]).map((e) => ({ giverId: e.giver_id, receiverId: e.receiver_id }))
    : undefined;
  return {
    id: ex.id,
    name: ex.name,
    date: ex.event_date,
    budget: ex.budget,
    status: ex.status,
    drawCount: ex.draw_count,
    drawnAt: ex.drawn_at,
    organiser: { name: organiser?.display_name ?? "", householdName: householdRow(db, ex.household_id)?.name ?? "", isMe: ex.organiser_user_id === user.id },
    canManage: manage,
    ...(manage ? { organiserPeek: ex.organiser_peek === 1, avoidPrevious: ex.avoid_previous === 1 } : {}),
    youAreIn: iAmIn,
    participants: participants.map((p) => ({ ...p, isMe: p.personId === user.personId })),
    mine,
    ...(exclusions ? { exclusions } : {}),
    ...(assignments ? { assignments } : {}),
  };
}

function getRow(db: Db, id: string): ExchangeRow | undefined {
  return db.prepare(`SELECT ${COLS} FROM exchanges WHERE id = ?`).get(id) as ExchangeRow | undefined;
}

export function listExchanges(db: Db, user: User) {
  const rows = db
    .prepare(
      `SELECT ${COLS} FROM exchanges e WHERE e.household_id = ?
       OR EXISTS (SELECT 1 FROM exchange_participants p WHERE p.exchange_id = e.id AND p.person_id = ?)
       ORDER BY event_date DESC, created_at DESC`,
    )
    .all(user.householdId, user.personId ?? "") as ExchangeRow[];
  return rows.map((row) => viewExchange(db, row, user));
}

/** Forbidden pairs from the exclusions, plus last time's pairs when asked to avoid repeats. */
export function forbiddenPairs(db: Db, ex: ExchangeRow, ids: string[]): [string, string][] {
  const set = new Set(ids);
  const pairs: [string, string][] = (db.prepare("SELECT giver_id, receiver_id FROM exchange_exclusions WHERE exchange_id = ?").all(ex.id) as { giver_id: string; receiver_id: string }[])
    .map((r) => [r.giver_id, r.receiver_id] as [string, string]);
  if (ex.avoid_previous === 1) {
    const prev = db
      .prepare(
        `SELECT id FROM exchanges WHERE household_id = ? AND id != ? AND status = 'drawn' AND event_date < ? ORDER BY event_date DESC, created_at DESC LIMIT 1`,
      )
      .get(ex.household_id, ex.id, ex.event_date) as { id: string } | undefined;
    if (prev) {
      for (const r of db.prepare("SELECT giver_id, receiver_id FROM exchange_assignments WHERE exchange_id = ?").all(prev.id) as { giver_id: string; receiver_id: string }[]) {
        if (set.has(r.giver_id) && set.has(r.receiver_id)) pairs.push([r.giver_id, r.receiver_id]);
      }
    }
  }
  return pairs;
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function cleanBudget(value: unknown): number | null | "bad" {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : "bad";
}

export const exchangeHandler: Handler = async (c) => {
  if (c.resource !== "exchanges") return null;
  const { db, method, id, rest, body, session } = c;
  const user = session.user;

  if (method === "GET" && id === undefined) return json({ exchanges: listExchanges(db, user) });
  if (method === "GET" && id === "candidates") return json({ people: candidates(db, user) });

  if (method === "POST" && id === undefined) {
    const input = (body ?? {}) as Record<string, unknown>;
    const name = cleanText(input.name, 80);
    if (!name) return error(400, "Name the exchange.");
    const date = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : null;
    if (!date) return error(400, "Pick the date of the exchange.");
    const budget = cleanBudget(input.budget);
    if (budget === "bad") return error(400, "Budget should be a number.");
    const exId = randomUUID();
    db.prepare(
      `INSERT INTO exchanges (id, household_id, organiser_user_id, name, event_date, budget, organiser_peek, avoid_previous, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(exId, user.householdId, user.id, name, date, budget, input.organiserPeek === true ? 1 : 0, input.avoidPrevious === true ? 1 : 0, new Date().toISOString());
    return json({ exchange: viewExchange(db, getRow(db, exId)!, user) }, { status: 201 });
  }

  if (id === undefined) return null;
  const ex = getRow(db, id);
  // Anyone who can't see an exchange gets the same answer as for one that doesn't exist.
  if (!ex || !canSee(db, ex, user)) return error(404, SHAPE_MESSAGE);

  if (method === "GET" && rest.length === 0) return json({ exchange: viewExchange(db, ex, user) });
  if (!canManage(ex, user)) return error(403, "Only the organiser can change this exchange.");

  const confirmed = (body as { confirm?: unknown } | null)?.confirm === true;
  const needsConfirm = () =>
    ex.status === "drawn" && !confirmed
      ? error(409, "This exchange is already drawn. Changing who’s in it clears the draw, so you’ll need to draw again. Confirm to continue.")
      : null;
  const clearDraw = () => {
    db.prepare("DELETE FROM exchange_assignments WHERE exchange_id = ?").run(ex.id);
    db.prepare("UPDATE exchanges SET status = 'draft' WHERE id = ?").run(ex.id);
  };

  if (method === "PATCH" && rest.length === 0) {
    const input = (body ?? {}) as Record<string, unknown>;
    const name = input.name !== undefined ? cleanText(input.name, 80) : ex.name;
    if (!name) return error(400, "Name the exchange.");
    const date = input.date !== undefined ? (typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : null) : ex.event_date;
    if (!date) return error(400, "Pick the date of the exchange.");
    const budget = input.budget !== undefined ? cleanBudget(input.budget) : ex.budget;
    if (budget === "bad") return error(400, "Budget should be a number.");
    const peek = input.organiserPeek !== undefined ? (input.organiserPeek === true ? 1 : 0) : ex.organiser_peek;
    if (peek === 1 && ex.organiser_peek === 0 && ex.organiser_user_id !== user.id) return error(403, "Only the organiser can turn on peeking.");
    // Peeking is decided before the draw: switching it on afterwards would let the organiser read every pairing.
    if (peek === 1 && ex.organiser_peek === 0 && ex.status === "drawn") return error(409, "Peeking has to be chosen before the draw. Start a new exchange to use it.");
    const avoid = input.avoidPrevious !== undefined ? (input.avoidPrevious === true ? 1 : 0) : ex.avoid_previous;
    db.prepare("UPDATE exchanges SET name = ?, event_date = ?, budget = ?, organiser_peek = ?, avoid_previous = ? WHERE id = ?").run(name, date, budget, peek, avoid, ex.id);
    return json({ exchange: viewExchange(db, getRow(db, ex.id)!, user) });
  }

  if (method === "DELETE" && rest.length === 0) {
    transaction(db, () => {
      for (const t of ["exchange_participants", "exchange_exclusions", "exchange_assignments"]) db.prepare(`DELETE FROM ${t} WHERE exchange_id = ?`).run(ex.id);
      db.prepare("DELETE FROM exchanges WHERE id = ?").run(ex.id);
    });
    return json({ ok: true });
  }

  if (method === "PUT" && rest[0] === "participants") {
    const wanted = (body as { personIds?: unknown } | null)?.personIds;
    if (!Array.isArray(wanted) || wanted.length > 60) return error(400, "Send a list of people.");
    const allowed = new Map(candidates(db, user).map((p) => [p.personId, p]));
    const ids = [...new Set(wanted.filter((v): v is string => typeof v === "string"))];
    if (ids.some((pid) => !allowed.has(pid))) return error(400, "Some of those people can’t take part. They need to be in your household or shared by a linked one.");
    const current = new Set(participantIds(db, ex.id));
    const changed = ids.length !== current.size || ids.some((pid) => !current.has(pid));
    if (changed) {
      const refuse = needsConfirm();
      if (refuse) return refuse;
    }
    transaction(db, () => {
      for (const pid of current) if (!ids.includes(pid)) removeFromExchange(db, ex.id, pid);
      const add = db.prepare("INSERT OR IGNORE INTO exchange_participants (exchange_id, person_id, household_id, name) VALUES (?, ?, ?, ?)");
      for (const pid of ids) add.run(ex.id, pid, allowed.get(pid)!.householdId, allowed.get(pid)!.name);
      if (changed) clearDraw();
    });
    return json({ exchange: viewExchange(db, getRow(db, ex.id)!, user) });
  }

  if (method === "PUT" && rest[0] === "exclusions") {
    const pairs = (body as { pairs?: unknown } | null)?.pairs;
    if (!Array.isArray(pairs) || pairs.length > 400) return error(400, "Send a list of pairs.");
    const inside = new Set(participantIds(db, ex.id));
    const clean: [string, string][] = [];
    for (const pair of pairs) {
      if (!Array.isArray(pair) || pair.length < 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string") return error(400, "Each exclusion is a pair of people.");
      if (!inside.has(pair[0]) || !inside.has(pair[1]) || pair[0] === pair[1]) return error(400, "Exclusions can only be between two different participants.");
      const mutual = pair[2] !== false; // couples: neither gives to the other
      clean.push([pair[0], pair[1]]);
      if (mutual) clean.push([pair[1], pair[0]]);
    }
    const before = (db.prepare("SELECT giver_id, receiver_id FROM exchange_exclusions WHERE exchange_id = ?").all(ex.id) as { giver_id: string; receiver_id: string }[]).map((r) => `${r.giver_id}>${r.receiver_id}`).sort().join();
    const after = [...new Set(clean.map(([a, b]) => `${a}>${b}`))].sort().join();
    if (before !== after) {
      const refuse = needsConfirm();
      if (refuse) return refuse;
    }
    transaction(db, () => {
      db.prepare("DELETE FROM exchange_exclusions WHERE exchange_id = ?").run(ex.id);
      const add = db.prepare("INSERT OR IGNORE INTO exchange_exclusions (exchange_id, giver_id, receiver_id) VALUES (?, ?, ?)");
      for (const [a, b] of clean) add.run(ex.id, a, b);
      if (before !== after) clearDraw();
    });
    return json({ exchange: viewExchange(db, getRow(db, ex.id)!, user) });
  }

  if (method === "POST" && rest[0] === "check") {
    const ids = participantIds(db, ex.id);
    const result = solvable(ids, forbiddenPairs(db, ex, ids));
    const names = (ids2: string[] | undefined) => (ids2 ?? []).map((pid) => personInfo(db, pid)?.name ?? "");
    return json(result.ok ? { ok: true } : { ok: false, reason: result.reason, detail: result.detail, stuck: names(result.stuckIds) });
  }

  if (method === "POST" && rest[0] === "draw") {
    if (ex.status === "drawn" && !confirmed) {
      return error(409, "This exchange is already drawn. Drawing again replaces everyone’s assignment. Confirm to continue.");
    }
    const ids = participantIds(db, ex.id);
    const result = draw({ ids, forbidden: forbiddenPairs(db, ex, ids) });
    if (!result.ok) return json({ error: result.detail, reason: result.reason, stuck: (result.stuckIds ?? []).map((pid) => personInfo(db, pid)?.name ?? "") }, { status: 422 });
    transaction(db, () => {
      db.prepare("DELETE FROM exchange_assignments WHERE exchange_id = ?").run(ex.id);
      const add = db.prepare("INSERT INTO exchange_assignments (exchange_id, giver_id, receiver_id) VALUES (?, ?, ?)");
      for (const [giver, receiver] of result.pairs) add.run(ex.id, giver, receiver);
      db.prepare("UPDATE exchanges SET status = 'drawn', draw_count = draw_count + 1, drawn_at = ? WHERE id = ?").run(new Date().toISOString(), ex.id);
    });
    return json({ exchange: viewExchange(db, getRow(db, ex.id)!, user) });
  }
  void areLinked;
  return null;
};
