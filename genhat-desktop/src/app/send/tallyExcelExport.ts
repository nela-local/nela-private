/**
 * Host-side Tally → multi-sheet Excel workbook (Raw + Pivot + Summary).
 */

import { Api } from "../../api";
import type { SpreadsheetSheet } from "../../types";
import {
  computeCrosstab,
  defaultPivotForReport,
  tallyMonthKey,
  validatePivotSpec,
  type PivotAggregation,
  type PivotSpec,
} from "./tallyPivot";
import {
  headersFromParsedSpreadsheet,
  isSpreadsheetPath,
  mapTemplateHeaders,
  parseColumnMapArg,
  projectRecordsToTemplate,
  type TemplateColumnMapping,
  type TallyExportReport,
} from "./tallyTemplateFormat";

export type { TallyExportReport };

export const TALLY_EXPORT_MAX_ROWS = 2000;

export type TallyExportArgs = {
  report: TallyExportReport;
  fromDate?: string | null;
  toDate?: string | null;
  voucherType?: string | null;
  group?: string | null;
  title?: string | null;
  pivot?: PivotSpec | null;
  /** When false, skip Raw sheet (still write Pivot + Summary). Default true. */
  includeRaw?: boolean;
  maxRows?: number;
  /** Absolute path to an example .xlsx/.csv to match column layout. */
  templatePath?: string | null;
  /** Explicit template headers (skips reading file header row). */
  templateHeaders?: string[] | null;
  /** Template sheet tab name when headers are provided without a file. */
  templateSheetName?: string | null;
  /** Map example header → Tally field (e.g. { "Party Name": "party" }). */
  columnMap?: Record<string, string> | null;
  /**
   * When true (default if template path/headers present), emit a Data sheet
   * matching the example headers instead of the default Raw layout.
   */
  matchTemplate?: boolean;
};

export type TallyExportBuildResult = {
  ok: true;
  title: string;
  sheets: SpreadsheetSheet[];
  company: string | null;
  truncated: boolean;
  rowCount: number;
  report: TallyExportReport;
  pivotApplied: PivotSpec | null;
  templateMatched: boolean;
  templateMappingNotes: string[];
};

function asReport(raw: unknown): TallyExportReport | null {
  if (raw === "daybook" || raw === "day_book") return "daybook";
  if (raw === "trial_balance" || raw === "trialBalance") return "trial_balance";
  if (raw === "outstanding") return "outstanding";
  if (raw === "ledgers" || raw === "list_ledgers") return "ledgers";
  return null;
}

function parsePivotArg(raw: unknown): PivotSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rows = typeof o.rows === "string" ? o.rows.trim() : "";
  const values = typeof o.values === "string" ? o.values.trim() : "";
  if (!rows || !values) return null;
  const columns =
    typeof o.columns === "string" && o.columns.trim()
      ? o.columns.trim()
      : typeof o.cols === "string" && o.cols.trim()
        ? o.cols.trim()
        : null;
  const aggRaw = typeof o.aggregation === "string" ? o.aggregation.trim().toLowerCase() : "sum";
  const aggregation: PivotAggregation =
    aggRaw === "count" || aggRaw === "avg" || aggRaw === "average"
      ? aggRaw === "average"
        ? "avg"
        : aggRaw
      : "sum";
  return { rows, columns, values, aggregation };
}

