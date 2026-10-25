// HTTPS enforcement, security headers, and same-origin checks. Pure functions, used by the
// Nitro middleware (server/middleware/security.ts) and by the API.
import { enforceHttps, publicUrl } from "./config.ts";

/** The request's protocol, honouring X-Forwarded-Proto from the TLS proxy. */
export function requestProto(request: Request): "http" | "https" {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded === "https" || forwarded === "http") return forwarded;
  return new URL(request.url).protocol === "https:" ? "https" : "http";
}

export function requestHost(request: Request): string {
  return (
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    new URL(request.url).host
  );
}

export function isSecureRequest(request: Request): boolean {
  return enforceHttps() || requestProto(request) === "https";
}

/** Paths that must keep working over plain HTTP (the Docker health check calls it on localhost). */
const HTTP_ALLOWED = new Set(["/api/health"]);

/** Where to send a plain-HTTP request, or null if it may proceed. */
export function httpsRedirectTarget(request: Request): string | null {
  if (!enforceHttps()) return null;
  if (requestProto(request) === "https") return null;
  const url = new URL(request.url);
  if (HTTP_ALLOWED.has(url.pathname)) return null;
  const base = publicUrl() ?? `https://${requestHost(request).replace(/:\d+$/, "")}`;
  return `${base}${url.pathname}${url.search}`;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cross-origin-opener-policy": "same-origin",
  };
  if (enforceHttps() && requestProto(request) === "https") {
    headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}

/** Browsers send Origin on cross-site writes; reject any that is not this site. */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return origin === null; // no header (curl, same-origin GET) is fine
  try {
    return new URL(origin).host === requestHost(request);
  } catch {
    return false;
  }
}
