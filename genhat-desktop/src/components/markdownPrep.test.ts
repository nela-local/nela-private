import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripTrailingSourcesSection } from "./markdownPrep.js";

describe("stripTrailingSourcesSection", () => {
  it("does not cut long answers after mid-body Sources [n] notes", () => {
    const md = [
      "## 2.1 Benchmarks",
      "",
      "| A | B |",
      "|---|---|",
      "| x | y |",
      "",
      "**Sources [1]:** Carta Q3 2025; **[2]:** Flowjam 2026.",
      "",
      "### 2.2 Positioning",
      "",
      "NELA is 42% below the median.",
      "",
      "## 3. Valuation",
      "",
      "Berkus yields $1.7M.",
    ].join("\n");

    const out = stripTrailingSourcesSection(md);
    assert.match(out, /### 2\.2 Positioning/);
    assert.match(out, /## 3\. Valuation/);
    assert.match(out, /\*\*Sources \[1\]:\*\*/);
  });

  it("still strips a real trailing Sources bibliography", () => {
    const md = [
      "Answer with citations.[1]",
      "",
      "Sources",
      "",
      "1. https://example.com/a",
      "2. https://example.com/b",
    ].join("\n");

    const out = stripTrailingSourcesSection(md);
    assert.equal(out, "Answer with citations.[1]");
    assert.doesNotMatch(out, /https:\/\/example\.com/);
  });

  it("keeps References & Data Sources sections", () => {
    const md = [
      "Body text.",
      "",
      "## References & Data Sources",
      "",
      "[1] Carta, State of Private Markets.",
    ].join("\n");

    const out = stripTrailingSourcesSection(md);
    assert.match(out, /## References & Data Sources/);
    assert.match(out, /Carta/);
  });
});
