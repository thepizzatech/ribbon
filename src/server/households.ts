// More than one household on a server: the person who set Ribbon up (the instance admin) adds another family
// with its own owner login. The two families can then link up (see sharing.ts) and share wishlists.
import { randomUUID } from "node:crypto";
import type { Person } from "../lib/gifts/model.ts";
import { isInstanceAdmin } from "./backup.ts";
import { error, json, type Handler } from "./http.ts";
import { createHousehold } from "./ledger.ts";
import { hashPassword, passwordProblem } from "./password.ts";
import { createUser, findUserByName, normalizeUsername } from "./users.ts";

export const householdsHandler: Handler = async (c) => {
  if (c.resource !== "households") return null;
  const { db, method, session } = c;
  if (!isInstanceAdmin(db, session.user)) return error(403, "Only the person who set up Ribbon can add another household.");

  if (method === "GET" && c.id === undefined) {
    const rows = db
      .prepare(
        `SELECT h.id, h.name,
           (SELECT COUNT(*) FROM users u WHERE u.household_id = h.id) AS logins,
           (SELECT u.display_name FROM users u WHERE u.household_id = h.id AND u.role = 'owner' ORDER BY u.created_at, u.rowid LIMIT 1) AS owner
         FROM households h ORDER BY h.created_at, h.rowid`,
      )
      .all() as { id: string; name: string; logins: number; owner: string | null }[];
    return json({ households: rows.map((r) => ({ id: r.id, name: r.name, logins: r.logins, owner: r.owner ?? "" , mine: r.id === session.user.householdId })) });
  }

  if (method === "POST" && c.id === undefined) {
    const body = (c.body ?? {}) as { familyName?: unknown; yourName?: unknown; username?: unknown; password?: unknown };
    const familyName = typeof body.familyName === "string" ? body.familyName.trim().slice(0, 80) : "";
    if (!familyName) return error(400, "Give the household a name.");
    const username = normalizeUsername(body.username);
    if (!username) return error(400, "Pick a username of 3 or more letters or numbers (an email works too).");
    const problem = passwordProblem(body.password, username);
    if (problem) return error(400, problem);
    if (findUserByName(db, username)) return error(409, "That username is taken.");
    const yourName = typeof body.yourName === "string" && body.yourName.trim() ? body.yourName.trim().slice(0, 80) : username;
    const passwordHash = await hashPassword(body.password as string);
    const selfId = randomUUID();
    const people: Person[] = [{ id: selfId, name: yourName, role: "You", relationship: "self", circle: "household" }];
    const hid = createHousehold(db, familyName, people);
    createUser(db, { username, displayName: yourName, role: "owner", passwordHash, householdId: hid, personId: selfId });
    return json({ household: { id: hid, name: familyName, logins: 1, owner: yourName, mine: false } }, { status: 201 });
  }
  return null;
};
