import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  headersFromParsedSpreadsheet,
  mapTemplateHeaders,
  projectRecordsToTemplate,
} from "./tallyTemplateFormat.js";
import { parseTallyExportArgs } from "./tallyExcelExport.js";

describe("tallyTemplateFormat", () => {
  it("does not guess fields without column_map", () => {
    const mapping = mapTemplateHeaders("daybook", [
      "Date",
      "Party Name",
      "Amt",
    ]);
    assert.equal(mapping.mappedCount, 0);
    assert.deepEqual(mapping.fields, [null, null, null]);
  });

  it("maps only via explicit column_map", () => {
    const mapping = mapTemplateHeaders(
      "daybook",
      ["Date", "Party Name", "Voucher Type", "Amt", "Notes"],
      {
        Date: "date",
        "Party Name": "party",
        "Voucher Type": "voucherType",
        Amt: "amount",
        Notes: "narration",
      }
    );
    assert.equal(mapping.mappedCount, 5);
    assert.deepEqual(mapping.fields, [
      "date",
      "party",
      "voucherType",
      "amount",
      "narration",
    ]);
  });

  it("ignores invalid or duplicate column_map targets", () => {
    const mapping = mapTemplateHeaders(
      "daybook",
      ["Foo", "Bar", "Baz"],
      { Foo: "party", Bar: "notAField", Baz: "party" }
    );
    assert.deepEqual(mapping.fields, ["party", null, null]);
  });

  it("projects records into template column order", () => {
    const mapping = mapTemplateHeaders(
      "daybook",
      ["Party Name", "Amt"],
      { "Party Name": "party", Amt: "amount" }
    );
    const rows = projectRecordsToTemplate(mapping, [
      { party: "Acme", amount: "100", date: "20240101" },
      { party: "Beta", amount: "50" },
    ]);
    assert.deepEqual(rows, [
      ["Acme", "100"],
      ["Beta", "50"],
    ]);
  });

  it("extracts headers from parsed spreadsheet payload", () => {
    const extracted = headersFromParsedSpreadsheet({
      sheet_name: "Sample",
      rows: [
        ["Date", "Party"],
        ["2024-01-01", "Acme"],
      ],
    });
    assert.deepEqual(extracted, {
      sheetName: "Sample",
      headers: ["Date", "Party"],
    });
  });
});

describe("tallyExcelExport template args", () => {
  it("enables match_template when template_path is set", () => {
    const parsed = parseTallyExportArgs({
      report: "daybook",
      template_path: "/tmp/sample.xlsx",
      column_map: { Date: "date" },
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.matchTemplate, true);
    assert.equal(parsed.value.templatePath, "/tmp/sample.xlsx");
    assert.equal(parsed.value.includeRaw, false);
  });

  it("accepts template_headers and column_map", () => {
    const parsed = parseTallyExportArgs({
      report: "outstanding",
      match_template: true,
      template_headers: ["Party", "Balance"],
      column_map: { Party: "name", Balance: "balance" },
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.value.templateHeaders, ["Party", "Balance"]);
    assert.equal(parsed.value.columnMap?.Party, "name");
  });
});
