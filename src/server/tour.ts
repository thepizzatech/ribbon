// Whether to show the guided tour: remembered per login (null, done or skipped).
import { seedSampleData, tourAlways, tourInDev } from "./config.ts";
import type { Db } from "./db.ts";
import { error, json, type Handler } from "./http.ts";
import type { User } from "./users.ts";
import { welcomePending } from "./welcome.ts";

export type TourState = "done" | "skipped" | null;

export function getTour(db: Db, userId: string): { state: TourState; at: string | null } {
  const row = db.prepare("SELECT tour_state, tour_at FROM user_prefs WHERE user_id = ?").get(userId) as { tour_state: TourState; tour_at: string | null } | undefined;
  return { state: row?.tour_state ?? null, at: row?.tour_at ?? null };
}

/** Should the app open the tour by itself? (Replaying from Settings always works.) */
export function tourAutoShow(state: TourState): boolean {
  const optedIn = tourAlways() || tourInDev();
  if (seedSampleData() && !optedIn) return false;
  if (tourAlways()) return state !== "done";
  return state === null;
}

export function tourFields(db: Db, user: Pick<User, "id" | "role" | "householdId"> | null) {
  if (!user) return { tour: null };
  const t = getTour(db, user.id);
  // The tour follows the Welcome setup: it never opens over the wizard.
  return { tour: { state: t.state, at: t.at, autoShow: tourAutoShow(t.state) && !welcomePending(db, user) } };
}

export const tourHandler: Handler = (c) => {
  if (c.resource !== "me" || c.id !== "tour" || c.method !== "POST") return null;
  const state = (c.body as { state?: unknown } | null)?.state;
  if (state !== "done" && state !== "skipped" && state !== "reset") return error(400, "State is done, skipped or reset.");
  c.db.prepare("INSERT OR IGNORE INTO user_prefs (user_id) VALUES (?)").run(c.session.user.id);
  c.db
    .prepare("UPDATE user_prefs SET tour_state = ?, tour_at = ? WHERE user_id = ?")
    .run(state === "reset" ? null : state, state === "reset" ? null : new Date().toISOString(), c.session.user.id);
  return json(tourFields(c.db, c.session.user));
};
