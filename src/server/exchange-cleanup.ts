// Keep Secret Santa data consistent when people leave or households unlink.
import type { Db } from "./db.ts";

/** Remove a person from one exchange. A drawn exchange loses its draw, because the pairing no longer works. */
export function removeFromExchange(db: Db, exchangeId: string, personId: string) {
  db.prepare("DELETE FROM exchange_participants WHERE exchange_id = ? AND person_id = ?").run(exchangeId, personId);
  db.prepare("DELETE FROM exchange_exclusions WHERE exchange_id = ? AND (giver_id = ? OR receiver_id = ?)").run(exchangeId, personId, personId);
  db.prepare("DELETE FROM exchange_assignments WHERE exchange_id = ?").run(exchangeId);
  db.prepare("UPDATE exchanges SET status = 'draft' WHERE id = ? AND status = 'drawn'").run(exchangeId);
}

/** A person is deleted: out of every exchange. */
export function purgeParticipants(db: Db, personIds: string[]) {
  for (const id of personIds) {
    const rows = db.prepare("SELECT exchange_id FROM exchange_participants WHERE person_id = ?").all(id) as { exchange_id: string }[];
    for (const row of rows) removeFromExchange(db, row.exchange_id, id);
  }
}

/** After two households unlink: drop each side's people from the other's exchanges. */
export function purgeAfterUnlink(db: Db, a: string, b: string) {
  for (const [host, guest] of [[a, b], [b, a]] as const) {
    const rows = db
      .prepare(
        `SELECT p.exchange_id, p.person_id FROM exchange_participants p JOIN exchanges e ON e.id = p.exchange_id
         WHERE e.household_id = ? AND p.household_id = ?`,
      )
      .all(host, guest) as { exchange_id: string; person_id: string }[];
    for (const row of rows) removeFromExchange(db, row.exchange_id, row.person_id);
  }
}

/** A person stopped being shared: they leave exchanges run by other households. */
export function purgeGuest(db: Db, personId: string, ownHousehold: string) {
  const rows = db
    .prepare(
      `SELECT p.exchange_id FROM exchange_participants p JOIN exchanges e ON e.id = p.exchange_id
       WHERE p.person_id = ? AND e.household_id != ?`,
    )
    .all(personId, ownHousehold) as { exchange_id: string }[];
  for (const row of rows) removeFromExchange(db, row.exchange_id, personId);
}
