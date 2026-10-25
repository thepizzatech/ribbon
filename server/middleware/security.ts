// Production-only (Nitro) middleware: redirect plain HTTP to HTTPS when ENFORCE_HTTPS is on,
// and add security headers (CSP, HSTS, nosniff, frame-ancestors, referrer policy) to every response.
import { httpsRedirectTarget, securityHeaders } from "../../src/server/security.ts";

type Event = { req: Request; res?: { headers: Headers } };

export default async function security(event: Event, next: () => unknown | Promise<unknown>) {
  const request = event.req;
  const headers = securityHeaders(request);

  const target = httpsRedirectTarget(request);
  if (target) {
    return new Response(null, { status: 308, headers: { location: target, "cache-control": "no-store", ...headers } });
  }

  if (event.res?.headers) {
    for (const [name, value] of Object.entries(headers)) event.res.headers.set(name, value);
  }
  const result = await next();
  if (result instanceof Response) {
    for (const [name, value] of Object.entries(headers)) {
      try {
        result.headers.set(name, value);
      } catch {
        /* immutable response: already covered by event.res */
      }
    }
  }
  return result;
}
