import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { feedServer, ics, inDays, iso, ymd } from "./calendar-test-kit.ts";
import { dueConnections, runDue, syncConnection } from "./calendar-sync.ts";
import { handleApi } from "./api.ts";
import { call, freshDb, registerCleanup, secondHousehold, signedIn } from "./test-helpers.ts";

registerCleanup();
beforeEach(() => {
  process.env.ALLOW_PRIVATE_CALENDAR_URLS = "true"; // the test feeds live on 127.0.0.1
  process.env.APP_SECRET = "test-secret-test-secret-test-secret";
});
afterEach(() => {
  delete process.env.ALLOW_PRIVATE_CALENDAR_URLS;
  delete process.env.APP_SECRET;
  delete process.env.CALENDAR_MAX_CONNECTIONS;
});

const today = () => iso(new Date());
const range = (days = 30) => `from=${today()}&to=${iso(inDays(days))}&today=${today()}`;
const feed = (...titles: string[]) => ics(titles.map((t, i) => [`UID:e${i}-${t.length}`, `DTSTART;VALUE=DATE:${ymd(inDays(2 + i))}`, `SUMMARY:${t}`]));
type Ev = { id: string; source: string; title: string; connectionName?: string; tone: string };
const titles = async (db: ReturnType<typeof freshDb>, auth: ReturnType<typeof signedIn>, source = "external", days = 30) =>
  ((await call(db, "GET", `/api/calendar/events?${range(days)}`, undefined, auth)).body.events as Ev[]).filter((e) => e.source === source).map((e) => e.title);

describe("outbound reminder feed", () => {
  test("never re-exports imported events (only Ribbon's own reminders)", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const f = await feedServer(feed("Secret dentist visit"));
    assert.equal((await call(db, "POST", "/api/calendars", { kind: "ics_url", url: f.url }, me)).status, 201);
    const token = (await call(db, "POST", "/api/calendar/token", {}, me)).body.token as string;
    const out = await call(db, "GET", `/api/calendar/${token}.ics`);
    assert.equal(out.status, 200);
    assert.ok(!JSON.stringify(out).includes("Secret dentist visit"));
    const raw = await handleApiText(db, token);
    assert.ok(!raw.includes("Secret dentist visit"), "the .ics feed has no imported events");
    assert.match(raw, /BEGIN:VCALENDAR/);
  });
});

