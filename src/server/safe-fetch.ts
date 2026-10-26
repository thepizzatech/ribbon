// SSRF-safe HTTP(S) client for calendar feeds and CalDAV servers.
//  * only http: and https: (webcal:// is read as https://), no credentials in the URL
//  * every address a name resolves to is checked at connect time (no gap for DNS rebinding), and a
//    name that resolves to a private, loopback, link-local, metadata or otherwise special address is refused
//  * redirects are followed by hand (at most 5) and every hop goes through the same checks
//  * 10 second total timeout, 5 MB body cap (also after decompression)
//  * ALLOW_PRIVATE_CALENDAR_URLS=true switches the address check off for a homelab
import { lookup as dnsLookup } from "node:dns";
import { BlockList, isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import { allowPrivateCalendarUrls } from "./config.ts";
import { isPrivateAddress } from "./security.ts";

export const MAX_FEED_BYTES = 5 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 5;

export type FetchFailure = "invalid" | "blocked" | "timeout" | "too_large" | "network" | "redirects";
export class CalendarFetchError extends Error {
  code: FetchFailure;
  constructor(code: FetchFailure, message: string) {
    super(message);
    this.code = code;
  }
}

const special = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  special.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [
  ["::", 128],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  special.addSubnet(net, bits, "ipv6");
}

/** 16 bytes for an IPv6 text address (any form), or null. */
function v6bytes(text: string): number[] | null {
  let v = text;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (dotted) {
    const parts = dotted[1]!.split(".").map(Number);
    if (parts.some((n) => n > 255)) return null;
    v = v.slice(0, -dotted[1]!.length) + ((parts[0]! << 8) | parts[1]!).toString(16) + ":" + ((parts[2]! << 8) | parts[3]!).toString(16);
  }
  const halves = v.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    const n = parseInt(g, 16);
    out.push(n >> 8, n & 255);
  }
  return out.length === 16 ? out : null;
}

/** True for any address a calendar fetch must not reach (unless ALLOW_PRIVATE_CALENDAR_URLS). */
export function isBlockedAddress(address: string): boolean {
  let ip = address.trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const family = isIP(ip);
  if (!family) return true; // not an address at all: refuse rather than guess
  if (family === 6) {
    const b = v6bytes(ip);
    if (!b) return true;
    const embeddedV4 = (at: number) => `${b[at]}.${b[at + 1]}.${b[at + 2]}.${b[at + 3]}`;
    const zeros = (n: number) => b.slice(0, n).every((x) => x === 0);
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
    if ((zeros(10) && b[10] === 0xff && b[11] === 0xff) || (zeros(12) && !zeros(16))) return isBlockedAddress(embeddedV4(12));
    // NAT64 64:ff9b::/96 carries an IPv4 address in the last 32 bits
    if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) return isBlockedAddress(embeddedV4(12));
    // 6to4 2002::/16 carries one right after the prefix
    if (b[0] === 0x20 && b[1] === 0x02) return isBlockedAddress(embeddedV4(2)) || false;
    ip = b.reduce<string[]>((acc, x, i) => (i % 2 === 0 ? [...acc, ((x << 8) | b[i + 1]!).toString(16)] : acc), []).join(":");
  }
  return isPrivateAddress(ip) || special.check(ip, family === 4 ? "ipv4" : "ipv6") || (family === 6 && (ip === "0:0:0:0:0:0:0:1"));
}

/** A cleaned http(s) URL, or an error message. */
export function normalizeCalendarUrl(raw: unknown): { ok: true; url: URL } | { ok: false; reason: string } {
  if (typeof raw !== "string") return { ok: false, reason: "Enter the calendar address." };
  // eslint-disable-next-line no-control-regex
  const text = raw.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!text) return { ok: false, reason: "Enter the calendar address." };
  if (text.length > 2048) return { ok: false, reason: "That address is too long." };
  const swapped = text.replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(swapped);
  } catch {
    return { ok: false, reason: "That does not look like a web address. It should start with https:// or webcal://." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "Only https:// and webcal:// addresses can be used." };
  if (url.username || url.password) return { ok: false, reason: "Remove the username and password from the address. For a CalDAV server, enter them in their own fields." };
  if (!url.hostname) return { ok: false, reason: "That address has no host name." };
  return { ok: true, url };
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

/** `lookup` for http(s).request: resolves, then refuses the connection if any answer is a blocked address. */
function guardedLookup(hostname: string, options: { all?: boolean; family?: number }, callback: LookupCb) {
  dnsLookup(hostname, { all: true, family: options.family ?? 0, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    if (!allowPrivateCalendarUrls() && addresses.some((a) => isBlockedAddress(a.address))) {
      const blocked: NodeJS.ErrnoException = new Error("blocked address");
      blocked.code = "RIBBON_BLOCKED";
      return callback(blocked, "", 0);
    }
    if (options.all) return callback(null, addresses.map((a) => ({ address: a.address, family: a.family })));
    const first = addresses[0]!;
    callback(null, first.address, first.family);
  });
}

export type GuardedRequest = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** May the Authorization header go to this host? Default: only the host first asked. */
  sendAuthTo?: (host: string) => boolean;
};
export type GuardedResponse = { status: number; headers: Record<string, string>; body: Buffer; url: string };

