import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasSearchKeywords,
  shouldRunAmbientFileSearch,
} from "./ambientSearch.js";

describe("shouldRunAmbientFileSearch", () => {
  it("never auto-runs from keyword-heavy prompts", () => {
    const valuationPrompt =
      "Perform targeted web research. Search and integrate benchmark data. Generate a docx whitepaper with Markdown tables.";
    assert.equal(hasSearchKeywords(valuationPrompt), true);
    assert.equal(shouldRunAmbientFileSearch(valuationPrompt), false);
    assert.equal(
      shouldRunAmbientFileSearch("find my resume on my computer"),
      false
    );
    assert.equal(
      shouldRunAmbientFileSearch("look up report.pdf in my files"),
      false
    );
  });

  it("runs only when the user explicitly forces /files", () => {
    assert.equal(
      shouldRunAmbientFileSearch("anything", { forceFileSearch: true }),
      true
    );
  });
});
