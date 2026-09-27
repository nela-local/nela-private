import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSpreadsheetPlan,
  sanitizeCellFills,
  sanitizeCellFonts,
  wantsSpreadsheetColorCoding,
  buildAutoCellFills,
  parseFlexibleColor,
  repairMisalignedRow,
  alignSheetRows,
} from "./spreadsheetPlan.js";

describe("sanitizeCellFills", () => {
  it("keeps valid #RRGGBB keys and drops junk", () => {
    const fills = sanitizeCellFills({
      "0:0": "#217346",
      "1:2": "ffebef",
      bad: "#FFFFFF",
      "0:1": "not-a-color",
    });
    assert.deepEqual(fills, {
      "0:0": "#217346",
      "1:2": "#FFEBEF",
    });
  });

  it("accepts Excel A1 keys, short hex, rgb(), and comma keys", () => {
    const fills = sanitizeCellFills({
      A1: "#1F3864",
      B2: "#0F0",
      "1,2": "rgb(255, 235, 238)",
    });
    assert.deepEqual(fills, {
      "0:0": "#1F3864",
      "1:1": "#00FF00",
      "1:2": "#FFEBEE",
    });
  });
});

describe("sanitizeCellFonts / parseFlexibleColor", () => {
  it("normalizes font colors", () => {
    assert.equal(parseFlexibleColor("#00f"), "#0000FF");
    assert.equal(parseFlexibleColor("rgb(0,128,0)"), "#008000");
    const fonts = sanitizeCellFonts({ B5: "#0000FF", "2:1": "000000" });
    assert.deepEqual(fonts, { "4:1": "#0000FF", "2:1": "#000000" });
  });
});

describe("normalizeSpreadsheetPlan cell_fills", () => {
  it("preserves bare headers/rows/cell_fills for generate_spreadsheet", () => {
    const plan = normalizeSpreadsheetPlan(
      {
        sheets: [
          {
            name: "P&L",
            headers: ["Item", "Amount"],
            rows: [
              ["Revenue", "100"],
              ["Loss", "-20"],
            ],
            cell_fills: {
              "0:0": "#1F3864",
              "0:1": "#1F3864",
              "1:1": "#E8F5E9",
              "2:1": "#FFEBEE",
            },
            cell_fonts: {
              "0:0": "#FFFFFF",
              B2: "#0000FF",
            },
          },
        ],
        output_name: "morgan_stanley_q2",
      },
      { prompt: "spreadsheet", hasSourceData: false }
    );

    assert.equal(plan.sheets?.length, 1);
    const sheet = plan.sheets![0]!;
    assert.deepEqual(sheet.headers, ["Item", "Amount"]);
    assert.equal(sheet.rows?.length, 2);
    assert.deepEqual(sheet.cell_fills, {
      "0:0": "#1F3864",
      "0:1": "#1F3864",
      "1:1": "#E8F5E9",
      "2:1": "#FFEBEE",
    });
    assert.deepEqual(sheet.cell_fonts, {
      "0:0": "#FFFFFF",
      "1:1": "#0000FF",
    });
    assert.equal(
      sheet.ops?.some((op) => op.op === "WRITE_DATA"),
      false,
      "fills path must not inject WRITE_DATA (would drop colors)"
    );
  });

  it("auto-fills when user asked for color coding and model omitted cell_fills", () => {
    assert.equal(
      wantsSpreadsheetColorCoding("color code it properly as an excel"),
      true
    );
    const plan = normalizeSpreadsheetPlan(
      {
        sheets: [
          {
            name: "Metrics",
            headers: ["Metric", "Change"],
            rows: [
              ["Revenue", "+27%"],
              ["Loss", "-5%"],
            ],
          },
        ],
      },
      {
        prompt: "Create an excel spreadsheet and color code it properly",
        hasSourceData: false,
      }
    );
    const fills = plan.sheets?.[0]?.cell_fills;
    assert.ok(fills);
    assert.equal(fills!["0:0"], "#1F3864");
    assert.equal(fills!["0:1"], "#1F3864");
    assert.ok(Object.keys(fills!).length > 2);
    assert.ok(plan.sheets?.[0]?.cell_fonts);
  });
});

describe("buildAutoCellFills", () => {
  it("tints headers and +/- cells with navy palette", () => {
    const fills = buildAutoCellFills(
      ["Metric", "YoY"],
      [
        ["Revenue", "+27%"],
        ["Costs", "-3%"],
      ]
    );
    assert.equal(fills["0:0"], "#1F3864");
    assert.equal(fills["1:1"], "#E8F5E9");
    assert.equal(fills["2:1"], "#FFEBEE");
  });
});

describe("repairMisalignedRow", () => {
  it("rejoins thousands-separator splits to header width", () => {
    const headers = ["Category", "Metric", "2Q 2026", "2Q 2025", "YOY"];
    const row = [
      "Net Revenues",
      "Total Net Revenues",
      "$21",
      "300",
      "$16",
      "800",
      "26.8%",
    ];
    assert.deepEqual(repairMisalignedRow(headers, row), [
      "Net Revenues",
      "Total Net Revenues",
      "$21,300",
      "$16,800",
      "26.8%",
    ]);
  });

  it("alignSheetRows applies repair across the sheet", () => {
    const headers = ["A", "B", "C"];
    const rows = alignSheetRows(headers, [
      ["x", "$2", "437", "extra"],
      ["y", "10", "20"],
    ]);
    assert.deepEqual(rows[0], ["x", "$2,437", "extra"]);
    assert.deepEqual(rows[1], ["y", "10", "20"]);
  });
});

describe("isNarrativeJunkSheet", () => {
  it("drops Sheet1 chat-prose dumps", async () => {
    const { isNarrativeJunkSheet, normalizeSpreadsheetPlan } = await import(
      "./spreadsheetPlan.js"
    );
    assert.equal(
      isNarrativeJunkSheet(
        "Sheet1",
        [
          "Based on the official Morgan Stanley Q2 2026 earnings release [1][2][3]",
          "here are the confirmed figures:",
        ],
        [
          ["- **Net Revenues**: $21.3B (+27% YoY from $16.8B)"],
          ["Now creating the color-coded Excel spreadsheet:"],
        ]
      ),
      true
    );

    const plan = normalizeSpreadsheetPlan(
      {
        sheets: [
          {
            name: "Sheet1",
            headers: [
              "Based on the official Morgan Stanley Q2 2026 earnings release [1]",
              "here are the confirmed figures:",
            ],
            rows: [
              ["- **Net Revenues**: $21.3B"],
              ["- **Net Income**: $5.58B"],
              ["Now creating the color-coded Excel spreadsheet:"],
            ],
          },
          {
            name: "Summary",
            headers: ["Metric", "2Q 2026"],
            rows: [["Net Revenues", "21.3"]],
          },
        ],
      },
      { prompt: "spreadsheet", hasSourceData: false }
    );
    assert.equal(plan.sheets?.length, 1);
    assert.equal(plan.sheets?.[0]?.name, "Summary");
  });
});
