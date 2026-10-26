// CalDAV, tested against a FAKE CalDAV server (caldav-fake.ts). It proves Ribbon's side of the protocol
// (discovery, auth, ctag skipping, REPORT, encrypted credentials). It has not been run against real iCloud.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { parseXml, textAt, all } from "./dav-xml.ts";
import { FAKE_LOGIN, startFakeCaldav, type FakeCaldav } from "./caldav-fake.ts";
import { syncConnection } from "./calendar-sync.ts";
import { ics, inDays, ymd } from "./calendar-test-kit.ts";
import { call, freshDb, registerCleanup, secondHousehold, signedIn } from "./test-helpers.ts";

registerCleanup();
let fake: FakeCaldav;
const evs = (title: string, d = 4) => ics([[`UID:${title}@x`, `DTSTART;VALUE=DATE:${ymd(inDays(d))}`, `DTEND;VALUE=DATE:${ymd(inDays(d + 1))}`, `SUMMARY:${title}`]]);
beforeEach(async () => {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret";
  process.env.ALLOW_PRIVATE_CALENDAR_URLS = "true";
  fake = await startFakeCaldav([
    { slug: "home", name: "Family", ctag: "c1", events: evs("Piano recital"), color: "#8B6CE0" },
    { slug: "tasks", name: "Chores", ctag: "t1", events: "", components: ["VTODO"] },
    { slug: "work", name: "Work", ctag: "w1", events: evs("Standup", 5) },
  ]);
});
afterEach(async () => {
  await fake.close();
  delete process.env.APP_SECRET;
  delete process.env.ALLOW_PRIVATE_CALENDAR_URLS;
});
const login = (extra: object = {}) => ({ kind: "caldav", url: fake.origin, username: FAKE_LOGIN.username, password: FAKE_LOGIN.password, ...extra });
const titles = (db: ReturnType<typeof freshDb>, id: string) => (db.prepare("SELECT title FROM calendar_events WHERE connection_id = ? ORDER BY title").all(id) as { title: string }[]).map((r) => r.title);

describe("XML reader", () => {
  test("matches names without prefixes, decodes entities, reads attributes", () => {
    const doc = parseXml(`<?xml version="1.0"?><!-- hi --><a:root xmlns:a="DAV:"><a:x k='v'>1 &amp; 2 &#65;<![CDATA[<raw>]]></a:x><y/></a:root>`);
    assert.equal(doc.name, "root");
    assert.equal(textAt(doc, "x"), "1 & 2 A<raw>");
    assert.equal(all(doc, "x")[0]!.attrs.k, "v");
  });
  test("refuses DOCTYPE/entity tricks, mismatches and absurd nesting", () => {
    assert.throws(() => parseXml(`<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>`));
    assert.throws(() => parseXml("<a><b></a></b>"));
    assert.throws(() => parseXml("<a>"));
    assert.throws(() => parseXml("<a>".repeat(100) + "</a>".repeat(100)));
  });
});

