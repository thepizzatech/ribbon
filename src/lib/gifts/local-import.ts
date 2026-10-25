// One-time hand-off of the ledger that older versions kept in this browser.
// The original localStorage entry is left in place as a safety copy.
import { parseBackupData, type Backup } from "@/lib/gifts/model";

const LOCAL_KEY = "ribbon-ledger-v1";
const DONE_KEY = "ribbon-server-import-v1";

export type LocalLedger = Backup & { demo: boolean; demoDismissed: boolean };

export function alreadyHandled(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) !== null;
  } catch {
    return true;
  }
}

export function markHandled(outcome: "imported" | "skipped" | "none") {
  try {
    localStorage.setItem(DONE_KEY, `${outcome}:${new Date().toISOString()}`);
  } catch {
    /* private mode */
  }
}

export function readLocalLedger(): LocalLedger | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const state = (JSON.parse(raw) as { state?: Record<string, unknown> } | null)?.state;
    const backup = parseBackupData(state);
    if (!backup) return null;
    return {
      ...backup,
      demo: state?.demo === true,
      demoDismissed: state?.demoDismissed !== false,
    };
  } catch {
    return null;
  }
}
