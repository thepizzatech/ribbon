// The Welcome setup: after the very first sign-in the owner names the household and adds family members.
// Progress lives in the database (households.setup_complete / setup_step), so it resumes after a reload, a
// sign-out or another device. The server enforces it: while it is pending the owner can reach nothing but this
// flow (and sign-out / change password); members never see it.
import { randomUUID } from "node:crypto";
import { normalizeRelationship, relationshipLabel, type Person } from "../lib/gifts/model.ts";
import { seedSampleData } from "./config.ts";
import { transaction, type Db } from "./db.ts";
import { error, json, type ApiCall, type Handler } from "./http.ts";
import type { User } from "./users.ts";

export type WelcomeMember = { name: string; relationship: string; role?: string; household: boolean };

/** Parse the family list the wizard sends. A string is the reason it was refused. */
export function readMembers(input: unknown): Person[] | string {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 30) return "Add up to 30 family members.";
  const people: Person[] = [];
  for (const item of input as Partial<WelcomeMember>[]) {
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

type Row = { setup_complete: number; setup_step: number; name: string };

function householdSetup(db: Db, householdId: string): Row | undefined {
  return db.prepare("SELECT setup_complete, setup_step, name FROM households WHERE id = ?").get(householdId) as Row | undefined;
}

/** True when this login is an owner whose household has not finished the Welcome setup. Sample-data development skips it. */
export function welcomePending(db: Db, user: Pick<User, "role" | "householdId">): boolean {
  if (user.role !== "owner" || seedSampleData()) return false;
  const row = householdSetup(db, user.householdId);
  return Boolean(row) && row!.setup_complete === 0;
}

/** What an owner may still do while the Welcome setup is pending. */
export function allowedDuringWelcome(resource: string | undefined, id: string | undefined, method: string): boolean {
  if (resource === "welcome") return true;
  if (resource === "logout" && method === "POST") return true;
  if (resource === "account" && id === "password" && method === "POST") return true;
  return false;
}

export function welcomeState(db: Db, user: User) {
  const row = householdSetup(db, user.householdId)!;
  const self = user.personId ? (db.prepare("SELECT name FROM people WHERE id = ?").get(user.personId) as { name: string } | undefined) : undefined;
  const members = (
    db
      .prepare("SELECT name, relationship, role, circle FROM people WHERE household_id = ? AND id != ? ORDER BY seq")
      .all(user.householdId, user.personId ?? "") as { name: string; relationship: string; role: string; circle: string }[]
  ).map((p) => ({ name: p.name, relationship: p.relationship, role: p.relationship === "other" ? p.role : "", household: p.circle === "household" }));
  return {
    familyName: row.name,
    yourName: self?.name && self.name !== user.username ? self.name : "",
    step: Math.min(Math.max(row.setup_step, 1), 2),
    members,
  };
}

type Input = { familyName?: unknown; yourName?: unknown; members?: unknown; step?: unknown };

/** Save whatever the wizard sent. Returns a message when something is invalid. */
function apply(db: Db, user: User, input: Input, finishing: boolean): string | null {
  const familyName = input.familyName === undefined ? undefined : typeof input.familyName === "string" ? input.familyName.trim().slice(0, 80) : null;
  if (familyName === null) return "Give your family a name.";
  const yourName = input.yourName === undefined ? undefined : typeof input.yourName === "string" ? input.yourName.trim().slice(0, 80) : null;
  if (yourName === null) return "Your name should be text.";
  const members = input.members === undefined ? undefined : readMembers(input.members);
  if (typeof members === "string") return members;
  const step = input.step === 1 || input.step === 2 ? input.step : undefined;
  if (finishing) {
    const effective = familyName ?? householdSetup(db, user.householdId)?.name ?? "";
    if (!effective) return "Give your family a name.";
  }
  transaction(db, () => {
    if (familyName !== undefined) db.prepare("UPDATE households SET name = ? WHERE id = ?").run(familyName, user.householdId);
    if (yourName) {
      if (user.personId) db.prepare("UPDATE people SET name = ? WHERE id = ? AND household_id = ?").run(yourName, user.personId, user.householdId);
      db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(yourName, user.id);
    }
    if (members !== undefined) {
      // Nothing else exists yet (the rest of the API is closed until setup finishes), so the list is simply replaced.
      db.prepare("DELETE FROM people WHERE household_id = ? AND id != ?").run(user.householdId, user.personId ?? "");
      const insert = db.prepare(
        "INSERT INTO people (id, seq, name, role, circle, relationship, household_id, birthday, anniversary, shared) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0)",
      );
      let seq = (db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM people").get() as { n: number }).n;
      for (const p of members) insert.run(p.id, seq++, p.name, p.role, p.circle, p.relationship, user.householdId);
    }
    if (step !== undefined) db.prepare("UPDATE households SET setup_step = ? WHERE id = ?").run(step, user.householdId);
    if (finishing) db.prepare("UPDATE households SET setup_complete = 1, setup_step = 2 WHERE id = ?").run(user.householdId);
  });
  return null;
}

export const welcomeHandler: Handler = (c: ApiCall) => {
  if (c.resource !== "welcome") return null;
  const user = c.session.user;
  // Members, and owners who are already done, get the same answer as for a page that does not exist.
  if (!welcomePending(c.db, user)) return error(404, "Not found.");
  if (c.method === "GET" && c.id === undefined) return json({ required: true, ...welcomeState(c.db, user) });
  const input = (c.body ?? {}) as Input;
  if (c.method === "PUT" && c.id === undefined) {
    const problem = apply(c.db, user, input, false);
    return problem ? error(400, problem) : json({ required: true, ...welcomeState(c.db, user) });
  }
  if (c.method === "POST" && c.id === "complete" && c.rest.length === 0) {
    const problem = apply(c.db, user, input, true);
    return problem ? error(400, problem) : json({ ok: true });
  }
  return null;
};
