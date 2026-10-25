// Registry of feature modules. Each exports API handlers; api.ts mounts them.
import type { Db } from "./db.ts";
import type { Handler, PublicHandler } from "./http.ts";
import type { Session } from "./users.ts";
import { wishlistHandler } from "./wishlist.ts";

export const extraPublicHandlers: PublicHandler[] = [];
export const extraHandlers: Handler[] = [wishlistHandler];

/** Extra fields feature modules add to GET /api/session. */
const sessionFieldProviders: ((db: Db, session: Session | null, request: Request) => Record<string, unknown>)[] = [];
export function extraSessionFields(db: Db, session: Session | null, request: Request): Record<string, unknown> {
  return Object.assign({}, ...sessionFieldProviders.map((provider) => provider(db, session, request)));
}
