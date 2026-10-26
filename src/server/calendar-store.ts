// Calendar connections and imported events: rows, public views, and the one place events are replaced.
import { randomUUID } from "node:crypto";
import { transaction, type Db } from "./db.ts";
import { calendarSyncHours } from "./config.ts";
import { open, seal } from "./secrets.ts";
import type { EventRow } from "./ics.ts";

export const KINDS = ["ics_url", "ics_file", "google", "caldav"] as const;
export type Kind = (typeof KINDS)[number];
/** Named tones (the UI maps each to a light and a dark pastel); nothing free-form reaches CSS. */
export const COLORS = ["purple", "pink", "red", "blue", "green", "amber"] as const;
export type Color = (typeof COLORS)[number];
export const isColor = (value: unknown): value is Color => typeof value === "string" && (COLORS as readonly string[]).includes(value);

export type Status = "pending" | "ok" | "error" | "reauth";

export type ConnectionRow = {
  id: string;
  user_id: string;
  household_id: string;
  kind: Kind;
  name: string;
  color: Color;
  enabled: number;
  shared: number;
  source_enc: string | null;
  state: string;
  sync_hours: number | null;
  last_synced_at: string | null;
  last_attempt_at: string | null;
  last_status: Status;
  last_error: string | null;
  failures: number;
  event_count: number;
  created_at: string;
};

const COLS = "id, user_id, household_id, kind, name, color, enabled, shared, source_enc, state, sync_hours, last_synced_at, last_attempt_at, last_status, last_error, failures, event_count, created_at";

export const getConnection = (db: Db, id: string): ConnectionRow | undefined =>
  db.prepare(`SELECT ${COLS} FROM calendar_connections WHERE id = ?`).get(id) as ConnectionRow | undefined;

/** A connection the user owns (and in their household). Everyone else gets "not found". */
export const getOwnConnection = (db: Db, id: string, userId: string, householdId: string): ConnectionRow | undefined => {
  const row = getConnection(db, id);
  return row && row.user_id === userId && row.household_id === householdId ? row : undefined;
};

export const ownConnections = (db: Db, userId: string, householdId: string): ConnectionRow[] =>
  db.prepare(`SELECT ${COLS} FROM calendar_connections WHERE user_id = ? AND household_id = ? ORDER BY created_at, id`).all(userId, householdId) as ConnectionRow[];

export const connectionCount = (db: Db, userId: string): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM calendar_connections WHERE user_id = ?").get(userId) as { n: number }).n;

export type SourceSecret = Record<string, unknown>;