describe("ICS link connections", () => {
  test("with no name given, the calendar's own name is used", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const named = await feedServer(ics([["UID:n1@x", `DTSTART;VALUE=DATE:${ymd(inDays(3))}`, `DTEND;VALUE=DATE:${ymd(inDays(4))}`, "SUMMARY:Thing"]], ["X-WR-CALNAME:Rivers family"]));
    const added = await call(db, "POST", "/api/calendars", { kind: "ics_url", url: named.url }, me);
    assert.equal(added.status, 201, added.text);
    assert.equal(added.body.connection.name, "Rivers family");
    const other = await feedServer(ics([["UID:n2@x", `DTSTART;VALUE=DATE:${ymd(inDays(3))}`, `DTEND;VALUE=DATE:${ymd(inDays(4))}`, "SUMMARY:Thing"]], ["X-WR-CALNAME:Ignored"]));
    assert.equal((await call(db, "POST", "/api/calendars", { kind: "ics_url", url: other.url, name: "Mine" }, me)).body.connection.name, "Mine", "a name the person typed wins");
  });

  test("add, import, refresh with ETag, and never reveal the address", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const f = await feedServer(feed("Soccer", "Dentist"));
    const added = await call(db, "POST", "/api/calendars", { kind: "ics_url", url: f.url, name: "Family", color: "pink" }, me);
    assert.equal(added.status, 201, added.text);
    const conn = added.body.connection;
    assert.equal(conn.name, "Family");
    assert.equal(conn.color, "pink");
    assert.equal(conn.lastStatus, "ok");
    assert.equal(conn.eventCount, 2);
    assert.equal(conn.host, "127.0.0.1");
    assert.equal(JSON.stringify(added.body).includes("/cal.ics"), false, "the secret address is never sent back");
    assert.deepEqual((await titles(db, me)).sort(), ["Dentist", "Soccer"]);

    // stored encrypted, not in clear
    const row = db.prepare("SELECT source_enc, state FROM calendar_connections WHERE id = ?").get(conn.id) as { source_enc: string; state: string };
    assert.ok(row.source_enc.startsWith("v1."));
    assert.ok(!row.source_enc.includes("127.0.0.1") && !row.state.includes("/cal.ics"));

    // second refresh: conditional request answered 304, events kept
    const before = f.state.hits;
    const again = await syncConnection(db, conn.id);
    assert.equal(again.ok, true);
    assert.equal(f.state.hits, before + 1);
    assert.equal(f.state.conditional, 1);
    assert.equal((await titles(db, me)).length, 2);

    // changed feed: new ETag, events replaced
    f.state.body = feed("Soccer", "Dentist", "Recital");
    f.state.etag = '"v2"';
    assert.equal((await syncConnection(db, conn.id)).ok, true);
    assert.equal((await titles(db, me)).length, 3);
    f.state.body = feed("Recital");
    f.state.etag = '"v3"';
    await syncConnection(db, conn.id);
    assert.deepEqual(await titles(db, me), ["Recital"]);
  });

  test("a bad link is refused up front and nothing is kept", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery" });
    const html = await feedServer("<html>sign in</html>", null);
    const notIcs = await call(db, "POST", "/api/calendars", { kind: "ics_url", url: html.url }, me);
    assert.equal(notIcs.status, 400);
    assert.match(notIcs.body.error, /did not return a calendar/);
    const gone = await feedServer("", null);
    gone.state.status = 404;
    assert.match((await call(db, "POST", "/api/calendars", { kind: "ics_url", url: gone.url }, me)).body.error, /not found \(404\)/);
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "ftp://x/y.ics", "https://u:p@example.com/a.ics", "", 5]) {
      assert.equal((await call(db, "POST", "/api/calendars", { kind: "ics_url", url }, me)).status, 400, String(url));
    }
    assert.equal((await call(db, "POST", "/api/calendars", { kind: "wat" }, me)).status, 400);
    assert.equal((await call(db, "GET", "/api/calendars", undefined, me)).body.connections.length, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM calendar_events").get() as { n: number }).n, 0);
  });

  test("private and internal addresses are refused unless ALLOW_PRIVATE_CALENDAR_URLS is on", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery" });
    const f = await feedServer(feed("Secret"));
    delete process.env.ALLOW_PRIVATE_CALENDAR_URLS;
    for (const url of [f.url, "http://localhost/a.ics", "http://169.254.169.254/latest/meta-data/", "http://[::1]/a.ics", "webcal://192.168.1.10/cal.ics", "http://0.0.0.0:1/", "http://10.0.0.1/a.ics"]) {
      const res = await call(db, "POST", "/api/calendars", { kind: "ics_url", url }, me);
      assert.equal(res.status, 400, url);
      assert.match(res.body.error, /private or internal/, url);
    }
    assert.equal(f.state.hits, 0, "the private server was never contacted");
    process.env.ALLOW_PRIVATE_CALENDAR_URLS = "true";
    assert.equal((await call(db, "POST", "/api/calendars", { kind: "ics_url", url: f.url }, me)).status, 201);
  });

  test("webcal:// links are fetched over https (and fail cleanly when nothing answers)", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery" });
    const res = await call(db, "POST", "/api/calendars", { kind: "ics_url", url: "webcal://127.0.0.1:1/cal.ics" }, me);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /refused the connection|HTTPS|reset|connect/i);
  });

  test("a feed that starts failing shows the error, keeps old events, and retries with back-off", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery" });
    const f = await feedServer(feed("Soccer"));
    const id = (await call(db, "POST", "/api/calendars", { kind: "ics_url", url: f.url }, me)).body.connection.id as string;
    f.state.status = 403;
    f.state.etag = null;
    db.prepare("UPDATE calendar_connections SET last_attempt_at = ? WHERE id = ?").run(new Date(Date.now() - 60_000).toISOString(), id);
    const res = await call(db, "POST", `/api/calendars/${id}/sync`, {}, me);
    assert.equal(res.status, 502);
    assert.match(res.body.error, /refused access \(403\)/);
    assert.equal(res.body.connection.lastStatus, "error");
    assert.equal(res.body.connection.eventCount, 1, "events from the last good sync stay");
    assert.deepEqual(await titles(db, me), ["Soccer"]);
    // due again after 15 minutes (not after the full six hours) while it is failing
    const failedAt = Date.parse((db.prepare("SELECT last_attempt_at AS t FROM calendar_connections WHERE id = ?").get(id) as { t: string }).t);
    assert.equal(dueConnections(db, failedAt + 10 * 60_000).includes(id), false);
    assert.equal(dueConnections(db, failedAt + 16 * 60_000).includes(id), true);
  });

  test("the background refresh only touches calendars that are due, enabled and not one-off files", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery" });
    const f = await feedServer(feed("Soccer"), null);
    const id = (await call(db, "POST", "/api/calendars", { kind: "ics_url", url: f.url, syncHours: 2 }, me)).body.connection.id as string;
    const file = (await call(db, "POST", "/api/calendars/upload", { name: "One-off", text: feed("Once") }, me)).body.connection.id as string;
    const t0 = Date.now();
    assert.deepEqual(dueConnections(db, t0 + 60 * 60_000), []);
    assert.deepEqual(dueConnections(db, t0 + 2 * 3600_000 + 5000), [id]);
    assert.ok(!dueConnections(db, t0 + 999 * 3600_000).includes(file));
    f.state.body = feed("Soccer", "New one");
    const hits = f.state.hits;
    assert.equal(await runDue(db, t0 + 3 * 3600_000), 1);
    assert.equal(f.state.hits, hits + 1);
    assert.equal((await titles(db, me)).length, 3, "Soccer and New one, plus the uploaded Once");
    await call(db, "PATCH", `/api/calendars/${id}`, { enabled: false }, me);
    assert.deepEqual(dueConnections(db, t0 + 999 * 3600_000), []);
  });
});

