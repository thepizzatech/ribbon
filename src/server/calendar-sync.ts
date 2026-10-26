// Refreshing calendar connections: one function per kind, one shared wrapper that stores the result
// (or the error, in words a person can act on), and the background timer.
import { calendarSyncEnabled, calendarSyncHours } from "./config.ts";
import type { Db } from "./db.ts";
import { parseIcs } from "./ics.ts";
import { CalendarFetchError, guardedFetch } from "./safe-fetch.ts";
import { syncCaldav } from "./caldav.ts";
import { syncGoogle } from "./google.ts";
import { fail, getConnection, httpProblem, looksLikeIcs, markAttempt, markFailed, markSynced, readSource, readState, replaceEvents, UNREADABLE, writeState, type ConnectionRow, type SyncResult } from "./calendar-store.ts";

export async function syncIcsUrl(db: Db, row: ConnectionRow): Promise<SyncResult> {
  const source = readSource<{ url?: string }>(db, row);
  if (!source?.url) return fail(UNREADABLE);
  const state = readState<{ etag?: string; lastModified?: string }>(row);
  const headers: Record<string, string> = { accept: "text/calendar, text/plain;q=0.8, */*;q=0.1" };
  // Only ask "has it changed?" when we still hold the events from last time.
  if (row.event_count > 0 || row.last_status === "ok") {
    if (state.etag) headers["if-none-match"] = state.etag;
    if (state.lastModified) headers["if-modified-since"] = state.lastModified;
  }
  const res = await guardedFetch(source.url, { headers });
  if (res.status === 304) return { ok: true, events: "unchanged" };
  if (res.status !== 200) return fail(httpProblem(res.status));
  const text = res.body.toString("utf8").replace(/^\uFEFF/, "");
  if (!looksLikeIcs(text)) return fail("That address did not return a calendar (.ics) file. It looks like a web page. Use the calendar’s iCal / ICS address.");
  const parsed = parseIcs(text);
  const next = { ...state, etag: res.headers.etag ?? undefined, lastModified: res.headers["last-modified"] ?? undefined, calName: parsed.name ?? undefined };
  return { ok: true, events: parsed.events, state: next, note: parsed.truncated ? "This calendar is very large; only part of it was imported." : parsed.failedSeries ? `${parsed.failedSeries} repeating event(s) could not be read and were skipped.` : null };
}

const inflight = new Set<string>();
export const isSyncing = (id: string) => inflight.has(id);

function explain(error: unknown): string {
  if (error instanceof CalendarFetchError) return error.message;
  console.error("[ribbon] calendar sync failed:", error instanceof Error ? error.message : "unknown error"); // message only: no URLs, no tokens
  return "Something went wrong while reading that calendar.";
}

/** Refresh one connection and record how it went. Never throws. */
export async function syncConnection(db: Db, id: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const row = getConnection(db, id);
  if (!row) return { ok: false, error: "That calendar is gone." };
  if (row.kind === "ics_file") return { ok: true, count: row.event_count };
  if (inflight.has(id)) return { ok: false, error: "That calendar is already refreshing." };
  inflight.add(id);
  try {
    markAttempt(db, id);
    let result: SyncResult;
    try {
      result = row.kind === "ics_url" ? await syncIcsUrl(db, row) : row.kind === "google" ? await syncGoogle(db, row) : await syncCaldav(db, row);
    } catch (error) {
      result = fail(explain(error));
    }
    if (!getConnection(db, id)) return { ok: false, error: "That calendar is gone." }; // removed while syncing
    if (!result.ok) {
      markFailed(db, id, result.error, result.reauth ? "reauth" : "error");
      return { ok: false, error: result.error };
    }
    if (result.state) writeState(db, id, result.state);
    if (result.events !== "unchanged") replaceEvents(db, id, result.events);
    markSynced(db, id, result.note ?? null);
    return { ok: true, count: result.events === "unchanged" ? row.event_count : result.events.length };
  } finally {
    inflight.delete(id);
  }
}

/** Connections whose turn has come (never ones that need a new sign-in, are switched off, or are one-off files). */
export function dueConnections(db: Db, now = Date.now()): string[] {
  const rows = db
    .prepare("SELECT id, sync_hours, last_attempt_at, created_at, failures FROM calendar_connections WHERE enabled = 1 AND kind != 'ics_file' AND last_status != 'reauth' ORDER BY COALESCE(last_attempt_at, created_at)")
    .all() as { id: string; sync_hours: number | null; last_attempt_at: string | null; created_at: string; failures: number }[];
  return rows
    .filter((r) => {
      const interval = (r.sync_hours ?? calendarSyncHours()) * 3_600_000;
      // After a failure retry sooner than the full interval, backing off 15 min, 30 min, 1 h ... up to the interval.
      const wait = r.failures > 0 ? Math.min(interval, 15 * 60_000 * 2 ** Math.min(r.failures - 1, 10)) : interval;
      return now - Date.parse(r.last_attempt_at ?? r.created_at) >= wait;
    })
    .map((r) => r.id);
}

export async function runDue(db: Db, now = Date.now(), limit = 25): Promise<number> {
  let done = 0;
  for (const id of dueConnections(db, now).slice(0, limit)) {
    await syncConnection(db, id);
    done += 1;
  }
  return done;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Check every 5 minutes for calendars that are due. A restart waits one minute first. */
export function startCalendarScheduler(db: Db) {
  if (timer || !calendarSyncEnabled()) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDue(db);
    } catch (error) {
      console.error("[ribbon] calendar refresh failed:", error instanceof Error ? error.message : "unknown error");
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 60_000).unref();
  timer = setInterval(tick, 5 * 60_000);
  timer.unref();
}

export function stopCalendarScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