/** The decrypted private part of a connection (feed URL, CalDAV login, Google tokens), or null if it can't be read. */
export function readSource<T extends SourceSecret = SourceSecret>(db: Db, row: Pick<ConnectionRow, "id" | "source_enc">): T | null {
  const text = open(db, row.source_enc, row.id);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export const writeSource = (db: Db, id: string, source: SourceSecret) => {
  db.prepare("UPDATE calendar_connections SET source_enc = ? WHERE id = ?").run(seal(db, JSON.stringify(source), id), id);
};

export function readState<T extends Record<string, unknown> = Record<string, unknown>>(row: Pick<ConnectionRow, "state">): T {
  try {
    const parsed = JSON.parse(row.state) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

export const writeState = (db: Db, id: string, state: Record<string, unknown>) => {
  db.prepare("UPDATE calendar_connections SET state = ? WHERE id = ?").run(JSON.stringify(state), id);
};

export type NewConnection = {
  userId: string;
  householdId: string;
  kind: Kind;
  name: string;
  color: Color;
  shared: boolean;
  source: SourceSecret;
  state?: Record<string, unknown>;
  syncHours?: number | null;
};

export function insertConnection(db: Db, input: NewConnection): ConnectionRow {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO calendar_connections (id, user_id, household_id, kind, name, color, enabled, shared, source_enc, state, sync_hours, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
  ).run(id, input.userId, input.householdId, input.kind, input.name, input.color, input.shared ? 1 : 0, seal(db, JSON.stringify(input.source), id), JSON.stringify(input.state ?? {}), input.syncHours ?? null, new Date().toISOString());
  return getConnection(db, id)!;
}

export const deleteConnection = (db: Db, id: string) => {
  db.prepare("DELETE FROM calendar_connections WHERE id = ?").run(id); // events and review marks go with it (ON DELETE CASCADE)
};

/** Replace every imported event of a connection in one transaction. */
export function replaceEvents(db: Db, id: string, rows: EventRow[]) {
  transaction(db, () => {
    db.prepare("DELETE FROM calendar_events WHERE connection_id = ?").run(id);
    const insert = db.prepare(
      "INSERT INTO calendar_events (id, connection_id, uid, title, description, location, all_day, starts, ends, suggest, suggest_name, suggest_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const r of rows) {
      insert.run(randomUUID(), id, r.uid, r.title, r.description, r.location, r.allDay ? 1 : 0, r.starts, r.ends, r.suggest, r.suggestName, r.suggestDate);
    }
    db.prepare("UPDATE calendar_connections SET event_count = ? WHERE id = ?").run(rows.length, id);
  });
}

export function markSynced(db: Db, id: string, note: string | null = null) {
  const now = new Date().toISOString();
  db.prepare("UPDATE calendar_connections SET last_status = 'ok', last_error = ?, failures = 0, last_synced_at = ?, last_attempt_at = ? WHERE id = ?").run(note, now, now, id);
}

export function markFailed(db: Db, id: string, message: string, status: "error" | "reauth" = "error") {
  db.prepare("UPDATE calendar_connections SET last_status = ?, last_error = ?, failures = failures + 1, last_attempt_at = ? WHERE id = ?").run(status, message.slice(0, 300), new Date().toISOString(), id);
}

export const markAttempt = (db: Db, id: string) => {
  db.prepare("UPDATE calendar_connections SET last_attempt_at = ? WHERE id = ?").run(new Date().toISOString(), id);
};

/** What the browser is told about a connection. The private source (URL, password, token) is never part of it. */
export function viewConnection(row: ConnectionRow, extra: { owner?: string } = {}) {
  const state = readState<{ host?: string; calendars?: unknown; contacts?: unknown; account?: unknown }>(row);
  return {
    id: row.id,
    kind: row.kind,
    experimental: row.kind === "caldav",
    name: row.name,
    color: row.color,
    enabled: row.enabled === 1,
    shared: row.shared === 1,
    host: typeof state.host === "string" ? state.host : null,
    account: typeof state.account === "string" ? state.account : null,
    calendars: Array.isArray(state.calendars) ? (state.calendars as { name?: unknown }[]).map((c) => String(c.name ?? "")).filter(Boolean).slice(0, 30) : [],
    syncHours: row.sync_hours,
    effectiveSyncHours: row.sync_hours ?? calendarSyncHours(),
    lastSyncedAt: row.last_synced_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    eventCount: row.event_count,
    syncs: row.kind !== "ics_file",
    ...extra,
  };
}
export type ConnectionView = ReturnType<typeof viewConnection>;

/** Birthday-like events found in a user's own connections that have no decision yet. */
export function pendingReviews(db: Db, userId: string, householdId: string) {
  const rows = db
    .prepare(
      `SELECT e.connection_id AS connectionId, e.uid, c.name AS connectionName, MIN(e.title) AS title, e.suggest AS kind,
              MIN(e.suggest_name) AS name, MIN(e.suggest_date) AS date
       FROM calendar_events e
       JOIN calendar_connections c ON c.id = e.connection_id
       LEFT JOIN calendar_reviews r ON r.connection_id = e.connection_id AND r.uid = e.uid
       WHERE c.user_id = ? AND c.household_id = ? AND e.suggest IS NOT NULL AND r.uid IS NULL
       GROUP BY e.connection_id, e.uid
       ORDER BY MIN(e.suggest_name), MIN(e.starts)
       LIMIT 500`,
    )
    .all(userId, householdId) as { connectionId: string; uid: string; connectionName: string; title: string; kind: "birthday" | "anniversary"; name: string; date: string }[];
  return rows;
}

// ---- shared by every kind of sync ----

export type SyncResult =
  | { ok: true; events: EventRow[] | "unchanged"; state?: Record<string, unknown>; note?: string | null }
  | { ok: false; error: string; reauth?: boolean };

export const fail = (error: string, reauth = false): SyncResult => ({ ok: false, error, reauth });
export const UNREADABLE = "Ribbon can’t read the saved login for this calendar any more (the APP_SECRET changed or the secret file was lost). Remove it and connect again.";

/** Words for an HTTP status from a calendar server. */
export function httpProblem(status: number): string {
  if (status === 401 || status === 403) return `The calendar server refused access (${status}). Check the address, user name and password.`;
  if (status === 404 || status === 410) return `The calendar was not found (${status}). It may have been deleted or its secret address changed.`;
  if (status === 429) return "The calendar server says to slow down (429). Ribbon will try again later.";
  return `The calendar server answered ${status}.`;
}

export const looksLikeIcs = (text: string) => /BEGIN:VCALENDAR/i.test(text.slice(0, 4096));