describe("ICS file upload", () => {
  test("imports once, labels it, validates the file", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery" });
    const res = await call(db, "POST", "/api/calendars/upload", { name: "School", text: feed("Concert", "Picture day"), color: "red" }, me);
    assert.equal(res.status, 201);
    assert.equal(res.body.connection.kind, "ics_file");
    assert.equal(res.body.connection.syncs, false);
    assert.equal(res.body.connection.eventCount, 2);
    assert.deepEqual((await titles(db, me)).sort(), ["Concert", "Picture day"]);
    assert.equal((await call(db, "POST", `/api/calendars/${res.body.connection.id}/sync`, {}, me)).status, 400, "a file can't refresh");
    assert.equal((await call(db, "POST", "/api/calendars/upload", { text: "hello" }, me)).status, 400);
    assert.equal((await call(db, "POST", "/api/calendars/upload", { text: ics([["UID:old", "DTSTART;VALUE=DATE:19990101", "SUMMARY:Ancient"]]) }, me)).status, 400);
    assert.equal((await call(db, "POST", "/api/calendars/upload", {}, me)).status, 400);
  });
});

describe("managing a connection", () => {
  test("rename, recolour, toggle, share, delete (which removes the events)", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const f = await feedServer(feed("Soccer"));
    const id = (await call(db, "POST", "/api/calendars", { kind: "ics_url", url: f.url }, me)).body.connection.id as string;
    const patch = (b: object) => call(db, "PATCH", `/api/calendars/${id}`, b, me);
    assert.equal((await patch({ name: "  Kids  <b>sport</b> ", color: "green" })).body.connection.color, "green");
    assert.equal((await patch({ color: "url(javascript:x)" })).status, 400);
    assert.equal((await patch({ syncHours: 0 })).status, 400);
    assert.equal((await patch({ syncHours: 500 })).status, 400);
    assert.equal((await patch({ syncHours: 12 })).body.connection.syncHours, 12);
    assert.equal((await patch({ enabled: false })).body.connection.enabled, false);
    assert.deepEqual(await titles(db, me), [], "switched off: no events shown");
    await patch({ enabled: true });
    assert.equal((await titles(db, me)).length, 1);
    assert.equal((await call(db, "DELETE", `/api/calendars/${id}`, undefined, me)).status, 200);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM calendar_events").get() as { n: number }).n, 0);
    assert.equal((await call(db, "GET", "/api/calendars", undefined, me)).body.connections.length, 0);
  });

  test("Sync now is rate limited", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery" });
    const f = await feedServer(feed("Soccer"));
    const id = (await call(db, "POST", "/api/calendars", { kind: "ics_url", url: f.url }, me)).body.connection.id as string;
    const first = await call(db, "POST", `/api/calendars/${id}/sync`, {}, me);
    assert.equal(first.status, 429, "right after adding: too soon");
    assert.ok(first.headers.get("retry-after"));
    for (let i = 0; i < 14; i += 1) {
      db.prepare("UPDATE calendar_connections SET last_attempt_at = ? WHERE id = ?").run(new Date(Date.now() - 60_000).toISOString(), id);
      await call(db, "POST", `/api/calendars/${id}/sync`, {}, me);
    }
    db.prepare("UPDATE calendar_connections SET last_attempt_at = ? WHERE id = ?").run(new Date(Date.now() - 60_000).toISOString(), id);
    const limited = await call(db, "POST", `/api/calendars/${id}/sync`, {}, me);
    assert.equal(limited.status, 429);
    assert.match(limited.body.error, /lot of refreshing/);
  });

  test("a login can only have a limited number of connections", async () => {
    process.env.CALENDAR_MAX_CONNECTIONS = "2";
    const db = freshDb();
    const me = signedIn(db, { username: "avery" });
    for (let i = 0; i < 2; i += 1) assert.equal((await call(db, "POST", "/api/calendars/upload", { text: feed(`E${i}`) }, me)).status, 201);
    const third = await call(db, "POST", "/api/calendars/upload", { text: feed("E3") }, me);
    assert.equal(third.status, 409);
    assert.match(third.body.error, /up to 2/);
  });

  test("adding connections is rate limited", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery" });
    process.env.CALENDAR_MAX_CONNECTIONS = "100";
    let last = 0;
    for (let i = 0; i < 12; i += 1) last = (await call(db, "POST", "/api/calendars", { kind: "ics_url", url: "nonsense" }, me)).status;
    assert.equal(last, 429);
  });
});

