// A fake Google for tests: the OAuth token / revoke endpoints and the Calendar and People APIs, in one
// local HTTP server. It checks what real Google checks (client id and secret, redirect URI, PKCE S256
// verifier, refresh tokens) so the tests prove Ribbon sends them. This is NOT Google: nothing here has
// been run against the real service.
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { GoogleEndpoints } from "./google.ts";

export type FakeGoogle = {
  endpoints: GoogleEndpoints;
  server: Server;
  /** What a user does on Google's consent screen: approve a request URL and get the code Google would redirect back with. */
  approve: (authUrl: string, options?: { scopes?: string[]; omitRefresh?: boolean }) => { code: string; state: string };
  calendars: { id: string; summary: string; primary?: boolean; selected?: boolean }[];
  events: Record<string, object[]>;
  people: object[];
  log: { path: string; auth?: string; body?: string }[];
  revoked: string[];
  tokenCalls: { grant: string }[];
  /** Make access tokens expire immediately (forces a refresh on the next call). */
  expireAccessTokens: () => void;
  /** Make every refresh answer invalid_grant, like a revoked grant. */
  revokeEverything: () => void;
  failApi: { status: number; body?: string } | null;
  close: () => Promise<void>;
};

export const FAKE_CLIENT = { clientId: "fake-client-id.apps.googleusercontent.com", clientSecret: "fake-client-secret" };

export async function startFakeGoogle(): Promise<FakeGoogle> {
  const codes = new Map<string, { challenge: string; redirect: string; scopes: string[]; omitRefresh: boolean }>();
  const access = new Map<string, number>(); // token -> expires at
  const refresh = new Set<string>();
  const fake = { calendars: [{ id: "me@example.com", summary: "Me", primary: true }, { id: "family@group.calendar.google.com", summary: "Family" }] as FakeGoogle["calendars"], events: {} as Record<string, object[]>, people: [] as object[], log: [] as FakeGoogle["log"], revoked: [] as string[], tokenCalls: [] as { grant: string }[], failApi: null as FakeGoogle["failApi"], revoked_all: false };

  const body = (req: IncomingMessage) => new Promise<string>((resolve) => {
    let text = "";
    req.on("data", (c) => (text += c));
    req.on("end", () => resolve(text));
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const text = req.method === "POST" ? await body(req) : "";
    fake.log.push({ path: `${req.method} ${url.pathname}`, auth: req.headers.authorization, body: text });
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };

    if (url.pathname === "/token" && req.method === "POST") {
      const f = new URLSearchParams(text);
      fake.tokenCalls.push({ grant: f.get("grant_type") ?? "" });
      if (f.get("client_id") !== FAKE_CLIENT.clientId || f.get("client_secret") !== FAKE_CLIENT.clientSecret) return send(401, { error: "invalid_client" });
      if (f.get("grant_type") === "authorization_code") {
        const entry = codes.get(f.get("code") ?? "");
        codes.delete(f.get("code") ?? ""); // single use
        if (!entry || entry.redirect !== f.get("redirect_uri")) return send(400, { error: "invalid_grant" });
        const verifier = f.get("code_verifier") ?? "";
        if (createHash("sha256").update(verifier).digest("base64url") !== entry.challenge) return send(400, { error: "invalid_grant", error_description: "PKCE verifier does not match" });
        const a = `at-${randomBytes(8).toString("hex")}`;
        const r = `rt-${randomBytes(8).toString("hex")}`;
        access.set(a, Date.now() + 3600_000);
        refresh.add(r);
        return send(200, { access_token: a, expires_in: 3600, scope: entry.scopes.join(" "), token_type: "Bearer", ...(entry.omitRefresh ? {} : { refresh_token: r }) });
      }
      if (f.get("grant_type") === "refresh_token") {
        if (fake.revoked_all || !refresh.has(f.get("refresh_token") ?? "")) return send(400, { error: "invalid_grant" });
        const a = `at-${randomBytes(8).toString("hex")}`;
        access.set(a, Date.now() + 3600_000);
        return send(200, { access_token: a, expires_in: 3600, token_type: "Bearer" });
      }
      return send(400, { error: "unsupported_grant_type" });
    }
    if (url.pathname === "/revoke" && req.method === "POST") {
      const token = new URLSearchParams(text).get("token") ?? "";
      fake.revoked.push(token);
      refresh.delete(token);
      return send(200, {});
    }

    // ---- APIs: need a live bearer token ----
    const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ""))?.[1];
    const expiresAt = bearer ? access.get(bearer) : undefined;
    if (!bearer || !expiresAt || expiresAt < Date.now()) return send(401, { error: { code: 401, message: "Invalid Credentials" } });
    if (fake.failApi) return send(fake.failApi.status, fake.failApi.body ? JSON.parse(fake.failApi.body) : { error: { code: fake.failApi.status } });
    if (url.pathname === "/calendar/v3/users/me/calendarList") return send(200, { items: fake.calendars });
    const m = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(url.pathname);
    if (m) {
      const all = fake.events[decodeURIComponent(m[1]!)] ?? [];
      const page = Number(url.searchParams.get("pageToken") ?? 0);
      const slice = all.slice(page * 2, page * 2 + 2); // two per page so paging is exercised
      return send(200, { items: slice, ...((page + 1) * 2 < all.length ? { nextPageToken: String(page + 1) } : {}) });
    }
    if (url.pathname === "/people/v1/people/me/connections") return send(200, { connections: fake.people });
    return send(404, { error: { code: 404 } });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const api: FakeGoogle = {
    endpoints: { auth: `${base}/auth`, token: `${base}/token`, revoke: `${base}/revoke`, calendar: `${base}/calendar/v3`, people: `${base}/people/v1` },
    server,
    approve(authUrl, options = {}) {
      const u = new URL(authUrl);
      const q = u.searchParams;
      if (q.get("client_id") !== FAKE_CLIENT.clientId) throw new Error("wrong client_id");
      if (q.get("response_type") !== "code") throw new Error("wrong response_type");
      if (q.get("code_challenge_method") !== "S256") throw new Error("PKCE S256 missing");
      if (!q.get("state") || (q.get("state") ?? "").length < 20) throw new Error("state missing or weak");
      if (q.get("access_type") !== "offline") throw new Error("offline access not requested");
      const code = `code-${randomBytes(8).toString("hex")}`;
      codes.set(code, { challenge: q.get("code_challenge")!, redirect: q.get("redirect_uri")!, scopes: options.scopes ?? (q.get("scope") ?? "").split(" "), omitRefresh: options.omitRefresh === true });
      return { code, state: q.get("state")! };
    },
    get calendars() {
      return fake.calendars;
    },
    set calendars(v) {
      fake.calendars = v;
    },
    events: fake.events,
    people: fake.people,
    log: fake.log,
    revoked: fake.revoked,
    tokenCalls: fake.tokenCalls,
    expireAccessTokens: () => {
      for (const k of access.keys()) access.set(k, 0);
    },
    revokeEverything: () => {
      fake.revoked_all = true;
    },
    get failApi() {
      return fake.failApi;
    },
    set failApi(v) {
      fake.failApi = v;
    },
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
  return api;
}
