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

  test("on a desktop the page fills the width beside the sidebar instead of sitting in a narrow column", () => {
    const shell = readFileSync(new URL("shell.css", dir), "utf8");
    const desktop = shell.slice(shell.indexOf("@media (min-width: 1024px)"));
    const page = /\.page\s*\{([^}]*)\}/.exec(desktop)?.[1] ?? "";
    assert.match(page, /width:\s*100%/);
    const cap = /max-width:\s*(\d+)px/.exec(page)?.[1];
    assert.ok(cap && Number(cap) >= 1920, `desktop .page max-width is ${cap}px`);
    // The Calendar used to be the one page that escaped the cap; now no page needs to.
    for (const file of files) assert.doesNotMatch(readFileSync(new URL(file, dir), "utf8"), /\.page:has\(/);
  });

  test("the date picker has 44px touch targets and its own styles (no react-day-picker stylesheet)", () => {
    const css = readFileSync(new URL("datepicker.css", dir), "utf8");
    const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
    assert.match(coarse, /\.dp-day-btn\s*\{[^}]*min-height:\s*44px/);
    assert.match(coarse, /\.dp-trigger\s*\{[^}]*height:\s*44px/);
    const field = readFileSync(new URL("../components/date-picker-panel.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(field, /react-day-picker\/(dist\/)?style/);
  });

  test("the Calendar uses the same page heading as the other pages", () => {
    const cal = readFileSync(new URL("../components/pages/calendar.tsx", import.meta.url), "utf8");
    assert.match(cal, /<h1 className="page-title">Calendar<\/h1>/);
    assert.match(cal, /className="page-head"/);
  });
});
