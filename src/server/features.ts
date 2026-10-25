// Registry of feature modules. Each exports API handlers; api.ts mounts them.
import type { Db } from "./db.ts";
import type { Handler, PublicHandler } from "./http.ts";
import type { Session } from "./users.ts";
import { wishlistHandler } from "./wishlist.ts";
import { csvHandler } from "./csv.ts";
import { backupsHandler } from "./backup.ts";
import { budgetsHandler } from "./budgets.ts";
import { calendarHandler, calendarPublicHandler } from "./calendar.ts";

export const extraPublicHandlers: PublicHandler[] = [calendarPublicHandler];
export const extraHandlers: Handler[] = [wishlistHandler, budgetsHandler, calendarHandler, backupsHandler, csvHandler];

/** Extra fields feature modules add to GET /api/session. */
const sessionFieldProviders: ((db: Db, session: Session | null, request: Request) => Record<string, unknown>)[] = [];
export function extraSessionFields(db: Db, session: Session | null, request: Request): Record<string, unknown> {
  return Object.assign({}, ...sessionFieldProviders.map((provider) => provider(db, session, request)));
}
