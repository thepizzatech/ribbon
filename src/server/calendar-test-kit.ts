// Helpers for the calendar tests: a tiny feed server and ICS builders (not itself a test file).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { after } from "node:test";

const servers: Server[] = [];
after(() => {
  for (const s of servers.splice(0)) s.close();
});

export type FeedState = { body: string; etag: string | null; hits: number; conditional: number; status: number; lastHeaders: IncomingMessage["headers"] };

/** A local feed that honours If-None-Match. Needs ALLOW_PRIVATE_CALENDAR_URLS=true to be reachable. */
export async function feedServer(initial: string, etag: string | null = '"v1"') {
  const state: FeedState = { body: initial, etag, hits: 0, conditional: 0, status: 200, lastHeaders: {} };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    state.hits += 1;
    state.lastHeaders = req.headers;
    if (state.status !== 200) {
      res.writeHead(state.status);
      return res.end("nope");
    }
    if (state.etag && req.headers["if-none-match"] === state.etag) {
      state.conditional += 1;
      res.writeHead(304, { etag: state.etag });
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/calendar", ...(state.etag ? { etag: state.etag } : {}) });
    res.end(state.body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { state, url: `http://127.0.0.1:${port}/cal.ics`, origin: `http://127.0.0.1:${port}` };
}

const p2 = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
export const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const inDays = (n: number, from = new Date()) => new Date(from.getFullYear(), from.getMonth(), from.getDate() + n, 12);

export function ics(events: string[][], header: string[] = []): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", ...header, ...events.flatMap((e) => ["BEGIN:VEVENT", ...e, "END:VEVENT"]), "END:VCALENDAR", ""].join("\r\n");
}
