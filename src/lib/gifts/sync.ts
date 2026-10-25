// Sends the browser's changes to the server one at a time, in the order they were made
// (so a new person always lands before the gift that names them).
import { ApiError } from "@/lib/gifts/api";

let chain: Promise<unknown> = Promise.resolve();
let pending = 0;
let failure: string | null = null;
let settledListener: ((failure: string | null) => void) | null = null;

export function pendingChanges(): number {
  return pending;
}

/** Called when the queue drains. `failure` says what went wrong, if anything did. */
export function onSettled(listener: ((failure: string | null) => void) | null) {
  settledListener = listener;
}

export function send(job: () => Promise<unknown>) {
  pending += 1;
  chain = chain
    .then(job)
    .catch((error: unknown) => {
      failure = error instanceof ApiError ? error.message : "Couldn't save that change.";
    })
    .finally(() => {
      pending -= 1;
      if (pending > 0) return;
      const message = failure;
      failure = null;
      settledListener?.(message);
    });
}
