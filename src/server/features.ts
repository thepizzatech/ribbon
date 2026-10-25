// Registry of feature modules. Each exports API handlers; api.ts mounts them.
import type { Db } from "./db.ts";
import type { Handler, PublicHandler } from "./http.ts";
import type { Session } from "./users.ts";
import { wishlistHandler } from "./wishlist.ts";
import { sharingHandler } from "./sharing.ts";
import { householdsHandler } from "./households.ts";
import { exchangeHandler } from "./secretsanta.ts";
import { oidcHandler, oidcPublicHandler, oidcSummary } from "./oidc.ts";
import { passkeyHandler, passkeyPublicHandler, listPasskeys } from "./passkeys.ts";
import { tourFields, tourHandler } from "./tour.ts";
import { csvHandler } from "./csv.ts";
import { backupsHandler, isInstanceAdmin } from "./backup.ts";
import { budgetsHandler } from "./budgets.ts";
import { calendarHandler, calendarPublicHandler } from "./calendar.ts";

export const extraPublicHandlers: PublicHandler[] = [calendarPublicHandler, oidcPublicHandler, passkeyPublicHandler];
export const extraHandlers: Handler[] = [wishlistHandler, budgetsHandler, calendarHandler, backupsHandler, csvHandler, householdsHandler, sharingHandler, exchangeHandler, oidcHandler, passkeyHandler, tourHandler];

/** Extra fields feature modules add to GET /api/session. */
const sessionFieldProviders: ((db: Db, session: Session | null, request: Request) => Record<string, unknown>)[] = [
  (db, session) => ({ sso: oidcSummary(db, session?.user.id) }),
  (db, session) => ({
    passkeys: session ? listPasskeys(db, session.user.id).length : 0,
    isAdmin: session ? isInstanceAdmin(db, session.user) : false,
  }),
  (db, session) => tourFields(db, session?.user ?? null),
];
export function extraSessionFields(db: Db, session: Session | null, request: Request): Record<string, unknown> {
  return Object.assign({}, ...sessionFieldProviders.map((provider) => provider(db, session, request)));
}
