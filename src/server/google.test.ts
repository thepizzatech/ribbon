// Google Calendar OAuth, tested against a FAKE Google (google-fake.ts). It proves Ribbon's side of the
// protocol (PKCE, state, scopes, token storage, refresh, revoke). It has not been run against real Google.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { dueConnections, syncConnection } from "./calendar-sync.ts";
import { FAKE_CLIENT, startFakeGoogle, type FakeGoogle } from "./google-fake.ts";
import { setGoogleEndpoints, CALENDAR_SCOPE, CONTACTS_SCOPE } from "./google.ts";
import { call, freshDb, registerCleanup, secondHousehold, signedIn } from "./test-helpers.ts";
import { iso, inDays } from "./calendar-test-kit.ts";
import type { Db } from "./db.ts";

registerCleanup();
let fake: FakeGoogle;
beforeEach(async () => {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret";
  process.env.GOOGLE_CLIENT_ID = FAKE_CLIENT.clientId;
  process.env.GOOGLE_CLIENT_SECRET = FAKE_CLIENT.clientSecret;
  fake = await startFakeGoogle();
  setGoogleEndpoints(fake.endpoints);
});
afterEach(async () => {
  setGoogleEndpoints(null);
  await fake.close();
  for (const k of ["APP_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) delete process.env[k];
});

const count = (db: Db, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const day = (n: number) => iso(inDays(n));
const dayAfter = (n: number) => iso(inDays(n + 1));
function seedEvents() {
  fake.events["me@example.com"] = [
    { id: "e1", summary: "Dentist", start: { dateTime: `${day(2)}T15:00:00Z` }, end: { dateTime: `${day(2)}T16:00:00Z` }, location: "Main St" },
    { id: "e2", summary: "Cancelled", status: "cancelled", start: { date: day(3) }, end: { date: dayAfter(3) } },
    { id: "e3", summary: "Declined", start: { date: day(3) }, end: { date: dayAfter(3) }, attendees: [{ self: true, responseStatus: "declined" }] },
    { id: "e4", summary: "<img src=x onerror=alert(1)>\u0000", start: { date: day(4) }, end: { date: dayAfter(4) } },
    { id: "e5", summary: "Sam's birthday", start: { date: day(5) }, end: { date: dayAfter(5) } },
  ];
  fake.events["family@group.calendar.google.com"] = [{ id: "f1", summary: "Soccer", start: { dateTime: `${day(6)}T10:00:00-05:00` }, end: { dateTime: `${day(6)}T11:00:00-05:00` } }];
}

async function connect(db: Db, who: ReturnType<typeof signedIn>, body: object = {}, options: { scopes?: string[]; omitRefresh?: boolean } = {}) {
  const start = await call(db, "POST", "/api/calendars/google/start", body, who);
  assert.equal(start.status, 200, start.text);
  const setCookie = start.headers.get("set-cookie") ?? "";
  const { code, state } = fake.approve(start.body.url, options);
  const cookie = `${who.cookie}; ${setCookie.split(";")[0]}`;
  const cb = await call(db, "GET", `/api/calendars/google/callback?code=${code}&state=${state}`, undefined, null, { cookie });
  return { start, cb, code, state, cookie, location: cb.headers.get("location") ?? "" };
}

describe("Google Calendar sign-in (fake Google)", () => {
  test("is only offered when the server has a client id and secret", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    assert.equal((await call(db, "GET", "/api/calendars", undefined, me)).body.providers.google, true);
    delete process.env.GOOGLE_CLIENT_SECRET;
    assert.equal((await call(db, "GET", "/api/calendars", undefined, me)).body.providers.google, false);
    assert.equal((await call(db, "POST", "/api/calendars/google/start", {}, me)).status, 404);
  });

  test("full flow: PKCE + state, read-only scope, tokens stored encrypted, events imported", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    seedEvents();
    const { start, location } = await connect(db, me, { name: "My Google", color: "green" });
    const url = new URL(start.body.url);
    assert.equal(url.searchParams.get("scope"), CALENDAR_SCOPE, "only the read-only calendar scope");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.match(url.searchParams.get("redirect_uri") ?? "", /\/api\/calendars\/google\/callback$/);
    assert.match(start.headers.get("set-cookie") ?? "", /ribbon_gcal=.*HttpOnly.*SameSite=Lax/);
    assert.match(location, /^\/settings\?tab=calendars&google=connected/);

    const list = (await call(db, "GET", "/api/calendars", undefined, me)).body;
    assert.equal(list.connections.length, 1);
    const conn = list.connections[0];
    assert.equal(conn.kind, "google");
    assert.equal(conn.name, "My Google");
    assert.equal(conn.color, "green");
    assert.equal(conn.lastStatus, "ok");
    assert.equal(conn.account, "me@example.com");
    assert.deepEqual(conn.calendars.sort(), ["Family", "Me"]);
    assert.equal(conn.eventCount, 4, "cancelled and declined events are left out; paging works");
    assert.ok(!/at-|rt-|token/i.test(JSON.stringify(list)), "no token ever reaches the browser");

    const row = db.prepare("SELECT source_enc, state FROM calendar_connections").get() as { source_enc: string; state: string };
    assert.ok(row.source_enc.startsWith("v1.") && !/at-|rt-/.test(row.source_enc + row.state), "tokens are encrypted at rest");
    assert.equal(fake.log.find((l) => l.path === "GET /calendar/v3/users/me/calendarList")!.auth?.startsWith("Bearer at-"), true);

    const evs = ((await call(db, "GET", `/api/calendar/events?from=${day(0)}&to=${day(10)}&today=${day(0)}`, undefined, me)).body.events as { source: string; title: string; start: string; allDay: boolean }[]).filter((e) => e.source === "external");
    assert.deepEqual(evs.map((e) => e.title).sort(), ["<img src=x onerror=alert(1)>", "Dentist", "Sam's birthday", "Soccer"], "titles are plain text with control characters removed");
    assert.equal(evs.find((e) => e.title === "Dentist")!.start, `${day(2)}T15:00:00.000Z`);
    assert.equal(evs.find((e) => e.title === "Soccer")!.start, `${day(6)}T15:00:00.000Z`, "offsets are converted to UTC");
    const review = (await call(db, "GET", "/api/calendars/review", undefined, me)).body.items;
    assert.equal(review.length, 1);
    assert.equal(review[0].name, "Sam");
    assert.equal(review[0].date, `--${day(5).slice(5)}`);
  });

  test("the callback refuses forged, replayed, cross-user and unsigned requests", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const sibling = signedIn(db, { username: "noah", role: "member", personId: "p-noah" });
    seedEvents();
    const reason = (loc: string) => /reason=(\w+)/.exec(loc)?.[1];

    // no state cookie: a code from somewhere else can't be pushed into this browser
    const a = await call(db, "POST", "/api/calendars/google/start", {}, me);
    const ga = fake.approve(a.body.url);
    const noCookie = await call(db, "GET", `/api/calendars/google/callback?code=${ga.code}&state=${ga.state}`, undefined, null, { cookie: me.cookie });
    assert.equal(reason(noCookie.headers.get("location") ?? ""), "state");
    // (the failed attempt used the state up)
    assert.equal(count(db, "calendar_connections"), 0);

    // right cookie, wrong signed-in login
    const b = await call(db, "POST", "/api/calendars/google/start", {}, me);
    const gb = fake.approve(b.body.url);
    const cookieB = (b.headers.get("set-cookie") ?? "").split(";")[0];
    const other = await call(db, "GET", `/api/calendars/google/callback?code=${gb.code}&state=${gb.state}`, undefined, null, { cookie: `${sibling.cookie}; ${cookieB}` });
    assert.equal(reason(other.headers.get("location") ?? ""), "state");

    // not signed in at all
    const c = await call(db, "POST", "/api/calendars/google/start", {}, me);
    const gc = fake.approve(c.body.url);
    const anon = await call(db, "GET", `/api/calendars/google/callback?code=${gc.code}&state=${gc.state}`, undefined, null, { cookie: (c.headers.get("set-cookie") ?? "").split(";")[0]! });
    assert.equal(reason(anon.headers.get("location") ?? ""), "state");

    // invented state
    const forged = await call(db, "GET", `/api/calendars/google/callback?code=abc&state=${"x".repeat(32)}`, undefined, null, { cookie: `${me.cookie}; ribbon_gcal=${"x".repeat(32)}` });
    assert.equal(reason(forged.headers.get("location") ?? ""), "state");

    // replay: a good callback works once, never twice
    const ok = await connect(db, me);
    assert.match(ok.location, /google=connected/);
    const replay = await call(db, "GET", `/api/calendars/google/callback?code=${ok.code}&state=${ok.state}`, undefined, null, { cookie: ok.cookie });
    assert.equal(reason(replay.headers.get("location") ?? ""), "state");
    assert.equal(count(db, "calendar_connections"), 1);

    // an expired flow
    const d = await call(db, "POST", "/api/calendars/google/start", {}, me);
    const gd = fake.approve(d.body.url);
    db.prepare("UPDATE calendar_oauth_flows SET created_at = ?").run(Date.now() - 11 * 60_000);
    const late = await call(db, "GET", `/api/calendars/google/callback?code=${gd.code}&state=${gd.state}`, undefined, null, { cookie: `${me.cookie}; ${(d.headers.get("set-cookie") ?? "").split(";")[0]}` });
    assert.equal(reason(late.headers.get("location") ?? ""), "state");
  });

  test("denied consent, missing calendar scope and missing refresh token are reported and keep nothing", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    seedEvents();
    const start = await call(db, "POST", "/api/calendars/google/start", {}, me);
    const cookie = `${me.cookie}; ${(start.headers.get("set-cookie") ?? "").split(";")[0]}`;
    const state = new URL(start.body.url).searchParams.get("state")!;
    const denied = await call(db, "GET", `/api/calendars/google/callback?error=access_denied&state=${state}`, undefined, null, { cookie });
    assert.match(denied.headers.get("location") ?? "", /reason=denied/);
    assert.match((await connect(db, me, {}, { scopes: ["openid"] })).location, /reason=scope/);
    assert.match((await connect(db, me, {}, { omitRefresh: true })).location, /reason=norefresh/);
    assert.equal(count(db, "calendar_connections"), 0);
  });

  test("an expired access token is refreshed with the refresh token", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    seedEvents();
    await connect(db, me);
    const id = (db.prepare("SELECT id FROM calendar_connections").get() as { id: string }).id;
    fake.expireAccessTokens();
    db.prepare("UPDATE calendar_connections SET last_attempt_at = ? WHERE id = ?").run(new Date(Date.now() - 60_000).toISOString(), id);
    // our stored token's own expiry says "still valid", so Google's 401 is what triggers the refresh
    const sync = await call(db, "POST", `/api/calendars/${id}/sync`, {}, me);
    assert.equal(sync.status, 200, sync.text);
    assert.equal(fake.tokenCalls.filter((t) => t.grant === "refresh_token").length >= 1, true);
    assert.equal(sync.body.connection.lastStatus, "ok");
    // and the new token is what is stored (encrypted) for next time
    const row = db.prepare("SELECT source_enc FROM calendar_connections WHERE id = ?").get(id) as { source_enc: string };
    assert.ok(!/at-/.test(row.source_enc));
  });

  test("a revoked grant becomes 'reauth': the error is shown, background sync stops until reconnected", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    seedEvents();
    await connect(db, me);
    const id = (db.prepare("SELECT id FROM calendar_connections").get() as { id: string }).id;
    fake.expireAccessTokens();
    fake.revokeEverything();
    const result = await syncConnection(db, id);
    assert.equal(result.ok, false);
    const view = (await call(db, "GET", "/api/calendars", undefined, me)).body.connections[0];
    assert.equal(view.lastStatus, "reauth");
    assert.match(view.lastError, /Connect Google again/);
    assert.equal(view.eventCount, 4, "what was imported stays visible");
    assert.deepEqual(dueConnections(db, Date.now() + 999 * 3600_000), []);
  });

  test("Google's own errors are explained", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    seedEvents();
    await connect(db, me);
    const id = (db.prepare("SELECT id FROM calendar_connections").get() as { id: string }).id;
    fake.failApi = { status: 403, body: JSON.stringify({ error: { errors: [{ reason: "accessNotConfigured" }] } }) };
    assert.match((await syncConnection(db, id) as { error: string }).error, /Calendar API is not enabled/);
    fake.failApi = { status: 500 };
    assert.match((await syncConnection(db, id) as { error: string }).error, /answered 500/);
    fake.failApi = null;
    assert.equal((await syncConnection(db, id)).ok, true);
  });

  test("disconnecting revokes the grant at Google and deletes tokens and events", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    seedEvents();
    await connect(db, me);
    const id = (db.prepare("SELECT id FROM calendar_connections").get() as { id: string }).id;
    assert.equal((await call(db, "DELETE", `/api/calendars/${id}`, undefined, me)).status, 200);
    assert.equal(fake.revoked.length, 1);
    assert.match(fake.revoked[0]!, /^rt-/);
    assert.equal(count(db, "calendar_connections"), 0);
    assert.equal(count(db, "calendar_events"), 0);
    // even if Google is unreachable, the local data goes
    seedEvents();
    await connect(db, me);
    const id2 = (db.prepare("SELECT id FROM calendar_connections").get() as { id: string }).id;
    await fake.close();
    assert.equal((await call(db, "DELETE", `/api/calendars/${id2}`, undefined, me)).status, 200);
    assert.equal(count(db, "calendar_connections"), 0);
    fake = await startFakeGoogle(); // for afterEach
  });

  test("optional contacts birthdays: extra scope, People API, the birth year when known", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    seedEvents();
    fake.calendars = [{ id: "me@example.com", summary: "Me", primary: true }, { id: "addressbook#contacts@group.v.calendar.google.com", summary: "Birthdays" }];
    fake.events["addressbook#contacts@group.v.calendar.google.com"] = [{ id: "dup", summary: "Duplicate's birthday", start: { date: day(1) }, end: { date: dayAfter(1) }, eventType: "birthday" }];
    fake.people.push({ resourceName: "people/c1", names: [{ displayName: "Casey Jones" }], birthdays: [{ date: { year: 1991, month: 7, day: 9 } }] }, { resourceName: "people/c2", names: [{ displayName: "No Year" }], birthdays: [{ date: { month: 2, day: 29 } }] });
    const res = await connect(db, me, { contacts: true });
    assert.equal(new URL(res.start.body.url).searchParams.get("scope"), `${CALENDAR_SCOPE} ${CONTACTS_SCOPE}`);
    assert.match(res.location, /google=connected/);
    const review = (await call(db, "GET", "/api/calendars/review", undefined, me)).body.items as { name: string; date: string }[];
    const names = review.map((r) => r.name).sort();
    assert.ok(names.includes("Casey Jones") && names.includes("No Year") && names.includes("Sam"));
    assert.ok(!names.includes("Duplicate"), "the Birthdays calendar is skipped when contacts are read directly");
    assert.equal(review.find((r) => r.name === "Casey Jones")!.date, "1991-07-09");
    assert.equal(review.find((r) => r.name === "No Year")!.date, "--02-29");
    // not granted -> not read, even if asked
    await call(db, "DELETE", `/api/calendars/${(db.prepare("SELECT id FROM calendar_connections").get() as { id: string }).id}`, undefined, me);
    const noContacts = await connect(db, me, { contacts: true }, { scopes: [CALENDAR_SCOPE] });
    assert.match(noContacts.location, /google=connected/);
    assert.ok(!fake.log.slice(-6).some((l) => l.path.includes("/people/")), "contacts are not read without the scope");
  });

  test("another login or household can't use or see the Google connection", async () => {
    const db = freshDb();
    const me = signedIn(db, { username: "avery", personId: "p-avery" });
    const other = secondHousehold(db);
    seedEvents();
    await connect(db, me);
    const id = (db.prepare("SELECT id FROM calendar_connections").get() as { id: string }).id;
    assert.equal((await call(db, "POST", `/api/calendars/${id}/sync`, {}, other)).status, 404);
    assert.equal((await call(db, "DELETE", `/api/calendars/${id}`, undefined, other)).status, 404);
    assert.equal((await call(db, "GET", "/api/calendars", undefined, other)).body.connections.length, 0);
  });
});
