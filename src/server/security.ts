// Proxy trust, the effective request scheme/host/client address, security headers, the insecure-login
// guard, and same-origin checks. Pure functions, used by the Nitro middleware and by the API.
import { BlockList, isIP } from "node:net";
import { allowInsecureLogin, allowPublicSetup, setupCode, enforceHttps, hstsEnabled, isProduction, publicUrl, trustedProxies, DEFAULT_TRUSTED_PROXIES } from "./config.ts";

/** Header the Nitro middleware stamps with the real socket address (client-sent copies are discarded). */
export const PEER_HEADER = "x-ribbon-peer";

const listCache = new Map<string, BlockList>();

function toList(cidrs: string[]): BlockList {
  const key = cidrs.join(",");
  const cached = listCache.get(key);
  if (cached) return cached;
  const list = new BlockList();
  for (const entry of cidrs) {
    const [address, bits] = entry.split("/");
    const family = isIP(address ?? "");
    if (!address || !family) continue;
    const prefix = bits === undefined ? (family === 4 ? 32 : 128) : Number(bits);
    if (!Number.isInteger(prefix)) continue;
    try {
      list.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
    } catch {
      /* ignore a malformed entry */
    }
  }
  listCache.set(key, list);
  return list;
}

/** Normalise "::ffff:10.0.0.1" and "[::1]:3000"-style values to a bare address. */
export function normalizeAddress(value: string): string {
  let v = value.trim();
  if (v.startsWith("[")) v = v.slice(1, v.indexOf("]"));
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(":"));
  v = v.replace(/^::ffff:/i, "");
  return v;
}

function inList(address: string, cidrs: string[]): boolean {
  const ip = normalizeAddress(address);
  const family = isIP(ip);
  if (!family) return false;
  return toList(cidrs).check(ip, family === 4 ? "ipv4" : "ipv6");
}

/** Loopback, RFC 1918, unique-local IPv6, link-local and the 100.64/10 range Tailscale uses. */
export function isPrivateAddress(address: string): boolean {
  return inList(address, [...DEFAULT_TRUSTED_PROXIES, "169.254.0.0/16", "fe80::/10"]);
}

/** The TCP peer: the stamped header in production; loopback outside production (tests, `vite dev`). */
export function peerAddress(request: Request): string {
  const stamped = request.headers.get(PEER_HEADER);
  if (stamped) return normalizeAddress(stamped);
  return isProduction() ? "unknown" : "127.0.0.1";
}

export function isTrustedPeer(request: Request): boolean {
  return inList(peerAddress(request), trustedProxies());
}

function forwarded(request: Request, name: string): string | undefined {
  if (!isTrustedPeer(request)) return undefined; // X-Forwarded-* from anyone else is just text
  return request.headers.get(name)?.split(",")[0]?.trim() || undefined;
}

/** The real client: the peer, or (behind a trusted proxy) the first untrusted hop in X-Forwarded-For. */
export function clientAddress(request: Request): string {
  const peer = peerAddress(request);
  if (!isTrustedPeer(request)) return peer;
  const hops = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => normalizeAddress(hop))
    .filter(Boolean);
  if (hops.length === 0) return peer;
  const proxies = trustedProxies();
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    if (!inList(hops[i]!, proxies)) return hops[i]!;
  }
  return hops[0]!;
}

/** The host the browser used: trusted X-Forwarded-Host, else Host. */
export function requestHost(request: Request): string {
  return forwarded(request, "x-forwarded-host") || request.headers.get("host") || new URL(request.url).host;
}

/**
 * http or https as the browser sees it. PUBLIC_URL wins when the request is for that host; then a
 * trusted proxy's X-Forwarded-Proto; then the socket. (A request for another host, such as the
 * server's LAN address, falls through, so plain-HTTP LAN use keeps working next to a public https URL.)
 */
export function requestScheme(request: Request): "http" | "https" {
  const pub = publicUrl();
  if (pub) {
    try {
      const url = new URL(pub);
      if (url.host === requestHost(request)) return url.protocol === "https:" ? "https" : "http";
    } catch {
      /* bad PUBLIC_URL: ignore */
    }
  }
  const proto = forwarded(request, "x-forwarded-proto")?.toLowerCase();
  if (proto === "https" || proto === "http") return proto;
  return new URL(request.url).protocol === "https:" ? "https" : "http";
}

export function isSecureRequest(request: Request): boolean {
  return requestScheme(request) === "https";
}

/** Why password sign-in is refused on this request, or null when it is fine. */
export function insecureLoginReason(request: Request): string | null {
  if (isSecureRequest(request) || (allowInsecureLogin() && !enforceHttps())) return null;
  if (enforceHttps()) return "This server only accepts sign-in over HTTPS. Open it through its HTTPS address.";
  if (isPrivateAddress(clientAddress(request))) return null;
  return "Sign-in over plain HTTP is only allowed from your home network. Open Ribbon through its HTTPS address.";
}

/**
 * Why the first owner account can't be created from this connection, or null when it can. Until an owner
 * exists anyone who can reach the server could claim it, so without a SETUP_CODE only the home network
 * may do it (ALLOW_PUBLIC_SETUP=true lifts that for people who accept the risk).
 */
export function setupRefusedReason(request: Request): string | null {
  if (setupCode() || allowPublicSetup()) return null;
  if (isPrivateAddress(clientAddress(request))) return null;
  return "Ribbon has no owner yet, and this connection isn’t on your home network. Set SETUP_CODE on the server (then enter it here) or finish setup from your home network. Anyone who reached this page could otherwise claim the account.";
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const HSTS_VALUE = "max-age=15552000"; // six months, no includeSubDomains

export function securityHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
  };
  if (hstsEnabled() && isSecureRequest(request)) headers["strict-transport-security"] = HSTS_VALUE;
  return headers;
}

/** Browsers send Origin on cross-site writes; reject any that is not this site. */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return origin === null; // no header (curl, same-origin GET) is fine
  try {
    const host = new URL(origin).host;
    if (host === requestHost(request) || host === request.headers.get("host")) return true;
    const pub = publicUrl();
    return Boolean(pub && new URL(pub).host === host);
  } catch {
    return false;
  }
}