describe("authorization and household isolation", () => {
  test("every endpoint needs a session and writes need the CSRF token", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery" });
    for (const [method, path] of [["GET", "/api/calendars"], ["POST", "/api/calendars"], ["POST", "/api/calendars/upload"], ["GET", "/api/calendars/review"], ["POST", "/api/calendars/review"], ["PATCH", "/api/calendars/x"], ["DELETE", "/api/calendars/x"], ["POST", "/api/calendars/x/sync"], ["GET", `/api/calendar/events?${range()}`], ["GET", `/api/calendar/summary?today=${today()}`], ["POST", "/api/calendar/manual"]] as const) {
      assert.equal((await call(db, method, path, method === "GET" ? undefined : {}, null)).status, 401, `${method} ${path}`);
    }
    const noCsrf = { cookie: me.cookie, csrf: "wrong" };
    for (const [method, path] of [["POST", "/api/calendars"], ["POST", "/api/calendars/upload"], ["POST", "/api/calendars/review"], ["POST", "/api/calendar/manual"], ["PATCH", "/api/calendars/x"], ["DELETE", "/api/calendars/x"]] as const) {
      assert.equal((await call(db, method, path, {}, noCsrf)).status, 403, `${method} ${path}`);
    }
  });

  test("other logins and other households cannot see, change, sync or delete your connection", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const sibling = signedIn(db, { username: "noah", role: "member", personId: "p-noah" });
    const other = secondHousehold(db);
    const f = await feedServer(feed("Private appointment"));
    const id = (await call(db, "POST", "/api/calendars", { kind: "ics_url", url: f.url }, me)).body.connection.id as string;
    for (const who of [sibling, other]) {
      assert.equal((await call(db, "GET", "/api/calendars", undefined, who)).body.connections.length, 0);
      assert.deepEqual(await titles(db, who), [], "private events stay private");
      assert.equal((await call(db, "PATCH", `/api/calendars/${id}`, { name: "mine now", shared: true }, who)).status, 404);
      assert.equal((await call(db, "DELETE", `/api/calendars/${id}`, undefined, who)).status, 404);
      assert.equal((await call(db, "POST", `/api/calendars/${id}/sync`, {}, who)).status, 404);
    }
    assert.equal((db.prepare("SELECT name FROM calendar_connections WHERE id = ?").get(id) as { name: string }).name, "Calendar");
    // owners of the same household don't get a back door either
    const owner2 = signedIn(db, { username: "jordan", role: "owner", personId: "p-jordan" });
    assert.equal((await call(db, "DELETE", `/api/calendars/${id}`, undefined, owner2)).status, 404);
    assert.deepEqual(await titles(db, owner2), []);
  });

  test("sharing with the household shows events to that household only, read-only", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const sibling = signedIn(db, { username: "noah", role: "member", personId: "p-noah" });
    const other = secondHousehold(db);
    const f = await feedServer(feed("School concert"));
    const id = (await call(db, "POST", "/api/calendars", { kind: "ics_url", url: f.url, name: "School", shared: true }, me)).body.connection.id as string;
    assert.deepEqual(await titles(db, sibling), ["School concert"]);
    const ev = ((await call(db, "GET", `/api/calendar/events?${range()}`, undefined, sibling)).body.events as { source: string; sharedBy?: string; connectionName?: string }[]).find((e) => e.source === "external")!;
    assert.equal(ev.sharedBy, "avery");
    assert.equal(ev.connectionName, "School");
    assert.deepEqual(await titles(db, other), [], "another household never sees it");
    const listing = (await call(db, "GET", "/api/calendars", undefined, sibling)).body;
    assert.deepEqual(listing.connections, []);
    assert.equal(listing.sharedWithMe.length, 1);
    assert.equal(JSON.stringify(listing).includes("127.0.0.1"), false);
    assert.equal((await call(db, "DELETE", `/api/calendars/${id}`, undefined, sibling)).status, 404);
    await call(db, "PATCH", `/api/calendars/${id}`, { shared: false }, me);
    assert.deepEqual(await titles(db, sibling), []);
  });

  test("deleting a login deletes its connections and events", async () => {
    const db = freshDb();
    const owner = signedIn(db, { username: "avery", personId: "p-avery" });
    const member = signedIn(db, { username: "noah", role: "member", personId: "p-noah" });
    await call(db, "POST", "/api/calendars/upload", { text: feed("Mine") }, member);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM calendar_events").get() as { n: number }).n, 1);
    assert.equal((await call(db, "DELETE", `/api/users/${member.id}`, undefined, owner)).status, 200);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM calendar_connections").get() as { n: number }).n, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM calendar_events").get() as { n: number }).n, 0);
  });
});

