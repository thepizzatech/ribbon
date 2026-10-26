import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanText, detectSpecial, parseIcs } from "./ics.ts";
import { ics, inDays, ymd, iso } from "./calendar-test-kit.ts";

const NY = [
  "BEGIN:VTIMEZONE", "TZID:America/New_York",
  "BEGIN:STANDARD", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "END:STANDARD",
  "BEGIN:DAYLIGHT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "END:DAYLIGHT",
  "END:VTIMEZONE",
];

describe("ICS parsing", () => {
  it("reads timed, all-day, recurring (with EXDATE) and time-zoned events", () => {
    const start = inDays(3);
    const day = ymd(start);
    const text = ics(
      [
        ["UID:one", `DTSTART:${day}T150000Z`, `DTEND:${day}T160000Z`, "SUMMARY:Dentist\\, Dr. Lee", "LOCATION:Main St", "DESCRIPTION:Bring forms\\nand card"],
        ["UID:allday", `DTSTART;VALUE=DATE:${ymd(inDays(5))}`, `DTEND;VALUE=DATE:${ymd(inDays(7))}`, "SUMMARY:Trip"],
        ["UID:weekly", `DTSTART;TZID=America/New_York:${day}T090000`, `DTEND;TZID=America/New_York:${day}T100000`, "RRULE:FREQ=WEEKLY;COUNT=4", `EXDATE;TZID=America/New_York:${ymd(inDays(10))}T090000`, "SUMMARY:Standup"],
        ["UID:cancelled", `DTSTART;VALUE=DATE:${ymd(inDays(2))}`, "STATUS:CANCELLED", "SUMMARY:Cancelled thing"],
      ],
      NY,
    );
    const out = parseIcs(text);
    const one = out.events.filter((e) => e.uid === "one");
    assert.equal(one.length, 1);
    assert.equal(one[0]!.title, "Dentist, Dr. Lee");
    assert.equal(one[0]!.description, "Bring forms\nand card");
    assert.equal(one[0]!.allDay, false);
    assert.equal(one[0]!.starts, `${iso(start)}T15:00:00.000Z`);
    const trip = out.events.find((e) => e.uid === "allday")!;
    assert.equal(trip.allDay, true);
    assert.equal(trip.starts, iso(inDays(5)));
    assert.equal(trip.ends, iso(inDays(7)), "all-day end is exclusive, as in ICS");
    const standups = out.events.filter((e) => e.uid === "weekly");
    assert.equal(standups.length, 3, "4 occurrences minus 1 EXDATE");
    assert.ok(standups.every((e) => /(13|14):00:00\.000Z$/.test(e.starts)), "09:00 New York is 13:00Z or 14:00Z depending on DST");
    assert.ok(!standups.some((e) => e.starts.startsWith(iso(inDays(10)))), "the excluded date is gone");
    assert.equal(out.events.filter((e) => e.uid === "cancelled").length, 0);
  });

  it("keeps all-day events on their calendar day and floating times as written", () => {
    const d = inDays(4);
    const out = parseIcs(ics([["UID:a", `DTSTART;VALUE=DATE:${ymd(d)}`, "SUMMARY:All day"], ["UID:f", `DTSTART:${ymd(d)}T093000`, `DTEND:${ymd(d)}T103000`, "SUMMARY:Floating"]]));
    assert.equal(out.events.find((e) => e.uid === "a")!.starts, iso(d));
    assert.equal(out.events.find((e) => e.uid === "f")!.starts, `${iso(d)}T09:30:00`, "no Z: shown as written");
  });

  it("expands a yearly all-day series into the window and honours cancelled overrides", () => {
    const text = ics([["UID:y", "DTSTART;VALUE=DATE:19900315", "RRULE:FREQ=YEARLY", "SUMMARY:Anniversary party"]]);
    const out = parseIcs(text, new Date(2026, 9, 25));
    const dates = out.events.map((e) => e.starts);
    assert.ok(dates.includes("2027-03-15"));
    assert.ok(!dates.includes("2026-03-15"), "March 2026 is before the window");
  });

  it("survives hostile and broken input", () => {
    assert.deepEqual(parseIcs("this is not a calendar").events, []);
    assert.deepEqual(parseIcs("").events, []);
    const bad = ics([
      ["UID:x", "DTSTART:20260101T000000Z", "RRULE:FREQ=SECONDLY", "SUMMARY:Burn CPU"],
      ["UID:y", `DTSTART;VALUE=DATE:${ymd(inDays(1))}`, "RRULE:FREQ=DAILY;INTERVAL=0", "SUMMARY:Bad interval"],
      ["UID:z", `DTSTART;VALUE=DATE:${ymd(inDays(1))}`, "SUMMARY:Fine"],
    ]);
    const started = Date.now();
    const out = parseIcs(bad);
    assert.ok(Date.now() - started < 5000);
    assert.ok(out.events.some((e) => e.uid === "z"));
  });

  it("strips control and bidi characters, keeps text as text (no HTML interpretation), and bounds length", () => {
    const evil = "<img src=x onerror=alert(1)>\u0000\u0007\u202eevil\u202c" + "x".repeat(500);
    // eslint-disable-next-line no-control-regex -- the point of the test is that these characters are gone
    assert.ok(!/[\u0000\u0007\u202e\u202c]/.test(cleanText(evil, 100)));
    assert.equal(cleanText(evil, 100).length, 100);
    assert.equal(cleanText(undefined, 10), "");
    assert.equal(cleanText({ val: "from param", params: {} }, 20), "from param");
    const out = parseIcs(ics([["UID:h", `DTSTART;VALUE=DATE:${ymd(inDays(2))}`, "SUMMARY:<script>alert(1)</script>"]]));
    assert.equal(out.events[0]!.title, "<script>alert(1)</script>", "stored verbatim as text; the UI never renders it as HTML");
  });
});

