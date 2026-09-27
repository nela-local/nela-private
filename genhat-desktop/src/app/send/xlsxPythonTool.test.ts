import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MCP_CLOUD_TOOLS,
  MCP_XLSX_PYTHON_TOOL,
  MCP_SPREADSHEET_TOOL,
} from "./cloudTools.js";
import { ARTIFACT_CREATING_TOOLS } from "../cloudPresentationMode.js";

describe("run_xlsx_python tool wiring", () => {
  it("is exported and included in MCP cloud tools", () => {
    assert.equal(MCP_XLSX_PYTHON_TOOL.function.name, "run_xlsx_python");
    assert.ok(
      MCP_CLOUD_TOOLS.some((t) => t.function.name === "run_xlsx_python")
    );
    assert.ok(
      MCP_CLOUD_TOOLS.some((t) => t.function.name === "generate_spreadsheet")
    );
    assert.ok(ARTIFACT_CREATING_TOOLS.has("run_xlsx_python"));
  });

  it("prefers openpyxl for rich workbooks in tool descriptions", () => {
    const xlsxDesc = MCP_XLSX_PYTHON_TOOL.function.description ?? "";
    const sheetDesc = MCP_SPREADSHEET_TOOL.function.description ?? "";
    assert.match(xlsxDesc, /openpyxl/i);
    assert.match(xlsxDesc, /NELA_XLSX_OUT/);
    assert.match(xlsxDesc, /LibreOffice|formula_errors|Python sandbox/i);
    assert.match(xlsxDesc, /2 decimal|0\.00/i);
    assert.match(sheetDesc, /run_xlsx_python/);
  });
});
