// Password hashing with scrypt from node:crypto. Format: scrypt$N$r$p$salt$hash (base64url).
import { randomBytes, scrypt, scryptSync, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const OPTIONS: ScryptOptions = { N, r: R, p: P, maxmem: 128 * 1024 * 1024 };

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
  const expected = Buffer.from(hash, "base64url");
  try {
    const key = await derive(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p));
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// Burn the same time for unknown usernames so response time does not reveal which exist.
let dummy: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword("not-a-real-password");
  await verifyPassword(password, await dummy);
}

/** Returns a reason the password is unacceptable, or null if it is fine. */
export function passwordProblem(password: unknown, username = ""): string | null {
  if (typeof password !== "string") return "Enter a password.";
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.length > MAX_PASSWORD) return "That password is too long.";
  if (username && password.toLowerCase() === username.toLowerCase()) return "The password can’t be the same as the username.";
  return null;
}
