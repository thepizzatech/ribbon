import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { handleApi } from "./api.ts";
import { openDb } from "./db.ts";
import {
  PEER_HEADER,
  clientAddress,
  insecureLoginReason,
  isPrivateAddress,
  isSecureRequest,
  originAllowed,
  requestHost,
  requestScheme,
  securityHeaders,
} from "./security.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEYS = ["ENFORCE_HTTPS", "PUBLIC_URL", "TRUSTED_PROXIES", "HSTS", "ALLOW_INSECURE_LOGIN", "NODE_ENV"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  for (const key of KEYS) if (key !== "NODE_ENV") delete process.env[key];
});
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const req = (url: string, headers: Record<string, string> = {}, peer?: string) =>
  new Request(url, { headers: { ...headers, ...(peer ? { [PEER_HEADER]: peer } : {}) } });

describe("trusting forwarded headers", () => {
  test("X-Forwarded-Proto/-Host/-For from an untrusted peer are ignored", () => {
    const r = req(
      "http://ribbon.lan:8080/",
      { "x-forwarded-proto": "https", "x-forwarded-host": "evil.example", "x-forwarded-for": "10.0.0.9", host: "ribbon.lan:8080" },
      "203.0.113.50",
    );
    assert.equal(requestScheme(r), "http");
    assert.equal(isSecureRequest(r), false);
    assert.equal(requestHost(r), "ribbon.lan:8080");
    assert.equal(clientAddress(r), "203.0.113.50");
    assert.equal(securityHeaders(r)["strict-transport-security"], undefined);
  });

  test("the same headers from a trusted (private) peer are honoured", () => {
    const r = req(
      "http://ribbon:8080/",
      { "x-forwarded-proto": "https", "x-forwarded-host": "ribbon.example.com", "x-forwarded-for": "198.51.100.7", host: "ribbon:8080" },
      "172.18.0.4",
    );
    assert.equal(requestScheme(r), "https");
    assert.equal(requestHost(r), "ribbon.example.com");
    assert.equal(clientAddress(r), "198.51.100.7");
    assert.match(securityHeaders(r)["strict-transport-security"] ?? "", /^max-age=15552000$/);
  });

  test("a forged X-Forwarded-For hop is skipped over trusted proxies only from the right", () => {
    const r = req("http://app/", { "x-forwarded-for": "6.6.6.6, 198.51.100.7, 10.0.0.2" }, "10.0.0.3");
    assert.equal(clientAddress(r), "198.51.100.7");
  });

  test("IPv4-mapped IPv6 peers and Tailscale addresses count as private/trusted", () => {
    assert.equal(isPrivateAddress("::ffff:192.168.1.5"), true);
    assert.equal(isPrivateAddress("100.101.102.103"), true);
    assert.equal(isPrivateAddress("fd12::1"), true);
    assert.equal(isPrivateAddress("8.8.8.8"), false);
    assert.equal(isPrivateAddress("2001:db8::1"), false);
    const r = req("http://app/", { "x-forwarded-proto": "https" }, "::ffff:100.64.0.9");
    assert.equal(requestScheme(r), "https");
  });

  test("TRUSTED_PROXIES=none trusts nobody; a CIDR list replaces the default", () => {
    const r = req("http://app/", { "x-forwarded-proto": "https" }, "10.0.0.3");
    process.env.TRUSTED_PROXIES = "none";
    assert.equal(requestScheme(r), "http");
    process.env.TRUSTED_PROXIES = "192.168.50.0/24, 2001:db8::/32";
    assert.equal(requestScheme(r), "http");
    assert.equal(requestScheme(req("http://app/", { "x-forwarded-proto": "https" }, "192.168.50.9")), "https");
    assert.equal(requestScheme(req("http://app/", { "x-forwarded-proto": "https" }, "2001:db8::5")), "https");
  });

  test("in production an unstamped request has an unknown, untrusted peer", () => {
    process.env.NODE_ENV = "production";
    const r = new Request("http://app/", { headers: { "x-forwarded-proto": "https" } });
    assert.equal(requestScheme(r), "http");
  });
});

describe("PUBLIC_URL precedence", () => {
  test("PUBLIC_URL beats a trusted X-Forwarded-Proto when the request is for that host", () => {
    process.env.PUBLIC_URL = "https://ribbon.example.com";
    const r = req("http://ribbon:8080/", { host: "ribbon.example.com", "x-forwarded-proto": "http" }, "10.0.0.2");
    assert.equal(requestScheme(r), "https");
  });

  test("a request for another host (the LAN address) falls through to the proxy/socket", () => {
    process.env.PUBLIC_URL = "https://ribbon.example.com";
    const r = req("http://10.0.0.5:8080/", { host: "10.0.0.5:8080" }, "192.168.1.9");
    assert.equal(requestScheme(r), "http");
    assert.equal(insecureLoginReason(r), null); // LAN login keeps working
  });

  test("PUBLIC_URL as plain http says http", () => {
    process.env.PUBLIC_URL = "http://ribbon.lan:8080";
    assert.equal(requestScheme(req("http://x/", { host: "ribbon.lan:8080", "x-forwarded-proto": "https" }, "10.0.0.2")), "http");
  });
});

