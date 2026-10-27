// No imports on purpose: this is unit-tested on its own.

/** An instant for the event: "...Z" is absolute, anything else is the wall-clock time as written. */
export function parseWhen(value: string): Date {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) return new Date(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value)!;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
}
