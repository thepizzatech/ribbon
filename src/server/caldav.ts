import type { Db } from "./db.ts";
import type { ConnectionRow, SyncResult } from "./calendar-store.ts";
import type { ApiCall } from "./http.ts";
import { error } from "./http.ts";
export async function syncCaldav(_db: Db, _row: ConnectionRow): Promise<SyncResult> { return { ok: false, error: "todo" }; }
export async function caldavConnect(_c: ApiCall, _o: unknown): Promise<Response> { return error(501, "todo"); }
export async function caldavDiscover(_c: ApiCall): Promise<Response> { return error(501, "todo"); }