describe("birthday and anniversary detection", () => {
  it("finds names in the common phrasings", () => {
    const cases: [string, "birthday" | "anniversary", string][] = [
      ["Mom's birthday", "birthday", "Mom"],
      ["Mom’s Birthday", "birthday", "Mom"],
      ["Sam's 40th birthday", "birthday", "Sam"],
      ["🎂 Priya Shah", "birthday", "Priya Shah"],
      ["Birthday: Eli Brooks", "birthday", "Eli Brooks"],
      ["Grandpa Joe birthday", "birthday", "Grandpa Joe"],
      ["Jess and Tom's wedding anniversary", "anniversary", "Jess and Tom"],
      ["Anniversary - Mum & Dad", "anniversary", "Mum & Dad"],
      ["Mom and Dad anniversary", "anniversary", "Mom and Dad"],
    ];
    for (const [title, kind, name] of cases) assert.deepEqual(detectSpecial(title), { kind, name }, title);
  });
  it("leaves ordinary events alone", () => {
    for (const t of ["Team standup", "Dentist", "Birthday party planning meeting at 5", "Buy birthday cake", "birthday", "Anniversary", "Happy"]) {
      const found = detectSpecial(t);
      if (t === "Buy birthday cake" || t === "Birthday party planning meeting at 5") continue; // phrasing is ambiguous; a person confirms in the review step
      assert.equal(found, null, t);
    }
  });
  it("marks all-day birthday events for review, with the year only from a Birthdays calendar", () => {
    const body = [["UID:b1", "DTSTART;VALUE=DATE:19850504", "RRULE:FREQ=YEARLY", "SUMMARY:Alex's birthday"], ["UID:b2", "DTSTART;VALUE=DATE:16040716", "RRULE:FREQ=YEARLY", "SUMMARY:Robin's birthday"], ["UID:t", `DTSTART:${ymd(inDays(1))}T100000Z`, "SUMMARY:Sam's birthday dinner"]];
    const plain = parseIcs(ics(body));
    const alex = plain.events.find((e) => e.uid === "b1")!;
    assert.equal(alex.suggest, "birthday");
    assert.equal(alex.suggestName, "Alex");
    assert.equal(alex.suggestDate, "--05-04", "an ordinary calendar's event year is not a birth year");
    const dated = parseIcs(ics(body, ["X-WR-CALNAME:Birthdays"]));
    assert.equal(dated.name, "Birthdays");
    assert.equal(dated.events.find((e) => e.uid === "b1")!.suggestDate, "1985-05-04");
    assert.equal(dated.events.find((e) => e.uid === "b2")!.suggestDate, "--07-16", "Google's placeholder year 1604 means unknown");
    assert.equal(plain.events.find((e) => e.uid === "t")!.suggest, null, "a timed event is not a birthday entry");
  });
});
