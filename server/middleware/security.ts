// Production-only (Nitro) middleware. Stamps the real socket address on the request (so the app can
// tell a trusted reverse proxy from anyone else) and adds the security headers to every response.
import { PEER_HEADER, securityHeaders } from "../../src/server/security.ts";

type NodeLike = { socket?: { remoteAddress?: string } };
type Event = {
  req: Request & { ip?: string; runtime?: { node?: { req?: NodeLike } } };
  node?: { req?: NodeLike };
  res?: { headers: Headers };
};

function socketAddress(event: Event): string {
  return (
    event.req.runtime?.node?.req?.socket?.remoteAddress ||
    event.node?.req?.socket?.remoteAddress ||
    event.req.ip ||
    "unknown"
  );
}

export default async function security(event: Event, next: () => unknown | Promise<unknown>) {
  const request = event.req;
  // Whatever the client sent under this name is discarded.
  request.headers.delete(PEER_HEADER);
  request.headers.set(PEER_HEADER, socketAddress(event));

  const headers = securityHeaders(request);
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
