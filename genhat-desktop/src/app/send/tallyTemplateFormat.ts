/**
 * Map an example Excel header row onto Tally export fields using an
 * explicit column_map only — no synonym / keyword guessing.
 */

export type TallyExportReport =
  | "daybook"
  | "trial_balance"
  | "outstanding"
  | "ledgers";

const REPORT_FIELDS: Record<TallyExportReport, readonly string[]> = {
  daybook: ["date", "month", "voucherType", "party", "amount", "narration"],
  trial_balance: ["name", "debit", "credit", "net", "parent"],
  outstanding: ["side", "name", "parent", "balance"],
  ledgers: ["name", "parent", "closingBalance"],
};

export function allowedFieldsForReport(report: TallyExportReport): ReadonlySet<string> {
  return new Set(REPORT_FIELDS[report]);
}

export type TemplateColumnMapping = {
  /** Headers exactly as in the example sheet (display order). */
  headers: string[];
  /** Parallel tally field keys (null = leave blank). */
  fields: Array<string | null>;
  /** Human-readable map lines for Summary. */
  notes: string[];
  mappedCount: number;
};

function resolveMappedField(
  header: string,
  allowed: ReadonlySet<string>,
  used: Set<string>,
  columnMap?: Record<string, string> | null
): string | null {
  if (!columnMap) return null;

  const direct = columnMap[header];
  if (typeof direct === "string") {
    const mapped = direct.trim();
    if (allowed.has(mapped) && !used.has(mapped)) return mapped;
  }

  // Exact header key match only (trim + case-insensitive on the map key).
  const headerKey = header.trim().toLowerCase();
  for (const [k, v] of Object.entries(columnMap)) {
    if (k.trim().toLowerCase() !== headerKey) continue;
    const mapped = String(v ?? "").trim();
    if (allowed.has(mapped) && !used.has(mapped)) return mapped;
  }
  return null;
}

/**
 * Build column mapping from template headers + required explicit map
 * (`{ "Party Name": "party" }`). No synonym / fuzzy header inference.
 */
export function mapTemplateHeaders(
  report: TallyExportReport,
  headers: string[],
  columnMap?: Record<string, string> | null
): TemplateColumnMapping {
  const allowed = allowedFieldsForReport(report);
  const used = new Set<string>();
  const fields: Array<string | null> = [];
  const notes: string[] = [];
  const cleanHeaders = headers.map((h) => String(h ?? "").trim());

  for (const header of cleanHeaders) {
    const field = resolveMappedField(header, allowed, used, columnMap);
    if (field) used.add(field);
    fields.push(field);
    notes.push(
      field
        ? `${header || "(blank)"} → ${field}`
        : `${header || "(blank)"} → (unmapped)`
    );
  }

  return {
    headers: cleanHeaders,
    fields,
    notes,
    mappedCount: fields.filter(Boolean).length,
  };
}

export function projectRecordsToTemplate(
  mapping: TemplateColumnMapping,
  records: Array<Record<string, unknown>>
): string[][] {
  return records.map((rec) =>
    mapping.fields.map((field) => {
      if (!field) return "";
      const v = rec[field];
      return v == null ? "" : String(v);
    })
  );
}

export function parseColumnMapArg(
  raw: unknown
): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && k.trim() && typeof v === "string" && v.trim()) {
      out[k.trim()] = v.trim();
    }
  }
  return Object.keys(out).length ? out : null;
}

export function isSpreadsheetPath(path: string): boolean {
  return /\.(xlsx|xls|csv)$/i.test(path.trim());
}

/** First sheet's header row from parseSpreadsheetData payload. */
export function headersFromParsedSpreadsheet(parsed: {
  sheet_name?: string;
  rows?: string[][];
  sheets?: Array<{ sheet_name: string; rows: string[][] }>;
}): { sheetName: string; headers: string[] } | null {
  const sheet =
    parsed.sheets && parsed.sheets.length > 0
      ? parsed.sheets[0]
      : parsed.rows && parsed.rows.length > 0
        ? { sheet_name: parsed.sheet_name || "Sheet1", rows: parsed.rows }
        : null;
  if (!sheet || !sheet.rows?.length) return null;
  const headers = (sheet.rows[0] ?? []).map((c) => String(c ?? "").trim());
  if (!headers.some((h) => h)) return null;
  return {
    sheetName: (sheet.sheet_name || "Data").slice(0, 31) || "Data",
    headers,
  };
}
