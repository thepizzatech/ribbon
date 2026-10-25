// The whole JSON API as one Request -> Response function, so the same code runs
// behind the TanStack Start route and in the tests.
import { parseBackupData } from "../lib/gifts/model.ts";
import {
  clearCookie,
  clearMisses,
  configuredPasscode,
  isAuthed,
  makeSession,
  recordMiss,
  safeEqual,
  sessionCookie,
  tooManyMisses,
} from "./auth.ts";
import { getDb, type Db } from "./db.ts";
import {
  addGift,
  addOccasion,
  addPerson,
  exportLedger,
  getLedger,
  removeGift,
  removeOccasion,
  removePerson,
  renameOccasion,
  replaceLedger,
  updateGift,
  updateHousehold,
  updatePerson,
  type Result,
} from "./ledger.ts";

const MAX_BODY = 5 * 1024 * 1024;

function json(data: unknown, init: ResponseInit & { cookie?: string } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  if (init.cookie) headers.append("set-cookie", init.cookie);
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers });
}

const error = (status: number, message: string) => json({ error: message }, { status });

function respond(result: Result<object>, okStatus = 200): Response {
  if (!result.ok) return error(result.status, result.reason);
  const { ok: _ok, ...rest } = result;
  return json(rest, { status: okStatus });
}

function isSecure(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return (proto ?? new URL(request.url).protocol.replace(":", "")) === "https";
}

function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

type Body = { ok: true; value: unknown } | { ok: false; response: Response };

async function readJson(request: Request): Promise<Body> {
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

const decode = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

export async function handleApi(request: Request, db?: Db): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean); // ["api", ...]
  if (parts[0] !== "api") return error(404, "Not found.");
  const [, resource, rawId, ...rest] = parts;

  try {
    // ---- open endpoints ----
    if (resource === "health" && method === "GET" && !rawId) {
      (db ?? getDb()).prepare("SELECT 1").get();
      return json({ ok: true });
    }
    if (resource === "session" && method === "GET") {
      return json({ required: Boolean(configuredPasscode()), authed: isAuthed(request) });
    }
    if (resource === "login" && method === "POST") {
      const passcode = configuredPasscode();
      if (!passcode) return json({ ok: true });
      const client = clientKey(request);
      if (tooManyMisses(client)) return error(429, "Too many tries. Wait a few minutes and try again.");
      const body = await readJson(request);
      if (!body.ok) return body.response;
      const given = (body.value as { passcode?: unknown } | null)?.passcode;
      if (typeof given !== "string" || !safeEqual(given.trim(), passcode)) {
        recordMiss(client);
        await new Promise((resolve) => setTimeout(resolve, 400));
        return error(401, "That passcode is not right.");
      }
      clearMisses(client);
      return json({ ok: true }, { cookie: sessionCookie(makeSession(passcode), isSecure(request)) });
    }
    if (resource === "logout" && method === "POST") {
      return json({ ok: true }, { cookie: clearCookie(isSecure(request)) });
    }

    // ---- everything else needs the passcode (when one is set) ----
    if (!isAuthed(request)) return error(401, "Passcode required.");
    const store = db ?? getDb();

    const write = method === "POST" || method === "PUT" || method === "PATCH";
    let body: unknown = {};
    if (write) {
      const parsed = await readJson(request);
      if (!parsed.ok) return parsed.response;
      body = parsed.value;
    }

    const id = rawId === undefined ? undefined : decode(rawId);
    if (id === null) return error(400, "Bad id in the address.");
    if (rest.length > 0) return error(404, "Not found.");

    switch (resource) {
      case "ledger":
        if (method === "GET" && id === undefined) return json(getLedger(store));
        break;
      case "household":
        if (method === "PUT" && id === undefined) {
          const result = updateHousehold(store, (body ?? {}) as object);
          return result.ok ? json(getLedger(store)) : respond(result);
        }
        break;
      case "people":
        if (method === "GET" && id === undefined) return json({ people: getLedger(store).people });
        if (method === "POST" && id === undefined) return respond(addPerson(store, body), 201);
        if (method === "PATCH" && id !== undefined) return respond(updatePerson(store, id, body));
        if (method === "DELETE" && id !== undefined) return respond(removePerson(store, id));
        break;
      case "gifts":
        if (method === "GET" && id === undefined) return json({ gifts: getLedger(store).gifts });
        if (method === "POST" && id === undefined) return respond(addGift(store, body), 201);
        if (method === "PATCH" && id !== undefined) return respond(updateGift(store, id, body));
        if (method === "DELETE" && id !== undefined) return respond(removeGift(store, id));
        break;
      case "occasions":
        if (method === "GET" && id === undefined) return json({ occasions: getLedger(store).occasions });
        if (method === "POST" && id === undefined) return respond(addOccasion(store, body), 201);
        if (method === "PATCH" && id !== undefined) return respond(renameOccasion(store, id, body));
        if (method === "DELETE" && id !== undefined) return respond(removeOccasion(store, id));
        break;
      case "export":
        if (method === "GET" && id === undefined) {
          const response = json(exportLedger(store));
          response.headers.set("content-disposition", 'attachment; filename="ribbon-ledger.json"');
          return response;
        }
        break;
      case "import":
        if (method === "POST" && id === undefined) {
          const record = (body ?? {}) as { demo?: unknown; demoDismissed?: unknown };
          const backup = parseBackupData(body);
          if (!backup) return error(400, "That file is not a Ribbon ledger.");
          replaceLedger(store, backup, {
            demo: record.demo === true,
            demoDismissed: record.demoDismissed !== false,
          });
          return json(getLedger(store));
        }
        break;
      default:
        return error(404, "Not found.");
    }
    return error(405, "That method is not allowed here.");
  } catch (err) {
    console.error("[ribbon] api error:", err instanceof Error ? err.message : err);
    return error(500, "Something went wrong on the server.");
  }
}
