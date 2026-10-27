import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";

const dir = new URL("../styles/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".css"));

/** Every rule that mentions :hover, with the @media preludes it sits inside. Brace-matching, not a full CSS parser. */
function hoverRules(css: string): { selector: string; media: string[] }[] {
  const out: { selector: string; media: string[] }[] = [];
  const stack: { prelude: string; at: boolean }[] = [];
  let buf = "";
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") {
      const prelude = buf.trim();
      const at = prelude.startsWith("@");
      if (!at && prelude.includes(":hover")) out.push({ selector: prelude.replace(/\s+/g, " "), media: stack.filter((s) => s.at).map((s) => s.prelude) });
      stack.push({ prelude, at });
      buf = "";
    } else if (ch === "}") {
      stack.pop();
      buf = "";
    } else if (ch === ";") buf = "";
    else buf += ch;
  }
  return out;
}

describe("stylesheets", () => {
  test("hover styles only apply on devices that can hover (a tap must not leave them stuck on)", () => {
    const bad: string[] = [];
    for (const file of files) {
      for (const rule of hoverRules(readFileSync(new URL(file, dir), "utf8"))) {
        // Chart tooltips reveal data and are reached by a tap through sticky :hover, so they stay as they are.
        if (/\.mcol\b/.test(rule.selector)) continue;
        if (!rule.media.some((m) => m.includes("(hover: hover)"))) bad.push(`${file}: ${rule.selector}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test("the guard sees an ungated rule", () => {
    assert.equal(hoverRules(".a:hover { color: red; }").length, 1);
    assert.deepEqual(hoverRules("@media (hover: hover) { .a:hover { color: red; } }")[0]!.media, ["@media (hover: hover)"]);
  });

  test("no form control is pinned below 16px on touch screens", () => {
    const touch = readFileSync(new URL("touch.css", dir), "utf8");
    assert.match(touch, /@media \(pointer: coarse\)[\s\S]*font-size: 16px/);
    const extras = readFileSync(new URL("extras.css", dir), "utf8");
    assert.doesNotMatch(extras, /\.person-link[^}]*font-size:[^;]*!important/);
  });
});
