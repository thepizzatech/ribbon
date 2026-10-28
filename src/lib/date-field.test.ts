import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cleanMonthDay, cleanOccasionDate } from "./gifts/model.ts";
import {
  describeDate,
  formatDateText,
  parseDateText,
  pickerDateToValue,
  setYearKnown,
  valueToPickerDate,
  yearIsUnknown,
  yearRange,
} from "./date-field.ts";

const ok = (value: string) => ({ ok: true, value });
const bad = { ok: false };

describe("DateField: typed text", () => {
  test("a birthday still reads the forms the old box took, and stores what the server stores", () => {
    for (const [text, value] of [
      ["2016-12-02", "2016-12-02"],
      ["2016-12-2", "2016-12-02"],
      ["2016/12/02", "2016-12-02"],
      ["12/2/2016", "2016-12-02"],
      ["12-02", "--12-02"],
      ["12/2", "--12-02"],
      ["--12-02", "--12-02"],
      ["", ""],
      ["  ", ""],
    ] as const)
      assert.deepEqual(parseDateText(text, "optional-year"), ok(value), text);
    for (const text of [
      "2016-13-01",
      "2016-12-32",
      "12-32",
      "13-01",
      "Dec 2",
      "2015-02-29",
      "0000-01-01",
      "2016-12",
      "12",
    ])
      assert.deepEqual(parseDateText(text, "optional-year"), bad, text);
  });

  test("whatever the box accepts, the server accepts too", () => {
    for (const text of ["2016-12-02", "12-02", "02-29", "2024-02-29", "12/31"]) {
      const parsed = parseDateText(text, "optional-year");
      assert.ok(parsed.ok && cleanMonthDay(parsed.value) === parsed.value, text);
    }
    for (const text of ["12-25", "2/29", "01-01"]) {
      const parsed = parseDateText(text, "month-day");
      assert.ok(parsed.ok && cleanOccasionDate(parsed.value) === parsed.value, text);
    }
  });

  test("each kind of field only takes its own shape", () => {
    assert.deepEqual(parseDateText("2026-12-02", "date"), ok("2026-12-02"));
    assert.deepEqual(parseDateText("12/2/2026", "date"), ok("2026-12-02"));
    assert.deepEqual(parseDateText("12-02", "date"), bad, "a gift needs the year");
    assert.deepEqual(parseDateText("2026-13-45", "date"), bad);
    assert.deepEqual(parseDateText("12-25", "month-day"), ok("12-25"));
    assert.deepEqual(parseDateText("12/5", "month-day"), ok("12-05"));
    assert.deepEqual(
      parseDateText("2026-12-25", "month-day"),
      bad,
      "an occasion repeats every year",
    );
  });

  test("Feb 29 needs a leap year when there is a year, and is fine without one", () => {
    assert.deepEqual(parseDateText("2024-02-29", "date"), ok("2024-02-29"));
    assert.deepEqual(parseDateText("2026-02-29", "date"), bad);
    assert.deepEqual(parseDateText("02-29", "optional-year"), ok("--02-29"));
    assert.deepEqual(parseDateText("02-29", "month-day"), ok("02-29"));
    assert.deepEqual(parseDateText("02-30", "month-day"), bad);
  });

  test("what the box shows reads back as the same value", () => {
    for (const value of ["2016-12-02", "--12-02", "--02-29", "2024-02-29"]) {
      const text = formatDateText(value);
      assert.deepEqual(parseDateText(text, "optional-year"), ok(value), `${value} -> ${text}`);
    }
    assert.equal(formatDateText("--12-02"), "12-02");
    assert.equal(formatDateText("12-25"), "12-25");
    assert.equal(formatDateText("2016-12-02"), "2016-12-02");
    assert.equal(formatDateText(""), "");
  });
});

describe("DateField: the calendar", () => {
  test("picking a day saves a full date, or --MM-DD when the year isn't known", () => {
    const day = new Date(2016, 11, 2);
    assert.equal(pickerDateToValue(day, "optional-year", true), "2016-12-02");
    assert.equal(pickerDateToValue(day, "optional-year", false), "--12-02");
    assert.equal(pickerDateToValue(day, "date", true), "2016-12-02");
    assert.equal(pickerDateToValue(day, "month-day", false), "12-02");
    assert.equal(
      pickerDateToValue(new Date(2016, 0, 5), "month-day", false),
      "01-05",
      "zero padded",
    );
  });

  test("the year-unknown switch keeps the month and day both ways", () => {
    assert.equal(setYearKnown("2016-12-02", false, 2026), "--12-02");
    assert.equal(setYearKnown("--12-02", true, 2026), "2026-12-02");
    assert.equal(setYearKnown("2016-12-02", true, 2026), "2016-12-02", "already known: unchanged");
    assert.equal(setYearKnown("", true, 2026), "");
    assert.equal(setYearKnown("", false, 2026), "");
    assert.ok(yearIsUnknown("--12-02") && yearIsUnknown("12-02") && !yearIsUnknown("2016-12-02"));
  });

  test("Feb 29 round-trips through the calendar, with and without a year", () => {
    assert.equal(
      pickerDateToValue(valueToPickerDate("--02-29")!, "optional-year", false),
      "--02-29",
    );
    assert.equal(pickerDateToValue(valueToPickerDate("02-29")!, "month-day", false), "02-29");
    assert.equal(
      pickerDateToValue(valueToPickerDate("2024-02-29")!, "optional-year", true),
      "2024-02-29",
    );
    // a birthday with no year turned into one with a year: Feb 29 lands on the nearest earlier leap year
    assert.equal(setYearKnown("--02-29", true, 2026), "2024-02-29");
    assert.equal(setYearKnown("--02-29", true, 2100), "2096-02-29", "2100 is not a leap year");
    assert.equal(setYearKnown("2024-02-29", false, 2026), "--02-29");
    // and the picked day is always shown in a leap year, so 29 Feb exists on the grid
    assert.equal(valueToPickerDate("--02-29")!.getDate(), 29);
  });

  test("nothing, or nonsense, is no date", () => {
    assert.equal(valueToPickerDate(""), undefined);
    assert.equal(valueToPickerDate("2026-02-30"), undefined);
    assert.equal(describeDate("garbage"), "");
    assert.match(describeDate("--12-02"), /Dec/);
    assert.match(describeDate("2016-12-02"), /2016/);
    assert.doesNotMatch(describeDate("--12-02"), /\d{4}/);
  });

  test("the year list is wide enough for a birthday and always holds the current value", () => {
    assert.deepEqual(yearRange("optional-year", "", 2026), { from: 1900, to: 2027 });
    assert.deepEqual(yearRange("date", "", 2026), { from: 1970, to: 2036 });
    assert.deepEqual(yearRange("date", "1960-05-05", 2026), { from: 1960, to: 2036 });
    assert.deepEqual(yearRange("date", "2050-05-05", 2026), { from: 1970, to: 2050 });
    assert.deepEqual(yearRange("date", "", 2026, 2020, 2030), { from: 2020, to: 2030 });
  });
});