const REDIRECT = new Set([301, 302, 303, 307, 308]);

function once(url: URL, req: GuardedRequest, headers: Record<string, string>, method: string, body: string | Buffer | undefined, deadline: number): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && !allowPrivateCalendarUrls() && isBlockedAddress(host)) {
      return reject(new CalendarFetchError("blocked", "That address points at a private or internal network, which Ribbon will not fetch."));
    }
    const max = req.maxBytes ?? MAX_FEED_BYTES;
    const left = Math.max(1, deadline - Date.now());
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      { method, headers, lookup: guardedLookup as never, agent: false, timeout: left },
      (response) => {
        const chunks: Buffer[] = [];
        let total = 0;
        const declared = Number(response.headers["content-length"] ?? 0);
        if (declared > max && !response.headers["content-encoding"]) {
          request.destroy();
          return reject(new CalendarFetchError("too_large", "That calendar is bigger than 5 MB."));
        }
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > max) {
            request.destroy();
            return reject(new CalendarFetchError("too_large", "That calendar is bigger than 5 MB."));
          }
          chunks.push(chunk);
        });
        response.on("error", () => reject(new CalendarFetchError("network", "The connection dropped while reading the calendar.")));
        response.on("end", () => {
          let data = Buffer.concat(chunks);
          const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
          try {
            const opts = { maxOutputLength: max };
            if (encoding === "gzip" || encoding === "x-gzip") data = gunzipSync(data, opts);
            else if (encoding === "deflate") data = inflateSync(data, opts);
            else if (encoding === "br") data = brotliDecompressSync(data, opts);
          } catch {
            return reject(new CalendarFetchError("too_large", "That calendar could not be unpacked (or is bigger than 5 MB)."));
          }
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(response.headers)) if (typeof v === "string") out[k.toLowerCase()] = v;
          resolve({ status: response.statusCode ?? 0, headers: out, body: data });
        });
      },
    );
    request.on("timeout", () => {
      request.destroy();
      reject(new CalendarFetchError("timeout", "The calendar server took too long to answer (10 seconds)."));
    });
    request.on("error", (err: NodeJS.ErrnoException) => {
      if (err instanceof CalendarFetchError) return reject(err);
      if (err.code === "RIBBON_BLOCKED") return reject(new CalendarFetchError("blocked", "That address points at a private or internal network, which Ribbon will not fetch."));
      if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") return reject(new CalendarFetchError("network", "That host name could not be found."));
      if (err.code === "ECONNREFUSED") return reject(new CalendarFetchError("network", "The calendar server refused the connection."));
      if (err.code === "ECONNRESET") return reject(new CalendarFetchError("network", "The connection to the calendar server was reset."));
      if (typeof err.code === "string" && /CERT|SSL|TLS|ERR_TLS/.test(err.code)) return reject(new CalendarFetchError("network", "The server's HTTPS certificate was not accepted."));
      reject(new CalendarFetchError("network", "Could not connect to the calendar server."));
    });
    if (body !== undefined) request.write(body);
    request.end();
  });
}

/** Fetch with all the guards above. Throws CalendarFetchError. 3xx responses are followed; a 304 or 4xx/5xx is returned as is. */
export async function guardedFetch(rawUrl: string | URL, req: GuardedRequest = {}): Promise<GuardedResponse> {
  const parsed = typeof rawUrl === "string" ? normalizeCalendarUrl(rawUrl) : { ok: true as const, url: rawUrl };
  if (!parsed.ok) throw new CalendarFetchError("invalid", parsed.reason);
  let url = parsed.url;
  const first = url.hostname;
  const deadline = Date.now() + (req.timeoutMs ?? FETCH_TIMEOUT_MS);
  let method = (req.method ?? "GET").toUpperCase();
  let body = req.body;
  const redirects = req.maxRedirects ?? MAX_REDIRECTS;
  for (let hop = 0; ; hop += 1) {
    const headers: Record<string, string> = { "user-agent": "Ribbon-calendar/1 (+https://github.com/thepizzatech/ribbon)", "accept-encoding": "gzip", ...req.headers };
    const mayAuth = url.hostname === first || (req.sendAuthTo?.(url.hostname) ?? false);
    if (!mayAuth) delete headers.authorization;
    if (headers.authorization && url.protocol !== "https:" && !allowPrivateCalendarUrls()) {
      throw new CalendarFetchError("invalid", "Passwords are only sent over https://.");
    }
    if (body !== undefined) headers["content-length"] = String(Buffer.byteLength(body));
    const res = await once(url, req, headers, method, body, deadline);
    if (REDIRECT.has(res.status) && res.headers.location) {
      if (hop >= redirects) throw new CalendarFetchError("redirects", "The calendar address redirects too many times.");
      let next: URL;
      try {
        next = new URL(res.headers.location, url);
      } catch {
        throw new CalendarFetchError("invalid", "The calendar server sent a bad redirect.");
      }
      const checked = normalizeCalendarUrl(next.toString());
      if (!checked.ok) throw new CalendarFetchError("invalid", checked.reason);
      url = checked.url;
      if (res.status === 303) {
        method = "GET";
        body = undefined;
        delete req.headers?.["content-type"];
      }
      continue;
    }
    return { ...res, url: url.toString() };
  }
}