describe("birthday review", () => {
  const birthdayFeed = ics(
    [
      ["UID:b-sam", "DTSTART;VALUE=DATE:19900504", "RRULE:FREQ=YEARLY", "SUMMARY:Priya's birthday"],
      ["UID:b-new", "DTSTART;VALUE=DATE:20000622", "RRULE:FREQ=YEARLY", "SUMMARY:Newcomer Nia's birthday"],
      ["UID:b-skip", "DTSTART;VALUE=DATE:20010101", "RRULE:FREQ=YEARLY", "SUMMARY:Work Friend birthday"],
      ["UID:a-1", "DTSTART;VALUE=DATE:20100614", "RRULE:FREQ=YEARLY", "SUMMARY:Jordan's anniversary"],
    ],
    ["X-WR-CALNAME:Birthdays"],
  );

  test("lists suggestions with likely matches; nothing is created automatically", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const people = (await call(db, "GET", "/api/people", undefined, me)).body.people.length;
    await call(db, "POST", "/api/calendars/upload", { name: "Birthdays", text: birthdayFeed }, me);
    const review = (await call(db, "GET", "/api/calendars/review", undefined, me)).body;
    assert.equal(review.items.length, 4);
    const priya = review.items.find((i: { name: string }) => i.name === "Priya");
    assert.equal(priya.kind, "birthday");
    assert.equal(priya.date, "1990-05-04");
    assert.deepEqual(priya.matches.map((m: { name: string }) => m.name), ["Priya Shah"]);
    assert.equal((await call(db, "GET", "/api/people", undefined, me)).body.people.length, people, "no one was added by importing");
    assert.equal((await call(db, "GET", "/api/calendars", undefined, me)).body.pendingReviews, 4);
  });

  test("match sets the person's date (asking before replacing one), create adds a person, ignore keeps the event as an event", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const up = await call(db, "POST", "/api/calendars/upload", { name: "Birthdays", text: birthdayFeed }, me);
    const connectionId = up.body.connection.id as string;
    const decide = (uid: string, body: object) => call(db, "POST", "/api/calendars/review", { connectionId, uid, ...body }, me);

    const now = new Date();
    const may = `${now.getMonth() > 4 || (now.getMonth() === 4 && now.getDate() > 4) ? now.getFullYear() + 1 : now.getFullYear()}-05-04`;
    const on = async () => ((await call(db, "GET", `/api/calendar/events?from=${may}&to=${may}&today=${today()}`, undefined, me)).body.events as Ev[]).map((e) => `${e.source}:${e.title}`);
    assert.ok((await on()).includes("external:Priya's birthday"), "before matching it is an imported event");
    const match = await decide("b-sam", { action: "match", personId: "p-priya" });
    assert.equal(match.status, 200, match.text);
    assert.equal(match.body.person.birthday, "1990-05-04");
    const after = await on();
    assert.ok(!after.includes("external:Priya's birthday"), "the matched event is hidden…");
    assert.ok(after.includes("birthday:Priya’s birthday"), "…because the person's own birthday now shows");

    // Jordan already has an anniversary: confirm before replacing
    const clash = await decide("a-1", { action: "match", personId: "p-jordan" });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.code, "exists");
    assert.equal((await decide("a-1", { action: "match", personId: "p-jordan", overwrite: true })).status, 200);

    const created = await decide("b-new", { action: "create", name: "Nia Newcomer", relationship: "friend" });
    assert.equal(created.status, 201);
    assert.equal(created.body.person.circle, "outside");
    assert.equal(created.body.person.birthday, "2000-06-22");
    assert.equal(created.body.person.relationship, "friend");
    assert.equal((await decide("b-new", { action: "create", name: "again" })).status, 404, "decided once");
    assert.ok(!(await titles(db, me, "external", 100)).includes("Nia Newcomer birthday"), "a created person's imported event is hidden too (no duplicate)");

    assert.equal((await decide("b-skip", { action: "ignore" })).status, 200);
    assert.ok((await titles(db, me, "external", 100)).includes("Work Friend birthday"), "ignored suggestions stay on the calendar as events");
    assert.equal((await call(db, "GET", "/api/calendars/review", undefined, me)).body.items.length, 0);
  });

  test("validation and isolation", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const other = secondHousehold(db);
    const up = await call(db, "POST", "/api/calendars/upload", { text: birthdayFeed }, me);
    const connectionId = up.body.connection.id as string;
    const body = (extra: object) => ({ connectionId, uid: "b-sam", ...extra });
    assert.equal((await call(db, "POST", "/api/calendars/review", body({ action: "explode" }), me)).status, 400);
    assert.equal((await call(db, "POST", "/api/calendars/review", body({ action: "match", personId: "nobody" }), me)).status, 404);
    assert.equal((await call(db, "POST", "/api/calendars/review", body({ action: "match", personId: "p-priya", date: "13-45" }), me)).status, 400);
    // a person from another household can't be targeted, and another login can't decide for you
    const theirPerson = (db.prepare("SELECT id FROM people WHERE household_id = ? LIMIT 1").get(other.hid) as { id: string }).id;
    assert.equal((await call(db, "POST", "/api/calendars/review", body({ action: "match", personId: theirPerson }), me)).status, 404);
    assert.equal((await call(db, "POST", "/api/calendars/review", body({ action: "ignore" }), other)).status, 404);
    assert.equal((await call(db, "GET", "/api/calendars/review", undefined, other)).body.items.length, 0);
    // a malicious name is stored as plain text and trimmed
    const made = await call(db, "POST", "/api/calendars/review", { connectionId, uid: "b-new", action: "create", name: "<img src=x onerror=1>\u0000Eve" }, me);
    assert.equal(made.status, 201);
    assert.equal(made.body.person.name, "<img src=x onerror=1>Eve");
  });
});

async function handleApiText(db: Parameters<typeof handleApi>[1], token: string): Promise<string> {
  const res = await handleApi(new Request(`http://localhost:8080/api/calendar/${token}.ics`), db);
  return res.text();
}
