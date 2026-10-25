// Production-only (Nitro) middleware. Stamps the real socket address on the request (so the app can
// tell a trusted reverse proxy from anyone else) and adds the security headers to every response.
import { PEER_HEADER, securityHeaders } from "../../src/server/security.ts";

type NodeLike = { socket?: { remoteAddress?: string } };
type Event = {
  req: Request & { ip?: string; runtime?: { node?: { req?: NodeLike } } };
  node?: { req?: NodeLike };
  res?: { headers: Headers };
};

function pathIsWellFormed(url: string): boolean {
  try {
    decodeURIComponent(new URL(url, "http://localhost").pathname);
    return true;
  } catch {
    return false;
  }
}

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
  // A path with broken percent-encoding (/%E0%A4%A) used to make a downstream router throw and leave the
  // request hanging forever; refuse it here, with the security headers, before anything else sees it.
  if (!pathIsWellFormed(request.url)) {
    return new Response("Bad request.", { status: 400, headers: { ...headers, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  if (event.res?.headers) {
    for (const [name, value] of Object.entries(headers)) event.res.headers.set(name, value);
  }
  const result = await next();
  if (result instanceof Response) {
    // The app shell is never cached by a browser or proxy without revalidating (it embeds the current build's asset names).
    if ((result.headers.get("content-type") ?? "").includes("text/html") && !result.headers.has("cache-control")) {
      headers["cache-control"] = "no-cache";
    }
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
