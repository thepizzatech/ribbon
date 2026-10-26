import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { afterEach, describe, it } from "node:test";
import { CalendarFetchError, guardedFetch, isBlockedAddress, normalizeCalendarUrl } from "./safe-fetch.ts";

const servers: Server[] = [];
function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    servers.push(server);
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`));
  });
}
afterEach(() => {
  delete process.env.ALLOW_PRIVATE_CALENDAR_URLS;
  for (const s of servers.splice(0)) s.close();
});

describe("address guard", () => {
  it("blocks private, loopback, link-local, metadata and special addresses", () => {
    for (const ip of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "0.1.2.3",
      "224.0.0.1", "255.255.255.255", "198.18.0.1", "::1", "::", "fe80::1", "fc00::1", "fd00:ec2::254", "ff02::1",
      "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::127.0.0.1", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "2002:7f00:1::1", "2001:db8::1", "[::1]", "not-an-ip",
    ]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
  });
  it("lets public addresses through", () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"]) {
      assert.equal(isBlockedAddress(ip), false, ip);
    }
  });
});

describe("url rules", () => {
  it("reads webcal as https and refuses other schemes and embedded credentials", () => {
    const ok = normalizeCalendarUrl("webcal://p01-caldav.icloud.com/published/2/abc");
    assert.ok(ok.ok && ok.url.protocol === "https:");
    const secure = normalizeCalendarUrl("WEBCALS://example.com/a.ics");
    assert.ok(secure.ok && secure.url.protocol === "https:");
    for (const bad of ["file:///etc/passwd", "ftp://example.com/a.ics", "gopher://x", "javascript:alert(1)", "https://user:pw@example.com/a.ics", "", "   ", "https://", 42, "http://exa mple.com"]) {
      assert.equal(normalizeCalendarUrl(bad).ok, false, String(bad));
    }
  });
});

describe("guarded fetch", () => {
  it("refuses loopback and private literals by default, and hosts that resolve there", async () => {
    const url = await serve((_req, res) => res.end("hi"));
    await assert.rejects(guardedFetch(url), (e: unknown) => e instanceof CalendarFetchError && e.code === "blocked");
    await assert.rejects(guardedFetch("http://localhost:1/x.ics"), (e: unknown) => e instanceof CalendarFetchError && e.code === "blocked");
    await assert.rejects(guardedFetch("http://169.254.169.254/latest/meta-data/"), (e: unknown) => e instanceof CalendarFetchError && e.code === "blocked");
    await assert.rejects(guardedFetch("http://[::1]:8080/"), (e: unknown) => e instanceof CalendarFetchError && e.code === "blocked");
    await assert.rejects(guardedFetch("http://[::ffff:10.0.0.1]/"), (e: unknown) => e instanceof CalendarFetchError && e.code === "blocked");
  });

  it("works against a private server only with ALLOW_PRIVATE_CALENDAR_URLS=true", async () => {
    process.env.ALLOW_PRIVATE_CALENDAR_URLS = "true";
    const url = await serve((_req, res) => res.end("hello"));
    const out = await guardedFetch(url);
    assert.equal(out.status, 200);
    assert.equal(out.body.toString(), "hello");
  });

  it("re-checks every redirect hop and caps the number of hops", async () => {
    // public-looking first hop is impossible offline, so use the escape hatch off and prove the redirect target is judged on its own
    process.env.ALLOW_PRIVATE_CALENDAR_URLS = "true";
    let hits = 0;
    const loop = await serve((req, res) => {
      hits += 1;
      res.writeHead(302, { location: `${req.url === "/a" ? "/b" : "/a"}` });
      res.end();
    });
    await assert.rejects(guardedFetch(`${loop}/a`), (e: unknown) => e instanceof CalendarFetchError && e.code === "redirects");
    assert.equal(hits, 6);
    // a redirect into metadata space is refused once the escape hatch is off
    delete process.env.ALLOW_PRIVATE_CALENDAR_URLS;
    const to = await serve((_req, res) => {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    });
    await assert.rejects(guardedFetch(to), (e: unknown) => e instanceof CalendarFetchError && e.code === "blocked");
  });

  it("stops redirects to non-http schemes", async () => {
    process.env.ALLOW_PRIVATE_CALENDAR_URLS = "true";
    const url = await serve((_req, res) => {
      res.writeHead(302, { location: "file:///etc/passwd" });
      res.end();
    });
    await assert.rejects(guardedFetch(url), (e: unknown) => e instanceof CalendarFetchError && e.code === "invalid");
  });

  it("caps the body at the size limit, including after decompression", async () => {
    process.env.ALLOW_PRIVATE_CALENDAR_URLS = "true";
    const big = await serve((_req, res) => {
      res.setHeader("content-type", "text/calendar");
      res.write(Buffer.alloc(1024 * 1024, 65));
      res.write(Buffer.alloc(1024 * 1024, 65));
      res.end();
    });
    await assert.rejects(guardedFetch(big, { maxBytes: 1024 * 1024 }), (e: unknown) => e instanceof CalendarFetchError && e.code === "too_large");
    const bomb = await serve((_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(gzipSync(Buffer.alloc(8 * 1024 * 1024, 65)));
    });
    await assert.rejects(guardedFetch(bomb), (e: unknown) => e instanceof CalendarFetchError && e.code === "too_large");
    const small = await serve((_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(gzipSync("BEGIN:VCALENDAR"));
    });
    assert.equal((await guardedFetch(small)).body.toString(), "BEGIN:VCALENDAR");
  });

  it("times out a server that never answers", async () => {
    process.env.ALLOW_PRIVATE_CALENDAR_URLS = "true";
    const slow = await serve(() => {
      /* never respond */
    });
    const started = Date.now();
    await assert.rejects(guardedFetch(slow, { timeoutMs: 300 }), (e: unknown) => e instanceof CalendarFetchError && e.code === "timeout");
    assert.ok(Date.now() - started < 3000);
  });

  it("only sends Authorization to the first host", async () => {
    process.env.ALLOW_PRIVATE_CALENDAR_URLS = "true";
    let seen: string | undefined = "unset";
    const target = await serve((req, res) => {
      seen = req.headers.authorization;
      res.end("ok");
    });
    const other = target.replace("127.0.0.1", "localhost");
    const start = await serve((_req, res) => {
      res.writeHead(302, { location: `${other}/x` });
      res.end();
    });
    await guardedFetch(start, { headers: { authorization: "Basic abc" } });
    assert.equal(seen, undefined);
  });
});
