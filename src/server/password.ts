// Password hashing with scrypt from node:crypto. Format: scrypt$N$r$p$salt$hash (base64url).
import { randomBytes, scrypt, scryptSync, timingSafeEqual, type ScryptOptions } from "node:crypto";

// OWASP's scrypt guidance: N=2^16, r=8, p=2 (about 64 MiB per hash). Older hashes (N=2^15, p=1) are
// still accepted and quietly upgraded the next time that person signs in.
const N = 65536;
const R = 8;
const P = 2;
const KEYLEN = 64;
const OPTIONS: ScryptOptions = { N, r: R, p: P, maxmem: 256 * 1024 * 1024 };
// Stored parameters are bounds-checked so a tampered or restored row can't make sign-in burn the CPU or memory.
const MAX_N = 1 << 17;
const MAX_R = 16;
const MAX_P = 4;
const paramsOk = (n: number, r: number, p: number) =>
  Number.isInteger(n) && Number.isInteger(r) && Number.isInteger(p) && n >= 1 << 14 && n <= MAX_N && (n & (n - 1)) === 0 && r >= 1 && r <= MAX_R && p >= 1 && p <= MAX_P;

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEYLEN, { ...OPTIONS, N: n, r, p }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** Synchronous variant for startup tasks only (dev account). */
export function hashPasswordSync(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize("NFKC"), salt, KEYLEN, OPTIONS);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  if (!paramsOk(Number(n), Number(r), Number(p))) return false;
  const expected = Buffer.from(hash, "base64url");
  try {
    const key = await derive(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p));
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** True when a stored hash was made with weaker settings than today's (so it should be re-hashed after a good sign-in). */
export function passwordNeedsRehash(stored: string): boolean {
  const [scheme, n, r, p] = stored.split("$");
  return scheme === "scrypt" && (Number(n) !== N || Number(r) !== R || Number(p) !== P);
}

// Burn the same time for unknown usernames so response time does not reveal which exist.
let dummy: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword("not-a-real-password");
  await verifyPassword(password, await dummy);
}

/** A login with no password ("!", single sign-on only) still burns one hash so its timing matches a wrong password. */
export async function burnUnlessHash(password: string, stored: string | undefined): Promise<boolean> {
  if (stored && stored.startsWith("scrypt$")) return verifyPassword(password, stored);
  await burnPasswordCheck(password);
  return false;
}

/** Returns a reason the password is unacceptable, or null if it is fine. */
export function passwordProblem(password: unknown, username = ""): string | null {
  if (typeof password !== "string") return "Enter a password.";
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.length > MAX_PASSWORD) return "That password is too long.";
  if (username && password.toLowerCase() === username.toLowerCase()) return "The password can’t be the same as the username.";
  return null;
}