export function parseTallyExportArgs(
  args: Record<string, unknown>
): { ok: true; value: TallyExportArgs } | { ok: false; error: string } {
  const report = asReport(args.report ?? args.kind ?? args.focus);
  if (!report) {
    return {
      ok: false,
      error:
        "report is required: daybook | trial_balance | outstanding | ledgers",
    };
  }
  const fromDate =
    (typeof args.from_date === "string" && args.from_date.trim()) ||
    (typeof args.fromDate === "string" && args.fromDate.trim()) ||
    null;
  const toDate =
    (typeof args.to_date === "string" && args.to_date.trim()) ||
    (typeof args.toDate === "string" && args.toDate.trim()) ||
    null;
  const voucherType =
    (typeof args.voucher_type === "string" && args.voucher_type.trim()) ||
    (typeof args.voucherType === "string" && args.voucherType.trim()) ||
    null;
  const group =
    (typeof args.group === "string" && args.group.trim()) ||
    (typeof args.parent === "string" && args.parent.trim()) ||
    null;
  const title =
    (typeof args.title === "string" && args.title.trim()) ||
    (typeof args.output_name === "string" && args.output_name.trim()) ||
    null;
  let maxRows = TALLY_EXPORT_MAX_ROWS;
  const maxRaw = args.max_rows ?? args.maxRows;
  if (typeof maxRaw === "number" && Number.isFinite(maxRaw)) {
    maxRows = Math.max(1, Math.min(TALLY_EXPORT_MAX_ROWS, Math.floor(maxRaw)));
  } else if (typeof maxRaw === "string" && maxRaw.trim()) {
    const n = Number.parseInt(maxRaw, 10);
    if (Number.isFinite(n)) {
      maxRows = Math.max(1, Math.min(TALLY_EXPORT_MAX_ROWS, n));
    }
  }
  const pivot = parsePivotArg(args.pivot);
  const templatePath =
    (typeof args.template_path === "string" && args.template_path.trim()) ||
    (typeof args.templatePath === "string" && args.templatePath.trim()) ||
    (typeof args.example_path === "string" && args.example_path.trim()) ||
    null;
  let templateHeaders: string[] | null = null;
  const thRaw = args.template_headers ?? args.templateHeaders;
  if (Array.isArray(thRaw) && thRaw.length > 0) {
    templateHeaders = thRaw.map((h) =>
      typeof h === "string" ? h.trim() : String(h ?? "").trim()
    );
  }
  const templateSheetName =
    (typeof args.template_sheet_name === "string" && args.template_sheet_name.trim()) ||
    (typeof args.templateSheetName === "string" && args.templateSheetName.trim()) ||
    null;
  const columnMap = parseColumnMapArg(args.column_map ?? args.columnMap);
  const matchTemplateExplicit =
    args.match_template === true ||
    args.matchTemplate === true ||
    args.match_format === true;
  const matchTemplate =
    matchTemplateExplicit || Boolean(templatePath) || Boolean(templateHeaders);
  // Default: include Raw unless matching a template (then only Data + Summary).
  let includeRaw = !matchTemplate;
  if (args.include_raw === false || args.includeRaw === false) includeRaw = false;
  if (args.include_raw === true || args.includeRaw === true) includeRaw = true;
  return {
    ok: true,
    value: {
      report,
      fromDate,
      toDate,
      voucherType,
      group,
      title,
      pivot,
      includeRaw,
      maxRows,
      templatePath,
      templateHeaders,
      templateSheetName,
      columnMap,
      matchTemplate,
    },
  };
}

function displayHeaders(keys: string[]): string[] {
  return keys.map((k) => {
    switch (k) {
      case "voucherType":
        return "Voucher Type";
      case "closingBalance":
        return "Closing Balance";
      default:
        return k.charAt(0).toUpperCase() + k.slice(1);
    }
  });
}

function recordsToSheet(
  name: string,
  keys: string[],
  records: Array<Record<string, unknown>>
): SpreadsheetSheet {
  const headers = displayHeaders(keys);
  const rows = records.map((r) =>
    keys.map((k) => {
      const v = r[k];
      if (v == null) return "";
      return String(v);
    })
  );
  return { name, headers, rows, ops: [] };
}

function summarySheet(meta: {
  report: string;
  company: string | null;
  fromDate: string | null;
  toDate: string | null;
  rowCount: number;
  truncated: boolean;
  pivot: PivotSpec | null;
  templatePath?: string | null;
  mappingNotes?: string[];
}): SpreadsheetSheet {
  const lines: string[][] = [
    ["Field", "Value"],
    ["Report", meta.report],
    ["Company", meta.company ?? ""],
    ["From", meta.fromDate ?? ""],
    ["To", meta.toDate ?? ""],
    ["Raw rows", String(meta.rowCount)],
    ["Truncated", meta.truncated ? "yes" : "no"],
  ];
  if (meta.templatePath) {
    lines.push(["Template", meta.templatePath]);
  }
  if (meta.mappingNotes && meta.mappingNotes.length) {
    lines.push(["Column map", meta.mappingNotes.join("; ")]);
  }
  if (meta.pivot) {
    lines.push([
      "Pivot",
      `${meta.pivot.rows}${meta.pivot.columns ? ` × ${meta.pivot.columns}` : ""} / ${meta.pivot.aggregation ?? "sum"}(${meta.pivot.values})`,
    ]);
  }
  if (meta.truncated) {
    lines.push([
      "Note",
      "Export hit the row cap — results may be incomplete. Narrow the date range or filters.",
    ]);
  }
  return {
    name: "Summary",
    headers: lines[0],
    rows: lines.slice(1),
    ops: [],
  };
}

