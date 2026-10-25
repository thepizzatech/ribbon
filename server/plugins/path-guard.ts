// Refuse a request whose path has broken percent-encoding (/%E0%A4%A) with a 400.
// The server framework decodes the path before any middleware runs; on bad input it throws, and the
// request used to hang open forever (a cheap way to tie up connections). This wraps the app's fetch so the
// check happens first.
import { securityHeaders } from "../../src/server/security.ts";

type NitroLike = { fetch: (request: Request) => Response | Promise<Response> };

export function pathIsWellFormed(url: string): boolean {
  try {
    decodeURIComponent(new URL(url, "http://localhost").pathname);
    return true;
  } catch {
    return false;
  }
}

export default (nitroApp: NitroLike) => {
  const inner = nitroApp.fetch;
  nitroApp.fetch = (request: Request) => {
    if (pathIsWellFormed(request.url)) return inner(request);
    return new Response("Bad request.", {
      status: 400,
      headers: { ...securityHeaders(request), "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  };
};
