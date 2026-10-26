// A FAKE CalDAV server for tests (not shipped in use). It speaks just enough RFC 4791 for Ribbon:
// principal discovery, calendar home, collection listing with ctags, REPORT calendar-query, Basic auth.
// It proves Ribbon's side of the protocol; it is not iCloud, Nextcloud or any real server.
import { createServer, type Server } from "node:http";

export type FakeCalendar = { slug: string; name: string; ctag: string; events: string; components?: string[]; color?: string };
export type FakeCaldav = {
  origin: string;
  calendars: FakeCalendar[];
  hits: { propfind: number; report: number; unauthorized: number; paths: string[] };
  authSeen: string[];
  failReport: boolean;
  close(): Promise<void>;
};

export const FAKE_LOGIN = { username: "fam@example.com", password: "abcd-efgh-ijkl-mnop" };
const NS = `xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/" xmlns:A="http://apple.com/ns/ical/"`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function startFakeCaldav(calendars: FakeCalendar[], opts: { wellKnownOnly?: boolean } = {}): Promise<FakeCaldav> {
  const hits = { propfind: 0, report: 0, unauthorized: 0, paths: [] as string[] };
  const fake: FakeCaldav = { origin: "", calendars, hits, authSeen: [], failReport: false, close: async () => {} };
  const ok = (props: string, href: string) => `<D:response><D:href>${href}</D:href><D:propstat><D:prop>${props}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
  const multi = (inner: string) => `<?xml version="1.0" encoding="utf-8"?><D:multistatus ${NS}>${inner}</D:multistatus>`;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const path = (req.url ?? "/").split("?")[0]!;
      fake.authSeen.push(String(req.headers.authorization ?? ""));
      fake.hits.paths.push(`${req.method} ${path}`);
      const expect = `Basic ${Buffer.from(`${FAKE_LOGIN.username}:${FAKE_LOGIN.password}`).toString("base64")}`;
      if (req.headers.authorization !== expect) {
        hits.unauthorized += 1;
        res.writeHead(401, { "www-authenticate": 'Basic realm="fake"' });
        return res.end();
      }
      const send = (xml: string) => {
        res.writeHead(207, { "content-type": "application/xml; charset=utf-8" });
        res.end(xml);
      };
      if (req.method === "PROPFIND") hits.propfind += 1;
      if (req.method === "REPORT") hits.report += 1;
      const calPath = /^\/calendars\/fam\/([a-z0-9-]+)\/$/.exec(path);
      const cal = calPath ? calendars.find((c) => c.slug === calPath[1]) : undefined;
      if (req.method === "PROPFIND" && (path === "/" || path === "/.well-known/caldav")) {
        if (opts.wellKnownOnly && path === "/") {
          res.writeHead(404);
          return res.end();
        }
        return send(multi(ok(`<D:current-user-principal><D:href>/principals/fam/</D:href></D:current-user-principal>`, path)));
      }
      if (req.method === "PROPFIND" && path === "/principals/fam/") return send(multi(ok(`<C:calendar-home-set><D:href>/calendars/fam/</D:href></C:calendar-home-set>`, path)));
      if (req.method === "PROPFIND" && path === "/calendars/fam/") {
        const list = calendars
          .map((c) =>
            ok(
              `<D:resourcetype><D:collection/><C:calendar/></D:resourcetype><D:displayname>${esc(c.name)}</D:displayname>${c.color ? `<A:calendar-color>${c.color}FF</A:calendar-color>` : ""}<C:supported-calendar-component-set>${(c.components ?? ["VEVENT"]).map((n) => `<C:comp name="${n}"/>`).join("")}</C:supported-calendar-component-set><CS:getctag>${c.ctag}</CS:getctag>`,
              `/calendars/fam/${c.slug}/`,
            ),
          )
          .join("");
        const inbox = ok(`<D:resourcetype><D:collection/></D:resourcetype><D:displayname>inbox</D:displayname>`, "/calendars/fam/inbox/");
        return send(multi(ok(`<D:resourcetype><D:collection/></D:resourcetype>`, "/calendars/fam/") + inbox + list));
      }
      if (req.method === "PROPFIND" && cal) {
        return send(multi(ok(`<D:resourcetype><D:collection/><C:calendar/></D:resourcetype><D:displayname>${esc(cal.name)}</D:displayname><CS:getctag>${cal.ctag}</CS:getctag>`, path)));
      }
      if (req.method === "REPORT" && cal) {
        if (fake.failReport) {
          res.writeHead(500);
          return res.end("boom");
        }
        const body = Buffer.concat(chunks).toString();
        if (!/calendar-query/.test(body) || !/time-range/.test(body)) {
          res.writeHead(400);
          return res.end("expected a calendar-query with a time-range");
        }
        return send(multi(ok(`<D:getetag>"1"</D:getetag><C:calendar-data>${esc(cal.events)}</C:calendar-data>`, `${path}event-1.ics`)));
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  fake.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return fake;
}