export async function resolveExportTemplate(
  args: TallyExportArgs,
  fallbackPaths?: string[] | null
): Promise<
  | {
      ok: true;
      sheetName: string;
      mapping: TemplateColumnMapping;
      templatePath: string | null;
    }
  | { ok: false; error: string }
  | null
> {
  if (!args.matchTemplate) return null;

  let headers = args.templateHeaders ?? null;
  let sheetName = args.templateSheetName?.trim() || "Data";
  let templatePath = args.templatePath?.trim() || null;

  if (!headers) {
    if (!templatePath && fallbackPaths?.length) {
      templatePath =
        fallbackPaths.find((p) => isSpreadsheetPath(p)) ?? null;
    }
    if (!templatePath) {
      return {
        ok: false,
        error:
          "match_template requires template_path (attached .xlsx/.csv) or template_headers.",
      };
    }
    try {
      const parsed = await Api.parseSpreadsheetData(templatePath, 5);
      const extracted = headersFromParsedSpreadsheet(parsed);
      if (!extracted) {
        return {
          ok: false,
          error: `Could not read header row from template: ${templatePath}`,
        };
      }
      headers = extracted.headers;
      sheetName = extracted.sheetName;
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  if (!args.columnMap || Object.keys(args.columnMap).length === 0) {
    return {
      ok: false,
      error:
        "match_template requires column_map (example header → Tally field). Automatic header guessing is disabled.",
    };
  }

  const mapping = mapTemplateHeaders(args.report, headers, args.columnMap);
  if (mapping.mappedCount === 0) {
    return {
      ok: false,
      error:
        "column_map did not map any template headers to valid Tally fields for this report.",
    };
  }
  return { ok: true, sheetName, mapping, templatePath };
}

async function fetchFlat(
  args: TallyExportArgs
): Promise<{
  keys: string[];
  records: Array<Record<string, unknown>>;
  company: string | null;
  truncated: boolean;
  fromDate: string | null;
  toDate: string | null;
  error?: string;
}> {
  const maxRows = args.maxRows ?? TALLY_EXPORT_MAX_ROWS;
  switch (args.report) {
    case "daybook": {
      const res = await Api.tallyDaybook({
        fromDate: args.fromDate,
        toDate: args.toDate,
        voucherType: args.voucherType,
        maxRows,
      });
      if (!res.ok) {
        return {
          keys: [],
          records: [],
          company: res.company ?? null,
          truncated: false,
          fromDate: args.fromDate ?? null,
          toDate: args.toDate ?? null,
          error: res.error ?? "Day book export failed.",
        };
      }
      const keys = ["date", "month", "voucherType", "party", "amount", "narration"];
      const records = (res.lines ?? []).map((l) => ({
        date: l.date ?? "",
        month: tallyMonthKey(l.date),
        voucherType: l.voucherType ?? "",
        party: l.party ?? "",
        amount: l.amount ?? "",
        narration: l.narration ?? "",
      }));
      return {
        keys,
        records,
        company: res.company ?? null,
        truncated: Boolean(res.truncated),
        fromDate: res.fromDate ?? args.fromDate ?? null,
        toDate: res.toDate ?? args.toDate ?? null,
      };
    }
    case "trial_balance": {
      const res = await Api.tallyTrialBalance({
        fromDate: args.fromDate,
        toDate: args.toDate,
        maxRows,
      });
      if (!res.ok) {
        return {
          keys: [],
          records: [],
          company: res.company ?? null,
          truncated: false,
          fromDate: args.fromDate ?? null,
          toDate: args.toDate ?? null,
          error: res.error ?? "Trial balance export failed.",
        };
      }
      const keys = ["name", "debit", "credit", "net", "parent"];
      const records = (res.rows ?? []).map((r) => ({
        name: r.name,
        debit: r.debit ?? "",
        credit: r.credit ?? "",
        net: r.closingBalance ?? "",
        parent: r.parent ?? "",
      }));
      return {
        keys,
        records,
        company: res.company ?? null,
        truncated: Boolean(res.truncated),
        fromDate: res.fromDate ?? args.fromDate ?? null,
        toDate: res.toDate ?? args.toDate ?? null,
        error: res.error && records.length === 0 ? res.error : undefined,
      };
    }
    case "outstanding": {
      const res = await Api.tallyOutstanding({ maxRows });
      if (!res.ok) {
        return {
          keys: [],
          records: [],
          company: res.company ?? null,
          truncated: false,
          fromDate: null,
          toDate: null,
          error: res.error ?? "Outstanding export failed.",
        };
      }
      const keys = ["side", "name", "parent", "balance"];
      const recv = (res.receivables?.ledgers ?? []).map((l) => ({
        side: "Receivable",
        name: l.name,
        parent: l.parent ?? res.receivables?.group ?? "Sundry Debtors",
        balance: l.closingBalance ?? "",
      }));
      const pay = (res.payables?.ledgers ?? []).map((l) => ({
        side: "Payable",
        name: l.name,
        parent: l.parent ?? res.payables?.group ?? "Sundry Creditors",
        balance: l.closingBalance ?? "",
      }));
      const records = [...recv, ...pay];
      const truncated =
        (res.receivables?.ledgers?.length ?? 0) >= maxRows ||
        (res.payables?.ledgers?.length ?? 0) >= maxRows;
      return {
        keys,
        records,
        company: res.company ?? null,
        truncated,
        fromDate: null,
        toDate: null,
      };
    }
    case "ledgers": {
      const res = await Api.tallyListLedgers({
        group: args.group,
        maxRows,
      });
      if (!res.ok) {
        return {
          keys: [],
          records: [],
          company: res.company ?? null,
          truncated: false,
          fromDate: null,
          toDate: null,
          error: res.error ?? "Ledger export failed.",
        };
      }
      const keys = ["name", "parent", "closingBalance"];
      const records = (res.ledgers ?? []).map((l) => ({
        name: l.name,
        parent: l.parent ?? "",
        closingBalance: l.closingBalance ?? "",
      }));
      return {
        keys,
        records,
        company: res.company ?? null,
        truncated: Boolean(res.truncated),
        fromDate: null,
        toDate: null,
      };
    }
  }
}

export async function buildTallyExcelWorkbook(
  args: TallyExportArgs,
  options?: { fallbackTemplatePaths?: string[] | null }
): Promise<TallyExportBuildResult | { ok: false; error: string }> {
  const template = await resolveExportTemplate(
    args,
    options?.fallbackTemplatePaths
  );
  if (template && template.ok === false) {
    return { ok: false, error: template.error };
  }

  const fetched = await fetchFlat(args);
  if (fetched.error && fetched.records.length === 0) {
    return { ok: false, error: fetched.error };
  }

  const matchingTemplate = Boolean(template && template.ok);
  // When matching an example file, only add Pivot if the model asked for one.
  let pivotSpec: PivotSpec | null = matchingTemplate
    ? args.pivot ?? null
    : args.pivot ?? defaultPivotForReport(args.report);

  if (pivotSpec) {
    const invalid = validatePivotSpec(args.report, pivotSpec);
    if (invalid) {
      const fallback = defaultPivotForReport(args.report);
      if (fallback && !validatePivotSpec(args.report, fallback)) {
        pivotSpec = fallback;
      } else {
        return { ok: false, error: invalid };
      }
    }
  }

  const sheets: SpreadsheetSheet[] = [];
  let mappingNotes: string[] = [];

    if (matchingTemplate && template && template.ok) {
    mappingNotes = template.mapping.notes;
    sheets.push({
      name: template.sheetName.slice(0, 31) || "Data",
      headers: template.mapping.headers,
      rows: projectRecordsToTemplate(template.mapping, fetched.records),
      ops: [],
    });
    if (args.includeRaw) {
      sheets.push(recordsToSheet("Raw", fetched.keys, fetched.records));
    }
  } else if (args.includeRaw !== false) {
    sheets.push(recordsToSheet("Raw", fetched.keys, fetched.records));
  }

  if (pivotSpec) {
    const matrix = computeCrosstab(fetched.records, pivotSpec);
    sheets.push({
      name: "Pivot",
      headers: matrix.headers,
      rows: matrix.rows,
      ops: [],
    });
  }
  sheets.push(
    summarySheet({
      report: args.report,
      company: fetched.company,
      fromDate: fetched.fromDate,
      toDate: fetched.toDate,
      rowCount: fetched.records.length,
      truncated: fetched.truncated,
      pivot: pivotSpec,
      templatePath: matchingTemplate && template && template.ok ? template.templatePath : null,
      mappingNotes,
    })
  );

  const title =
    args.title?.trim() ||
    `Tally ${args.report.replace(/_/g, " ")} export`;

  return {
    ok: true,
    title,
    sheets,
    company: fetched.company,
    truncated: fetched.truncated,
    rowCount: fetched.records.length,
    report: args.report,
    pivotApplied: pivotSpec,
    templateMatched: matchingTemplate,
    templateMappingNotes: mappingNotes,
  };
}
