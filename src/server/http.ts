// Small shared pieces for the JSON API: responses, body reading, and the per-request context.
import type { Db } from "./db.ts";
import type { Ctx, Result } from "./ledger.ts";
import type { Session } from "./users.ts";

export const MAX_BODY = 5 * 1024 * 1024;

export function json(data: unknown, init: ResponseInit & { cookie?: string } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  if (init.cookie) headers.append("set-cookie", init.cookie);
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers });
}

export const error = (status: number, message: string) => json({ error: message }, { status });

export function respond(result: Result<object>, okStatus = 200): Response {
  if (!result.ok) return error(result.status, result.reason);
  const { ok: _ok, ...rest } = result;
  return json(rest, { status: okStatus });
}

export type Body = { ok: true; value: unknown } | { ok: false; response: Response };

export async function readJson(request: Request): Promise<Body> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    return { ok: false, response: error(415, "Send JSON with Content-Type: application/json.") };
  }
  const text = await request.text();
  if (text.length > MAX_BODY) return { ok: false, response: error(413, "That request is too large.") };
  if (!text.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: error(400, "That is not valid JSON.") };
  }
}

export const decode = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};


/** Everything a feature module needs to answer one signed-in request. */
export type ApiCall = {
  request: Request;
  url: URL;
  method: string;
  db: Db;
  session: Session;
  /** Whose ledger, and who is looking (for surprise-safe reads). */
  ctx: Ctx;
  resource: string | undefined;
  /** The first path segment after the resource, decoded. */
  id: string | undefined;
  /** Any further path segments (undecoded). */
  rest: string[];
  body: unknown;
  isOwner: boolean;
};

export type Handler = (call: ApiCall) => Promise<Response | null> | Response | null;

/** A request that may not be signed in yet (health, session, sign-in flows, calendar feeds). */
export type PublicCall = {
  request: Request;
  url: URL;
  method: string;
  db: Db;
  session: Session | null;
  resource: string | undefined;
  id: string | undefined;
  rest: string[];
  secure: boolean;
};

export type PublicHandler = (call: PublicCall) => Promise<Response | null> | Response | null;
