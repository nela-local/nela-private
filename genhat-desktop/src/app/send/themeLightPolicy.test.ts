import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseToneFromPrompt } from "./themePaletteEngine.js";
import { applyThemeFromPrompt } from "./freeformHtmlThemeEdit.js";

describe("parseToneFromPrompt (light-first)", () => {
  it("defaults to light when the prompt has no theme intent", () => {
    assert.equal(
      parseToneFromPrompt("12-month research roadmap for building a CV"),
      "light"
    );
    assert.equal(parseToneFromPrompt("make a presentation about ML"), "light");
  });

  it("stays light for content that mentions dark without theme intent", () => {
    assert.equal(
      parseToneFromPrompt("slides about dark patterns in UX"),
      "light"
    );
  });

  it("switches to dark only on explicit theme intent", () => {
    assert.equal(parseToneFromPrompt("dark mode research deck"), "dark");
    assert.equal(parseToneFromPrompt("midnight neon cyber theme"), "dark");
    assert.equal(parseToneFromPrompt("make it dark please"), "dark");
    assert.equal(parseToneFromPrompt("use a dark background"), "dark");
  });
});

describe("applyThemeFromPrompt light enforcement", () => {
  const darkHtml = `<!DOCTYPE html><html><head><style>
  :root { --bg: #030606; --ink: #e2e8f0; }
  body { background: #070d0c; color: #bdd0cf; }
  .card.green { background: #000707; }
  td { white-space: nowrap; color: green; }
</style></head><body><div class="card green">Hi</div></body></html>`;

  it("recolors a dark freeform deck to light for a neutral prompt", () => {
    const { html, palette } = applyThemeFromPrompt(
      darkHtml,
      "research CV roadmap presentation"
    );
    assert.equal(palette.tone, "light");
    assert.match(html, /nela-theme-safety/);
    // Selectors / properties must not be mangled
    assert.match(html, /\.card\.green/);
    assert.match(html, /white-space:\s*nowrap/);
    // Named color in a value may be recolored, but class name stays
    assert.doesNotMatch(html, /\.card\.#/);
    assert.doesNotMatch(html, /#[0-9a-f]{3,8}-space/i);
  });

  it("keeps dark tone when the user asks for dark mode", () => {
    const { palette } = applyThemeFromPrompt(
      darkHtml,
      "make a dark mode midnight deck about research"
    );
    assert.equal(palette.tone, "dark");
  });
});
