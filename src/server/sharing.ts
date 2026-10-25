// Links between households: invite codes, who can see whose shared people and wishlists.
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "./db.ts";
import { transaction } from "./db.ts";
import { purgeAfterUnlink } from "./exchange-cleanup.ts";

export const INVITE_DAYS = 7;
const hashCode = (code: string) => createHash("sha256").update(code.trim().toUpperCase()).digest("hex");

export function linkedHouseholdIds(db: Db, hid: string): string[] {
  return (db.prepare("SELECT other_id FROM household_links WHERE household_id = ?").all(hid) as { other_id: string }[]).map(
    (row) => row.other_id,
  );
}

export function areLinked(db: Db, a: string, b: string): boolean {
  return a === b || Boolean(db.prepare("SELECT 1 FROM household_links WHERE household_id = ? AND other_id = ?").get(a, b));
}

/** A short, typeable, single-use code. Only its hash is stored. */
export function createInvite(db: Db, hid: string, userId: string, now = Date.now()): { code: string; expiresAt: number } {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  let code = "";
  for (let i = 0; i < 12; i += 1) code += alphabet[bytes[i]! % alphabet.length];
  code = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
  const expiresAt = now + INVITE_DAYS * 24 * 60 * 60 * 1000;
  db.prepare("DELETE FROM household_invites WHERE expires_at < ? OR used_at IS NOT NULL").run(now);
  db.prepare(
    "INSERT INTO household_invites (code_hash, household_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  ).run(hashCode(code), hid, userId, now, expiresAt);
  return { code, expiresAt };
}

export function inviteInfo(db: Db, code: string, now = Date.now()): { householdId: string; name: string } | null {
  const row = db
    .prepare(
      `SELECT i.household_id AS id, h.name FROM household_invites i JOIN households h ON h.id = i.household_id
       WHERE i.code_hash = ? AND i.used_at IS NULL AND i.expires_at > ?`,
    )
    .get(hashCode(code), now) as { id: string; name: string } | undefined;
  return row ? { householdId: row.id, name: row.name } : null;
}

/** Mark an invite used and link the two households both ways. Returns the inviting household, or an error. */
export function redeemInvite(db: Db, code: string, hid: string, now = Date.now()): { ok: true; otherId: string } | { ok: false; reason: string } {
  const info = inviteInfo(db, code, now);
  if (!info) return { ok: false, reason: "That invite code isn’t valid, or it has expired." };
  if (info.householdId === hid) return { ok: false, reason: "That invite is from your own household." };
  if (areLinked(db, hid, info.householdId)) return { ok: false, reason: "Your households are already linked." };
  transaction(db, () => {
    db.prepare("UPDATE household_invites SET used_at = ? WHERE code_hash = ?").run(now, hashCode(code));
    const link = db.prepare("INSERT OR IGNORE INTO household_links (household_id, other_id, created_at) VALUES (?, ?, ?)");
    const at = new Date(now).toISOString();
    link.run(hid, info.householdId, at);
    link.run(info.householdId, hid, at);
  });
  return { ok: true, otherId: info.householdId };
}

export function unlink(db: Db, a: string, b: string) {
  transaction(db, () => {
    db.prepare("DELETE FROM household_links WHERE (household_id = ? AND other_id = ?) OR (household_id = ? AND other_id = ?)").run(a, b, b, a);
    purgeAfterUnlink(db, a, b);
    // Anything one side reserved on the other's lists goes with the link.
    db.prepare(
      `UPDATE wishlist_items SET status = 'wanted', claimed_by_user_id = NULL, claimed_by_name = ''
       WHERE household_id = ? AND claimed_by_user_id IN (SELECT id FROM users WHERE household_id = ?)`,
    ).run(a, b);
    db.prepare(
      `UPDATE wishlist_items SET status = 'wanted', claimed_by_user_id = NULL, claimed_by_name = ''
       WHERE household_id = ? AND claimed_by_user_id IN (SELECT id FROM users WHERE household_id = ?)`,
    ).run(b, a);
  });
}

// ---- API ----

import { error, json, type Handler } from "./http.ts";
import { householdRow } from "./ledger.ts";

const joinMisses = new Map<string, { count: number; since: number }>();
const JOIN_WINDOW = 15 * 60 * 1000;
export const resetJoinLimits = () => joinMisses.clear();

export function sharingSummary(db: Db, hid: string) {
  const links = linkedHouseholdIds(db, hid)
    .map((id) => householdRow(db, id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => ({ id: row.id, name: row.name }));
  const sharedPeople = (db.prepare("SELECT COUNT(*) AS n FROM people WHERE household_id = ? AND shared = 1").get(hid) as { n: number }).n;
  return { household: { id: hid, name: householdRow(db, hid)?.name ?? "" }, links, sharedPeople };
}

export const sharingHandler: Handler = async (c) => {
  if (c.resource !== "sharing") return null;
  const { db, method, id, rest, session } = c;
  const hid = session.user.householdId;
  if (method === "GET" && id === undefined) return json(sharingSummary(db, hid));
  if (!c.isOwner) return error(403, "Only a household owner can change sharing.");
  if (method === "POST" && id === "invite") {
    const made = createInvite(db, hid, session.user.id);
    return json({ code: made.code, expiresAt: made.expiresAt }, { status: 201 });
  }
  if (method === "POST" && id === "join") {
    const now = Date.now();
    const key = session.user.id;
    const entry = joinMisses.get(key);
    if (entry && now - entry.since < JOIN_WINDOW && entry.count >= 10) return error(429, "Too many tries. Wait a few minutes and try again.");
    const code = String((c.body as { code?: unknown } | null)?.code ?? "");
    const result = redeemInvite(db, code, hid, now);
    if (!result.ok) {
      const fresh = entry && now - entry.since < JOIN_WINDOW ? entry : { count: 0, since: now };
      fresh.count += 1;
      joinMisses.set(key, fresh);
      return error(400, result.reason);
    }
    joinMisses.delete(key);
    return json(sharingSummary(db, hid));
  }
  if (method === "DELETE" && id === "links" && rest.length === 1) {
    const other = decodeURIComponent(rest[0]!);
    if (!areLinked(db, hid, other) || other === hid) return error(404, "That household isn’t linked.");
    unlink(db, hid, other);
    return json(sharingSummary(db, hid));
  }
  return null;
};
