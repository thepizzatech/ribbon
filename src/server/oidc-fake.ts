// An in-process OpenID provider for tests: discovery, JWKS, authorize (auto sign-in) and token endpoints.
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";

export type Profile = { sub: string; email?: string; email_verified?: boolean; name?: string };
export type Tamper = { nonce?: string; aud?: string; iss?: string; expired?: boolean; wrongKey?: boolean; noIdToken?: boolean; denied?: boolean };

export type FakeProvider = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  profile: Profile;
  tamper: Tamper;
  authorizeParams: URLSearchParams | null;
  tokenRequests: { auth: string | null; body: URLSearchParams }[];
  close: () => Promise<void>;
};

export async function startFakeProvider(): Promise<FakeProvider> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const codes = new Map<string, { nonce: string; challenge: string; profile: Profile; tamper: Tamper }>();
  const state: FakeProvider = {
    issuer: "",
    clientId: "ribbon-test",
    clientSecret: "s3cret",
    profile: { sub: "user-1", email: "avery@example.com", email_verified: true, name: "Avery" },
    tamper: {},
    authorizeParams: null,
    tokenRequests: [],
    close: async () => {},
  };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", state.issuer);
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration") {
      return send(200, {
        issuer: state.issuer,
        authorization_endpoint: `${state.issuer}/authorize`,
        token_endpoint: `${state.issuer}/token`,
        jwks_uri: `${state.issuer}/jwks`,
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    }
    if (url.pathname === "/jwks") return send(200, { keys: [jwk] });
    if (url.pathname === "/authorize") {
      state.authorizeParams = url.searchParams;
      const redirect = new URL(url.searchParams.get("redirect_uri")!);
      if (state.tamper.denied) {
        redirect.searchParams.set("error", "access_denied");
        redirect.searchParams.set("state", url.searchParams.get("state")!);
        res.writeHead(302, { location: redirect.toString() });
        return res.end();
      }
      const code = `code-${codes.size + 1}-${Math.random().toString(36).slice(2)}`;
      codes.set(code, { nonce: url.searchParams.get("nonce")!, challenge: url.searchParams.get("code_challenge")!, profile: { ...state.profile }, tamper: { ...state.tamper } });
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", url.searchParams.get("state")!);
      res.writeHead(302, { location: redirect.toString() });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = new URLSearchParams(Buffer.concat(chunks).toString());
      state.tokenRequests.push({ auth: req.headers.authorization ?? null, body });
      const entry = codes.get(body.get("code") ?? "");
      codes.delete(body.get("code") ?? ""); // single use
      if (!entry) return send(400, { error: "invalid_grant" });
      const expectedBasic = `Basic ${Buffer.from(`${state.clientId}:${state.clientSecret}`).toString("base64")}`;
      const postAuth = body.get("client_id") === state.clientId && body.get("client_secret") === state.clientSecret;
      if (req.headers.authorization !== expectedBasic && !postAuth) return send(401, { error: "invalid_client" });
      const challenge = createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url");
      if (challenge !== entry.challenge) return send(400, { error: "invalid_grant", error_description: "PKCE verification failed" });
      if (entry.tamper.noIdToken) return send(200, { access_token: "at", token_type: "Bearer" });
      const now = Math.floor(Date.now() / 1000);
      const jwt = new SignJWT({ ...entry.profile, nonce: entry.tamper.nonce ?? entry.nonce })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(entry.tamper.iss ?? state.issuer)
        .setAudience(entry.tamper.aud ?? state.clientId)
        .setSubject(entry.profile.sub)
        .setIssuedAt(entry.tamper.expired ? now - 7200 : now)
        .setExpirationTime(entry.tamper.expired ? now - 3600 : now + 300);
      const idToken = await jwt.sign(entry.tamper.wrongKey ? other.privateKey : privateKey);
      return send(200, { access_token: "at", token_type: "Bearer", id_token: idToken });
    }
    return send(404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () => new Promise((resolve) => server.close(() => resolve()));
  return state;
}
