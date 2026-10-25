// A tiny in-memory fixed-window counter shared by sign-in lockout, setup-code guesses, passkey
// and SSO starts, and the Ask feature. Memory only: a restart clears it, which is fine for a
// brake on guessing. The map is pruned so a flood of different keys can't grow it without bound.
type Entry = { count: number; since: number; windowMs: number };

const buckets = new Map<string, Entry>();
const MAX_KEYS = 20_000;

function live(key: string, now: number): Entry | null {
  const entry = buckets.get(key);
  if (!entry) return null;
  if (now - entry.since > entry.windowMs) {
    buckets.delete(key);
    return null;
  }
  return entry;
}

function prune(now: number) {
  if (buckets.size < MAX_KEYS) return;
  for (const [key, entry] of buckets) if (now - entry.since > entry.windowMs) buckets.delete(key);
  // Still full of live entries (a flood): drop the oldest quarter rather than refuse to count.
  if (buckets.size >= MAX_KEYS) {
    let drop = Math.ceil(buckets.size / 4);
    for (const key of buckets.keys()) {
      if (drop-- <= 0) break;
      buckets.delete(key);
    }
  }
}

/** Seconds until `key` may try again, or 0 when it is under `limit` in the window. */
export function waitFor(key: string, limit: number, now = Date.now()): number {
  const entry = live(key, now);
  if (!entry || entry.count < limit) return 0;
  return Math.max(1, Math.ceil((entry.since + entry.windowMs - now) / 1000));
}

/** Count one event against `key`. */
export function hit(key: string, windowMs: number, now = Date.now()) {
  const entry = live(key, now);
  if (entry) entry.count += 1;
  else {
    prune(now);
    buckets.set(key, { count: 1, since: now, windowMs });
  }
}

export function forget(key: string) {
  buckets.delete(key);
}

export function resetRateLimits() {
  buckets.clear();
}

/** Count, then say how long to wait if that put the caller over the limit (0 = go ahead). */
export function throttle(key: string, limit: number, windowMs: number, now = Date.now()): number {
  const wait = waitFor(key, limit, now);
  if (wait > 0) return wait;
  hit(key, windowMs, now);
  return 0;
}