describe("HSTS", () => {
  test("only when effectively https, no includeSubDomains, can be switched off", () => {
    const https = req("http://app/", { "x-forwarded-proto": "https" }, "10.0.0.2");
    const http = req("http://app/", {}, "10.0.0.2");
    assert.equal(securityHeaders(https)["strict-transport-security"], "max-age=15552000");
    assert.ok(!securityHeaders(https)["strict-transport-security"]?.includes("includeSubDomains"));
    assert.equal(securityHeaders(http)["strict-transport-security"], undefined);
    process.env.HSTS = "off";
    assert.equal(securityHeaders(https)["strict-transport-security"], undefined);
  });

  test("other security headers are always sent", () => {
    const headers = securityHeaders(req("http://app/", {}, "10.0.0.2"));
    assert.match(headers["content-security-policy"] ?? "", /frame-ancestors 'none'/);
    assert.match(headers["content-security-policy"] ?? "", /worker-src 'self'/);
    assert.equal(headers["x-content-type-options"], "nosniff");
    assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");
  });
});

describe("insecure sign-in guard", () => {
  test("plain HTTP from the home network is allowed; from a public address it is refused", () => {
    assert.equal(insecureLoginReason(req("http://10.0.0.5:8080/", {}, "192.168.1.20")), null);
    assert.match(insecureLoginReason(req("http://app/", {}, "203.0.113.9")) ?? "", /home network/);
  });

  test("behind a trusted proxy the guard looks at the forwarded client, not the proxy", () => {
    assert.match(insecureLoginReason(req("http://app/", { "x-forwarded-for": "203.0.113.9" }, "10.0.0.2")) ?? "", /home network/);
    assert.equal(insecureLoginReason(req("http://app/", { "x-forwarded-for": "192.168.1.9" }, "10.0.0.2")), null);
    assert.equal(insecureLoginReason(req("http://app/", { "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https" }, "10.0.0.2")), null);
  });

  test("ALLOW_INSECURE_LOGIN lifts it; ENFORCE_HTTPS refuses it from everywhere", () => {
    const outside = req("http://app/", {}, "203.0.113.9");
    const inside = req("http://app/", {}, "192.168.1.9");
    process.env.ALLOW_INSECURE_LOGIN = "true";
    assert.equal(insecureLoginReason(outside), null);
    process.env.ENFORCE_HTTPS = "true";
    assert.match(insecureLoginReason(inside) ?? "", /only accepts sign-in over HTTPS/);
    assert.equal(insecureLoginReason(req("http://app/", { "x-forwarded-proto": "https" }, "10.0.0.2")), null);
  });

  test("the login and setup endpoints enforce it; health stays open", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ribbon-sec-"));
    const db = openDb(dir, { seed: false });
    try {
      const send = (path: string, method: string, body: unknown, peer: string) =>
        handleApi(
          new Request(`http://app${path}`, {
            method,
            headers: { "content-type": "application/json", [PEER_HEADER]: peer },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
          db,
        );
      const setup = { familyName: "F", username: "owner", password: "a-long-enough-password" };
      assert.equal((await send("/api/setup", "POST", setup, "203.0.113.9")).status, 403);
      assert.equal((await send("/api/login", "POST", { username: "a", password: "b" }, "203.0.113.9")).status, 403);
      assert.equal((await send("/api/health", "GET", undefined, "203.0.113.9")).status, 200);
      const session = await (await send("/api/session", "GET", undefined, "203.0.113.9")).json();
      assert.equal(session.secure, false);
      assert.match(session.insecureLoginBlocked, /home network/);
      assert.equal((await send("/api/setup", "POST", setup, "192.168.1.9")).status, 201);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("origin check", () => {
  test("no Origin header is fine; same host passes; other host or null fails", () => {
    const peer = "10.0.0.2";
    assert.equal(originAllowed(req("http://ribbon.lan/api/x", { host: "ribbon.lan" }, peer)), true);
    assert.equal(originAllowed(req("http://ribbon.lan/api/x", { host: "ribbon.lan", origin: "https://ribbon.lan" }, peer)), true);
    assert.equal(originAllowed(req("http://app/api/x", { host: "app", "x-forwarded-host": "ribbon.lan", origin: "https://ribbon.lan" }, peer)), true);
    assert.equal(originAllowed(req("http://ribbon.lan/api/x", { host: "ribbon.lan", origin: "https://evil.example" }, peer)), false);
    assert.equal(originAllowed(req("http://ribbon.lan/api/x", { host: "ribbon.lan", origin: "null" }, peer)), false);
  });

  test("an untrusted peer cannot make an evil origin pass with X-Forwarded-Host", () => {
    const r = req("http://ribbon.lan/api/x", { host: "ribbon.lan", "x-forwarded-host": "evil.example", origin: "https://evil.example" }, "203.0.113.9");
    assert.equal(originAllowed(r), false);
  });

  test("PUBLIC_URL's host is an allowed origin", () => {
    process.env.PUBLIC_URL = "https://ribbon.example.com";
    assert.equal(originAllowed(req("http://app/api/x", { host: "app", origin: "https://ribbon.example.com" }, "203.0.113.9")), true);
  });
});
