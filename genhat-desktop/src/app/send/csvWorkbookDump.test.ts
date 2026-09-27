import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  looksLikeCsvWorkbookDump,
  parseCsvWorkbookDump,
  userAskedForSpreadsheetArtifact,
  spreadsheetCsvDumpRepairUserMessage,
} from "./csvWorkbookDump.js";

const MORGAN_CSV = `
I'll create a comprehensive color-coded Excel spreadsheet.

\`\`\`csv
"Sheet1: Executive Summary"
"Metric","Q2 2026","YoY Change","Consensus Estimate"
"Net Revenue","$21.3 billion","27% YoY","$19.67483B"
"Diluted EPS","$3.46","$0.57 above consensus","$2.89 consensus"
"Net Income","$5.6 billion","58% YoY",""

"Sheet2: Revenue Breakdown"
"Segment","Q2 2026 Revenue","Pre-tax Margin","YoY Change"
"Wealth Management","$8.9 billion","30.5%","Record quarter"
"Investment Banking","$6.5 billion","15.2%",""

"Sheet3: Key Performance Indicators"
"Metric","Q2 2026","Q2 2025","Change"
"Net New Assets","$148 billion","$92 billion","56% increase"
"Total Client Assets","$10 trillion","$8.8 trillion","13.6% increase"
\`\`\`

**Summary:** Morgan Stanley delivered a record Q2.
`;

describe("userAskedForSpreadsheetArtifact", () => {
  it("detects excel / color-code finance requests", () => {
    assert.equal(
      userAskedForSpreadsheetArtifact(
        "Create a color-coded Excel of Morgan Stanley Q2 2026 finances"
      ),
      true
    );
    assert.equal(
      userAskedForSpreadsheetArtifact("What is the weather in Paris?"),
      false
    );
  });
});

describe("looksLikeCsvWorkbookDump", () => {
  it("detects the Morgan Stanley csv fence dump", () => {
    assert.equal(looksLikeCsvWorkbookDump(MORGAN_CSV), true);
  });

  it("rejects normal prose", () => {
    assert.equal(
      looksLikeCsvWorkbookDump(
        "Morgan Stanley reported strong results. Net revenue was $21.3B."
      ),
      false
    );
  });
});

describe("parseCsvWorkbookDump", () => {
  it("salvages multiple sheets from SheetN markers", () => {
    const sheets = parseCsvWorkbookDump(MORGAN_CSV);
    assert.ok(sheets.length >= 3, `expected >=3 sheets, got ${sheets.length}`);
    assert.match(sheets[0]!.name, /Executive|Summary/i);
    assert.deepEqual(sheets[0]!.headers[0], "Metric");
    assert.ok(sheets[0]!.rows.length >= 2);
    assert.ok(
      sheets.some((s) => /Revenue|Breakdown/i.test(s.name)),
      "should include revenue breakdown sheet"
    );
  });
});

describe("spreadsheetCsvDumpRepairUserMessage", () => {
  it("prefers run_xlsx_python over CSV dumps", () => {
    const msg = spreadsheetCsvDumpRepairUserMessage();
    assert.match(msg, /run_xlsx_python/);
    assert.match(msg, /NELA_XLSX_OUT|Python sandbox/i);
  });
});
