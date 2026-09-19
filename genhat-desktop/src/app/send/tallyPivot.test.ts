import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeCrosstab,
  defaultPivotForReport,
  parsePivotNumber,
  tallyMonthKey,
  validatePivotSpec,
} from "./tallyPivot.js";
import { parseTallyExportArgs } from "./tallyExcelExport.js";

describe("tallyPivot", () => {
  it("parses plain and multicurrency amounts", () => {
    assert.equal(parsePivotNumber("1,234.50"), 1234.5);
    assert.equal(parsePivotNumber("-$100 @ x = -? 5400.00"), -5400);
    assert.equal(parsePivotNumber(""), null);
  });

  it("derives month keys from Tally dates", () => {
    assert.equal(tallyMonthKey("20140409"), "2014-04");
    assert.equal(tallyMonthKey("2024-06-15"), "2024-06");
    assert.equal(tallyMonthKey(""), "(blank)");
  });

  it("builds empty crosstab for empty records", () => {
    const r = computeCrosstab([], {
      rows: "party",
      columns: "month",
      values: "amount",
      aggregation: "sum",
    });
    assert.deepEqual(r.headers, ["party", "Total"]);
    assert.deepEqual(r.rows, []);
  });

  it("pivots party × month with sum", () => {
    const r = computeCrosstab(
      [
        { party: "Acme", month: "2024-01", amount: "100" },
        { party: "Acme", month: "2024-01", amount: "50" },
        { party: "Acme", month: "2024-02", amount: "25" },
        { party: "Beta", month: "2024-01", amount: "10" },
      ],
      { rows: "party", columns: "month", values: "amount", aggregation: "sum" }
    );
    assert.deepEqual(r.headers, ["party", "2024-01", "2024-02", "Total"]);
    assert.deepEqual(r.rows[0], ["Acme", "150", "25", "175"]);
    assert.deepEqual(r.rows[1], ["Beta", "10", "0", "10"]);
  });

  it("supports single-dimension count and avg", () => {
    const count = computeCrosstab(
      [
        { party: "A", amount: "10" },
        { party: "A", amount: "20" },
        { party: "B", amount: "5" },
      ],
      { rows: "party", values: "amount", aggregation: "count" }
    );
    assert.equal(count.headers[1], "count");
    assert.deepEqual(count.rows[0], ["A", "2"]);
    assert.deepEqual(count.rows[1], ["B", "1"]);

    const avg = computeCrosstab(
      [
        { party: "A", amount: "10" },
        { party: "A", amount: "30" },
      ],
      { rows: "party", values: "amount", aggregation: "avg" }
    );
    assert.equal(avg.headers[1], "avg(amount)");
    assert.deepEqual(avg.rows[0], ["A", "20"]);
  });

  it("validates pivot fields per report", () => {
    assert.equal(
      validatePivotSpec("daybook", {
        rows: "party",
        columns: "month",
        values: "amount",
      }),
      null
    );
    assert.match(
      validatePivotSpec("daybook", {
        rows: "side",
        values: "amount",
      }) ?? "",
      /not valid/
    );
  });

  it("provides report defaults", () => {
    assert.deepEqual(defaultPivotForReport("daybook"), {
      rows: "party",
      columns: "month",
      values: "amount",
      aggregation: "sum",
    });
  });
});

describe("tallyExcelExport args", () => {
  it("parses export args and clamps max_rows", () => {
    const parsed = parseTallyExportArgs({
      report: "daybook",
      from_date: "2024-01-01",
      to_date: "2024-12-31",
      max_rows: 99999,
      pivot: { rows: "party", columns: "month", values: "amount", aggregation: "sum" },
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.report, "daybook");
    assert.equal(parsed.value.maxRows, 2000);
    assert.equal(parsed.value.pivot?.rows, "party");
  });

  it("rejects missing report", () => {
    const parsed = parseTallyExportArgs({});
    assert.equal(parsed.ok, false);
  });
});
