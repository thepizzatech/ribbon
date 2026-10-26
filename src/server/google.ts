import type { Db } from "./db.ts";
import type { ConnectionRow, SyncResult } from "./calendar-store.ts";
import type { Handler } from "./http.ts";
import { error } from "./http.ts";
export async function syncGoogle(_db: Db, _row: ConnectionRow): Promise<SyncResult> { return { ok: false, error: "todo" }; }
export async function disconnectGoogle(_db: Db, _row: ConnectionRow) {}
export const googleHandler: Handler = () => error(404, "Not available.");
