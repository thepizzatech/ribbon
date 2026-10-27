// Small text helpers shared by the UI. No imports, so they can be unit-tested on their own.

const english = new Intl.PluralRules("en");

/** "1 event", "2 events", "0 events". Pass `other` for irregular plurals ("person", "people"). */
export function plural(n: number, one: string, other = `${one}s`): string {
  return `${n} ${english.select(n) === "one" ? one : other}`;
}

/** "3 min ago", "yesterday", "2 days ago" in the browser's language. */
export function relativeAgo(seconds: number): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (seconds < 60) return rtf.format(0, "second");
  if (seconds < 3600) return rtf.format(-Math.round(seconds / 60), "minute");
  if (seconds < 86400) return rtf.format(-Math.round(seconds / 3600), "hour");
  return rtf.format(-Math.round(seconds / 86400), "day");
}

const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** The first user-perceived character of a word: a whole emoji (with skin tone, ZWJ parts) instead of half a surrogate pair. */
export function firstGrapheme(word: string): string {
  if (!word) return "";
  if (segmenter) {
    const first = segmenter.segment(word)[Symbol.iterator]().next();
    return first.done ? "" : first.value.segment;
  }
  return Array.from(word)[0] ?? "";
}

/** "Avery Cole" -> "AC", "Jo" -> "J", "🦊 Fox" -> "🦊F". */
export function initialsOf(name: string, fallback = "?"): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  const first = firstGrapheme(parts[0]!);
  const last = parts.length > 1 ? firstGrapheme(parts[parts.length - 1]!) : "";
  return (first + last).toUpperCase();
}
