import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { firstGrapheme, initialsOf, plural, relativeAgo } from "./format.ts";

describe("plural", () => {
  test("uses the singular only for exactly one", () => {
    assert.equal(plural(0, "event"), "0 events");
    assert.equal(plural(1, "event"), "1 event");
    assert.equal(plural(2, "event"), "2 events");
    assert.equal(plural(21, "year"), "21 years");
  });
  test("takes an irregular plural", () => {
    assert.equal(plural(1, "person", "people"), "1 person");
    assert.equal(plural(3, "person", "people"), "3 people");
    assert.equal(plural(1, "thing needs you", "things need you"), "1 thing needs you");
  });
});

describe("relativeAgo", () => {
  test("is not '1 days ago'", () => {
    assert.match(relativeAgo(86400), /yesterday|1 day ago/);
    assert.doesNotMatch(relativeAgo(86400 * 1.2), /1 days/);
    assert.match(relativeAgo(86400 * 3), /3 days ago/);
    assert.match(relativeAgo(5 * 60), /5 minutes ago/);
    assert.match(relativeAgo(3 * 3600), /3 hours ago/);
  });
});

describe("initialsOf", () => {
  test("first and last word", () => {
    assert.equal(initialsOf("Avery Cole"), "AC");
    assert.equal(initialsOf("María José de la Cruz y Fernández"), "MF");
    assert.equal(initialsOf("dana"), "D");
    assert.equal(initialsOf("  Jo  "), "J");
  });
  test("does not split an emoji in half", () => {
    assert.equal(initialsOf("🦊 Fox"), "🦊F");
    assert.equal(initialsOf("👩🏽‍💻 Priya"), "👩🏽‍💻P");
    assert.equal(firstGrapheme("🦊"), "🦊");
    for (const name of ["🦊 Fox", "👩🏽‍💻 Priya", "王秀英"]) {
      const out = initialsOf(name);
      // no lone surrogates
      assert.equal(out, Array.from(out).join(""));
      assert.doesNotThrow(() => encodeURIComponent(out)); // throws on a lone surrogate
    }
  });
  test("falls back when empty", () => {
    assert.equal(initialsOf(""), "?");
    assert.equal(initialsOf("   ", "R"), "R");
  });
});
