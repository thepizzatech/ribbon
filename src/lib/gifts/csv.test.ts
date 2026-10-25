import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { autoMap, csvCell, parseAmountCell, parseCsv, parseDateCell, parseMonthDayCell, templateCsv, toCsv } from "./csv.ts";

describe("csv", () => {
  test("parses quotes, embedded newlines, CRLF, BOM and semicolons", () => {
    assert.deepEqual(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n"line\nbreak",z'), [["a", "b"], ["x, y", 'say "hi"'], ["line\nbreak", "z"]]);
    assert.deepEqual(parseCsv("a;b\n1;2\n"), [["a", "b"], ["1", "2"]]);
    assert.deepEqual(parseCsv("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
    assert.deepEqual(parseCsv("a,b\n\n,\n1,2"), [["a", "b"], ["1", "2"]]);
  });

  test("round-trips through toCsv and blocks formula injection", () => {
    const rows = [["=SUM(A1)", "plain", 'q"uote', "a,b"], ["@cmd", "-5 off", " pad", 12.5]];
    assert.equal(csvCell("=1+1"), "'=1+1");
    assert.equal(csvCell(-5), "-5"); // numbers stay numbers
    const text = toCsv(["a", "b", "c", "d"], rows);
    const back = parseCsv(text);
    assert.equal(back[1]![0], "'=SUM(A1)");
    assert.equal(back[1]![2], 'q"uote');
    assert.equal(back[1]![3], "a,b");
    assert.equal(back[2]![2], " pad");
  });

  test("auto-maps headers by name and alias; the template maps to itself", () => {
    const m = autoMap("gifts", ["Gift", "When", "Recipient", "Cost", "Mystery"]);
    assert.equal(m.title, 0);
    assert.equal(m.date, 1);
    assert.equal(m.receiver, 2);
    assert.equal(m.amount, 3);
    assert.equal(m.note, null);
    const t = parseCsv(templateCsv("wishlist"));
    const all = autoMap("wishlist", t[0]!);
    assert.ok(Object.values(all).every((v) => v !== null));
  });

  test("value cleaners", () => {
    assert.equal(parseDateCell("2026-1-5"), "2026-01-05");
    assert.equal(parseDateCell("12/25/2025"), "2025-12-25");
    assert.equal(parseDateCell("25 Dec 2025"), "2025-12-25");
    assert.equal(parseDateCell("2026-02-30"), null);
    assert.equal(parseDateCell(""), undefined);
    assert.equal(parseDateCell("someday"), null);
    assert.equal(parseMonthDayCell("Dec 2"), "--12-02");
    assert.equal(parseMonthDayCell("--03-14"), "--03-14");
    assert.equal(parseMonthDayCell("1988-03-14"), "1988-03-14");
    assert.equal(parseMonthDayCell("13/45"), null);
    assert.equal(parseAmountCell("$1,234.50"), 1234.5);
    assert.equal(parseAmountCell("12,50"), 12.5);
    assert.equal(parseAmountCell("free"), null);
    assert.equal(parseAmountCell("-3"), null);
  });
});
