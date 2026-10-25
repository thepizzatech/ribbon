import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { httpsRedirectTarget, originAllowed, requestProto, securityHeaders } from "./security.ts";

const KEYS = ["ENFORCE_HTTPS", "PUBLIC_URL"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
});
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe("HTTPS enforcement", () => {
  test("off by default: nothing is redirected and no HSTS is sent", () => {
    delete process.env.ENFORCE_HTTPS;
    assert.equal(httpsRedirectTarget(req("http://ribbon.lan/ledger")), null);
    assert.equal(securityHeaders(req("http://ribbon.lan/", { "x-forwarded-proto": "https" }))["strict-transport-security"], undefined);
  });

  test("on: plain HTTP is redirected to HTTPS, keeping path and query", () => {
    process.env.ENFORCE_HTTPS = "true";
    assert.equal(httpsRedirectTarget(req("http://ribbon.lan:8090/ledger?q=a", { host: "ribbon.lan:8090" })), "https://ribbon.lan/ledger?q=a");
  });

  test("on: requests that arrive over HTTPS through the proxy are left alone", () => {
    process.env.ENFORCE_HTTPS = "true";
    assert.equal(httpsRedirectTarget(req("http://app:8080/", { "x-forwarded-proto": "https" })), null);
    assert.equal(requestProto(req("http://app:8080/", { "x-forwarded-proto": "https, http" })), "https");
  });

  test("on: the health check stays reachable over plain HTTP", () => {
    process.env.ENFORCE_HTTPS = "true";
    assert.equal(httpsRedirectTarget(req("http://127.0.0.1:8080/api/health")), null);
  });

  test("PUBLIC_URL sets the redirect target (custom HTTPS port)", () => {
    process.env.ENFORCE_HTTPS = "true";
    process.env.PUBLIC_URL = "https://10.15.40.16:8443/";
    assert.equal(httpsRedirectTarget(req("http://10.15.40.16:8090/people")), "https://10.15.40.16:8443/people");
  });

  test("HSTS only over HTTPS with enforcement on; other security headers always", () => {
    process.env.ENFORCE_HTTPS = "true";
    const https = securityHeaders(req("http://app/", { "x-forwarded-proto": "https" }));
    assert.match(https["strict-transport-security"] ?? "", /max-age=31536000/);
    const http = securityHeaders(req("http://app/"));
    assert.equal(http["strict-transport-security"], undefined);
    for (const headers of [https, http]) {
      assert.match(headers["content-security-policy"] ?? "", /frame-ancestors 'none'/);
      assert.match(headers["content-security-policy"] ?? "", /default-src 'self'/);
      assert.equal(headers["x-content-type-options"], "nosniff");
      assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");
    }
  });
});

describe("origin check", () => {
  test("no Origin header is fine; same host passes; other host or null fails", () => {
    assert.equal(originAllowed(req("http://ribbon.lan/api/x", { host: "ribbon.lan" })), true);
    assert.equal(originAllowed(req("http://ribbon.lan/api/x", { host: "ribbon.lan", origin: "https://ribbon.lan" })), true);
    assert.equal(originAllowed(req("http://app/api/x", { host: "app", "x-forwarded-host": "ribbon.lan", origin: "https://ribbon.lan" })), true);
    assert.equal(originAllowed(req("http://ribbon.lan/api/x", { host: "ribbon.lan", origin: "https://evil.example" })), false);
    assert.equal(originAllowed(req("http://ribbon.lan/api/x", { host: "ribbon.lan", origin: "null" })), false);
  });
});