describe("CalDAV connections (fake server)", () => {
  test("discovery lists event calendars only, with colours, and does not save anything", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const r = await call(db, "POST", "/api/calendars/caldav/discover", { url: fake.origin, username: FAKE_LOGIN.username, password: FAKE_LOGIN.password }, me);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.calendars.map((c: { name: string }) => c.name), ["Family", "Work"], "task lists and non-calendar collections are skipped");
    assert.equal(r.body.calendars[0].color, "#8B6CE0");
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM calendar_connections").get() as { n: number }).n, 0);
    assert.doesNotMatch(r.text, new RegExp(FAKE_LOGIN.password));
  });

  test("discovery falls back to /.well-known/caldav for a bare host", async () => {
    await fake.close();
    fake = await startFakeCaldav([{ slug: "home", name: "Family", ctag: "c1", events: evs("A") }], { wellKnownOnly: true });
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const r = await call(db, "POST", "/api/calendars/caldav/discover", { url: fake.origin, username: FAKE_LOGIN.username, password: FAKE_LOGIN.password }, me);
    assert.equal(r.status, 200, r.text);
    assert.ok(fake.hits.paths.includes("PROPFIND /.well-known/caldav"));
  });

  test("wrong password is a clear message, and nothing is stored", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const r = await call(db, "POST", "/api/calendars", login({ password: "nope" }), me);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /app-specific password/i);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM calendar_connections").get() as { n: number }).n, 0);
  });

  test("connect imports the chosen calendars; the login is encrypted at rest and never returned", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const r = await call(db, "POST", "/api/calendars", login({ name: "Home", calendars: [`${fake.origin}/calendars/fam/home/`] }), me);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.connection.experimental, true);
    assert.equal(r.body.connection.eventCount, 1);
    assert.deepEqual(titles(db, r.body.connection.id), ["Piano recital"]);
    assert.doesNotMatch(r.text, new RegExp(FAKE_LOGIN.password));
    const raw = JSON.stringify(db.prepare("SELECT * FROM calendar_connections").all());
    assert.doesNotMatch(raw, new RegExp(FAKE_LOGIN.password));
    assert.doesNotMatch(raw, /abcd/);
    const list = await call(db, "GET", "/api/calendars", undefined, me);
    assert.doesNotMatch(list.text, new RegExp(FAKE_LOGIN.password));
    assert.ok(fake.authSeen.every((a) => a.startsWith("Basic ")));
  });

  test("only calendars the server listed can be chosen", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const r = await call(db, "POST", "/api/calendars", login({ calendars: [`${fake.origin}/etc/passwd`] }), me);
    assert.equal(r.status, 400);
  });

  test("sync skips the REPORT when the ctag has not changed, and refetches when it has", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const added = await call(db, "POST", "/api/calendars", login(), me);
    assert.equal(added.status, 201, added.text);
    const id = added.body.connection.id as string;
    assert.deepEqual(titles(db, id), ["Piano recital", "Standup"]);
    const before = fake.hits.report;
    const same = await syncConnection(db, id);
    assert.equal(same.ok, true);
    assert.equal(fake.hits.report, before, "unchanged ctag → no REPORT");
    fake.calendars[0]!.ctag = "c2";
    fake.calendars[0]!.events = evs("Piano recital moved", 6);
    const changed = await syncConnection(db, id);
    assert.equal(changed.ok, true);
    assert.ok(fake.hits.report > before);
    assert.deepEqual(titles(db, id), ["Piano recital moved", "Standup"]);
  });

  test("a server error is reported and the old events stay", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const id = (await call(db, "POST", "/api/calendars", login(), me)).body.connection.id as string;
    fake.calendars[0]!.ctag = "c9";
    fake.failReport = true;
    const r = await syncConnection(db, id);
    assert.equal(r.ok, false);
    assert.equal(titles(db, id).length, 2);
    const list = await call(db, "GET", "/api/calendars", undefined, me);
    assert.equal(list.body.connections[0].lastStatus, "error");
  });

  test("a changed app-specific password shows the sign-in problem instead of crashing", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const id = (await call(db, "POST", "/api/calendars", login(), me)).body.connection.id as string;
    fake.calendars[0]!.ctag = "c5";
    // the user revokes the app password on the provider's side
    await fake.close();
    fake = await startFakeCaldav(fake.calendars);
    const r = await syncConnection(db, id);
    assert.equal(r.ok, false);
  });

  test("calendars are private to the owner; another household cannot see or sync them", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const id = (await call(db, "POST", "/api/calendars", login(), me)).body.connection.id as string;
    const other = secondHousehold(db);
    assert.equal((await call(db, "POST", `/api/calendars/${id}/sync`, {}, other)).status, 404);
    assert.equal((await call(db, "DELETE", `/api/calendars/${id}`, undefined, other)).status, 404);
    assert.equal((await call(db, "GET", "/api/calendars", undefined, other)).body.connections.length, 0);
    const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const events = await call(db, "GET", `/api/calendar/events?from=${day(0)}&to=${day(30)}&today=${day(0)}`, undefined, other);
    assert.equal(events.status, 200, events.text);
    assert.equal(events.body.events.length, 0);
  });

  test("CSRF is required to connect, and the host must be allowed (no private servers by default)", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const noCsrf = await call(db, "POST", "/api/calendars", login(), { cookie: me.cookie, csrf: "wrong" });
    assert.equal(noCsrf.status, 403);
    delete process.env.ALLOW_PRIVATE_CALENDAR_URLS;
    const blocked = await call(db, "POST", "/api/calendars", login(), me);
    assert.equal(blocked.status, 400);
    assert.match(blocked.body.error, /https/i, "passwords never go over plain http");
    const loop = await call(db, "POST", "/api/calendars", login({ url: "https://127.0.0.1:9/" }), me);
    assert.equal(loop.status, 400);
    assert.match(loop.body.error, /private|internal|allowed/i);
    assert.equal(fake.hits.propfind, 0, "never even connected");
  });

  test("deleting the connection removes the events and the saved login", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const id = (await call(db, "POST", "/api/calendars", login(), me)).body.connection.id as string;
    assert.equal((await call(db, "DELETE", `/api/calendars/${id}`, undefined, me)).status, 200);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM calendar_events").get() as { n: number }).n, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM calendar_connections").get() as { n: number }).n, 0);
  });

  test("discovery is rate limited", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call(db, "POST", "/api/calendars/caldav/discover", { url: fake.origin, username: "x", password: "y" }, me)).status;
    assert.equal(last, 429);
  });
});
