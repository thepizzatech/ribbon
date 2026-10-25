// Optional single shared passcode. APP_PASSCODE unset (or empty) means no auth.
// A login sets a signed, expiring, HttpOnly cookie; changing the passcode
// signs everyone out.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "ribbon_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export function configuredPasscode(): string | undefined {
  return process.env.APP_PASSCODE?.trim() || undefined;
}

function sign(passcode: string, expires: string): string {
  return createHmac("sha256", passcode).update(`ribbon-session:${expires}`).digest("base64url");
}

export function makeSession(passcode: string, now = Date.now()): string {
  const expires = String(now + SESSION_MS);
  return `${expires}.${sign(passcode, expires)}`;
}

export function verifySession(token: string | undefined, passcode: string, now = Date.now()): boolean {
  if (!token) return false;
  const [expires, mac, extra] = token.split(".");
  if (!expires || !mac || extra !== undefined) return false;
  if (!/^\d+$/.test(expires) || Number(expires) < now) return false;
  return safeEqual(mac, sign(passcode, expires));
}

export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}

/** True when no passcode is set, or the request carries a valid cookie or `Authorization: Bearer <passcode>`. */
export function isAuthed(request: Request): boolean {
  const passcode = configuredPasscode();
  if (!passcode) return true;
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer && safeEqual(bearer.trim(), passcode)) return true;
  return verifySession(readCookie(request.headers.get("cookie"), COOKIE_NAME), passcode);
}

export function sessionCookie(token: string, secure: boolean): string {
  const maxAge = Math.floor(SESSION_MS / 1000);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function clearCookie(secure: boolean): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

// Tiny in-memory brake on guessing: 10 misses per client per 5 minutes.
const misses = new Map<string, { count: number; since: number }>();
const WINDOW_MS = 5 * 60 * 1000;

export function tooManyMisses(client: string, now = Date.now()): boolean {
  const entry = misses.get(client);
  if (!entry || now - entry.since > WINDOW_MS) return false;
  return entry.count >= 10;
}

export function recordMiss(client: string, now = Date.now()): void {
  const entry = misses.get(client);
  if (!entry || now - entry.since > WINDOW_MS) misses.set(client, { count: 1, since: now });
  else entry.count += 1;
}

export function clearMisses(client: string): void {
  misses.delete(client);
}
