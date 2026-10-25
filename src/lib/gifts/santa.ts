// Secret Santa: draw a derangement that honours exclusions, and say when none exists.
// Pure and shared so the server draws and the tests exercise the same code.

export type SantaInput = {
  /** Everyone taking part, by id. */
  ids: string[];
  /** Pairs [giver, receiver] that must not happen. Self-gifts are always excluded. */
  forbidden: [string, string][];
  /** 0..1 source of randomness (Math.random by default; tests pass a seeded one). */
  random?: () => number;
};

export type SantaResult =
  | { ok: true; pairs: Map<string, string> }
  | { ok: false; reason: "too-few" | "stuck" | "unsolvable"; detail: string; stuckIds?: string[] };

/** For each giver, who they may draw. */
export function allowedMap(ids: string[], forbidden: [string, string][]): Map<string, string[]> {
  const bad = new Set(forbidden.map(([a, b]) => `${a}\u0000${b}`));
  const out = new Map<string, string[]>();
  for (const giver of ids) out.set(giver, ids.filter((r) => r !== giver && !bad.has(`${giver}\u0000${r}`)));
  return out;
}

/** Maximum bipartite matching (Kuhn). A full draw exists exactly when every giver can be matched. */
export function maxMatching(allowed: Map<string, string[]>): Map<string, string> {
  const receiverToGiver = new Map<string, string>();
  const tryGiver = (giver: string, seen: Set<string>): boolean => {
    for (const receiver of allowed.get(giver) ?? []) {
      if (seen.has(receiver)) continue;
      seen.add(receiver);
      const holder = receiverToGiver.get(receiver);
      if (holder === undefined || tryGiver(holder, seen)) {
        receiverToGiver.set(receiver, giver);
        return true;
      }
    }
    return false;
  };
  for (const giver of allowed.keys()) tryGiver(giver, new Set());
  const pairs = new Map<string, string>();
  for (const [receiver, giver] of receiverToGiver) pairs.set(giver, receiver);
  return pairs;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function solvable(ids: string[], forbidden: [string, string][]): { ok: true } | { ok: false; reason: "too-few" | "stuck" | "unsolvable"; detail: string; stuckIds?: string[] } {
  if (new Set(ids).size < 3) {
    return { ok: false, reason: "too-few", detail: "Secret Santa needs at least 3 people." };
  }
  const allowed = allowedMap(ids, forbidden);
  const stuckIds = ids.filter((id) => (allowed.get(id) ?? []).length === 0);
  if (stuckIds.length > 0) return { ok: false, reason: "stuck", detail: "Someone has no one left they are allowed to draw.", stuckIds };
  const matching = maxMatching(allowed);
  if (matching.size < ids.length) {
    return { ok: false, reason: "unsolvable", detail: "These exclusions leave no way for everyone to give and receive exactly once." };
  }
  return { ok: true };
}

/**
 * Draw. Tries random shuffles first (so every valid draw is reachable and results look fair), then
 * falls back to a randomised matching, which finds a draw whenever one exists.
 */
export function draw(input: SantaInput): SantaResult {
  const random = input.random ?? Math.random;
  const ids = [...new Set(input.ids)];
  const check = solvable(ids, input.forbidden);
  if (!check.ok) return check;
  const allowed = allowedMap(ids, input.forbidden);
  const ok = (giver: string, receiver: string) => (allowed.get(giver) ?? []).includes(receiver);
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const receivers = shuffle(ids, random);
    if (ids.every((giver, i) => ok(giver, receivers[i]!))) return { ok: true, pairs: new Map(ids.map((g, i) => [g, receivers[i]!])) };
  }
  const shuffled = new Map<string, string[]>();
  for (const giver of shuffle(ids, random)) shuffled.set(giver, shuffle(allowed.get(giver) ?? [], random));
  const pairs = maxMatching(shuffled);
  if (pairs.size === ids.length) return { ok: true, pairs };
  return { ok: false, reason: "unsolvable", detail: "These exclusions leave no way for everyone to give and receive exactly once." };
}

/** Test helper and sanity check: is this a valid draw? */
export function isValidDraw(ids: string[], forbidden: [string, string][], pairs: Map<string, string>): boolean {
  const bad = new Set(forbidden.map(([a, b]) => `${a}\u0000${b}`));
  const receivers = new Set<string>();
  for (const giver of ids) {
    const receiver = pairs.get(giver);
    if (!receiver || receiver === giver || bad.has(`${giver}\u0000${receiver}`) || receivers.has(receiver) || !ids.includes(receiver)) return false;
    receivers.add(receiver);
  }
  return receivers.size === ids.length && pairs.size === ids.length;
}
