/**
 * Spreadsheet artifact plan helpers — prompts, data context, and post-processing.
 */

import {
  extractSpreadsheetPlanFallback,
  parseJsonCandidates,
} from "./artifactPlanJson";
import { deriveArtifactFilename } from "./artifactFilename";
import { NELA_NUMERICAL_ACCURACY_RULES } from "./nelaSystemPrompt";
import type { SpreadsheetOp, SpreadsheetPlan, SpreadsheetSheet } from "../types";

export interface SpreadsheetDataContext {
  headers?: string[];
  rows?: string[][];
  ambientContent?: string;
  /** Recent chat content was injected for the planner to assess for relevance. */
  hasConversationSource?: boolean;
}

/** Build the user-message data context block for spreadsheet plan generation. */
export function buildSpreadsheetDataContext(ctx: SpreadsheetDataContext): string {
  if (ctx.headers && ctx.headers.length > 0) {
    const sampleRows = (ctx.rows ?? []).slice(0, 5);
    const sampleLines = sampleRows
      .map((row, i) => {
        const pairs = row
          .map((cell, j) => `${ctx.headers![j] ?? `col${j}`}=${cell}`)
          .join(", ");
        return `  Row ${i + 1}: ${pairs}`;
      })
      .join("\n");

    return (
      `ATTACHED SOURCE DATA (injected automatically — do NOT duplicate with WRITE_DATA):\n` +
      `Columns: [${ctx.headers.join(", ")}]\n` +
      `Row count: ${ctx.rows?.length ?? 0}\n` +
      (sampleLines ? `Sample rows:\n${sampleLines}\n` : "") +
      `\nUse transform operations (SORT, FILTER, SUM_COLUMN, COUNT_BY_GROUP, AVERAGE_BY_GROUP, ADD_COLUMN, PIVOT) on this data.\n` +
      `Column names in every op must EXACTLY match the column names above.\n\n`
    );
  }

  if (ctx.ambientContent && ctx.ambientContent.trim().length > 0) {
    return (
      `SOURCE DOCUMENT (no structured table attached — extract tabular data from this):\n` +
      `${ctx.ambientContent}\n\n` +
      `You MUST include a WRITE_DATA operation as the FIRST op with:\n` +
      `- "headers": clear, human-readable column names derived from the document\n` +
      `- "rows": one row per logical record; every row must have the same number of cells as headers\n` +
      `Extract only information present in the source. Map fields to columns systematically (e.g. Field, Value pairs for form data).\n\n`
    );
  }

  if (ctx.hasConversationSource) {
    return (
      `A RECENT CHAT CONTEXT block is available above. Decide semantically whether the current request depends on it.\n` +
      `- If relevant: include WRITE_DATA as the first op, derive headers from that content, and transcribe its rows and values exactly. Do not invent, round, or substitute figures.\n` +
      `- If unrelated: ignore that block and generate the workbook solely from the current request.\n\n`
    );
  }

  return (
    `NO SOURCE DATA ATTACHED.\n` +
    `You MUST include a WRITE_DATA operation as the FIRST op with realistic headers and rows that fulfill the user request.\n\n`
  );
}

const MAX_SPREADSHEET_ROWS = 500;

/**
 * Detect an explicit row/list count in the user prompt (e.g. "top 10 movies").
 */
export function extractSpreadsheetRowCount(text: string): {
  count: number | null;
  explicit: boolean;
} {
  const lower = text.toLowerCase();

  const patterns = [
    /\btop\s+(\d{1,3})\b/,
    /\b(\d{1,3})\s+(?:best|top|greatest|biggest|leading)\s+/,
    /\b(\d{1,3})\s+(?:movies?|films?|shows?|songs?|books?|games?|items?|entries|rows?|records|companies|products|countries|cities|people|names)\b/,
    /\b(?:list|create|make|generate|build)\s+(?:of\s+)?(?:the\s+)?(?:top\s+)?(\d{1,3})\b/,
    /\bexactly\s+(\d{1,3})\b/,
    /\b(\d{1,3})\s+row(?:s)?\b/,
  ];

  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (!match) continue;
    const n = parseInt(match[1], 10);
    if (!Number.isNaN(n) && n > 0) {
      return {
        count: Math.min(MAX_SPREADSHEET_ROWS, n),
        explicit: true,
      };
    }
  }

  return { count: null, explicit: false };
}

/** Stable spreadsheet schema — cacheable across cloud artifact requests. */
export const SPREADSHEET_SCHEMA_STATIC = `You are a professional assistant that generates precise structural JSON plans for creating Excel spreadsheets.
You must return ONLY a JSON object conforming to the schema contract. Do NOT include markdown formatting, code fences (e.g. \`\`\`json), or thinking/explanations.

Preferred multi-sheet contract (USE THIS whenever the topic has distinct tables):
{"sheets":[{"name":"ShortTab","headers":["col1","col2"],"rows":[["v1","=B2-C2"],...],"cell_fills":{"0:0":"#1F3864","A1":"#1F3864","1:1":"#E8F5E9"},"cell_fonts":{"0:0":"#FFFFFF","B2":"#0000FF"}},{"name":"Legend","headers":["Element","Meaning"],"rows":[["Navy header","Column titles"],["Blue font","Hardcoded inputs"]]}],"output_name":"optional_filename_without_extension"}

Legacy single-sheet contract (only when one table is enough):
{"ops": [{"op": "SUM_COLUMN" | "AVERAGE_BY_GROUP" | "PIVOT" | "SORT_DESC" | "SORT_ASC" | "FILTER_ROWS" | "COUNT_BY_GROUP" | "ADD_COLUMN" | "RENAME_SHEET" | "WRITE_DATA" | "ADD_CHART", ...}], "output_name": "optional_filename_without_extension"}

Allowed Operations (inside a sheet's "ops", or top-level "ops" for single-sheet):
- SUM_COLUMN: { "col": "col_name", "label": "optional_label" } — adds a total row for a numeric column
- AVERAGE_BY_GROUP: { "value_col": "col_name", "group_col": "col_name" }
- PIVOT: { "row_col": "col_name", "col_col": "col_name", "value_col": "col_name" }
- SORT_DESC: { "col": "col_name" }
- SORT_ASC: { "col": "col_name" }
- FILTER_ROWS: { "col": "col_name", "value": "value_to_match" }
- COUNT_BY_GROUP: { "group_col": "col_name" }
- ADD_COLUMN: { "name": "new_col_name", "formula": "col_a + col_b" } — simple arithmetic using column names
- RENAME_SHEET: { "name": "sheet_name" } — short tab name only (max 31 characters, e.g. "Top Movies")
- WRITE_DATA: { "headers": ["col1", "col2"], "rows": [["v1", "v2"], ...] }
- ADD_CHART: { "chart_type": "column"|"bar"|"line"|"pie", "category_col": "col_name", "value_col": "optional_numeric_col", "title": "optional" }
  — embeds a native Excel chart. Omit value_col to count unique category values. Use for dashboards / analysis visuals.

Color coding / presentation:
- Prefer the sheets[] contract. Use cell_fills + cell_fonts for analyst-quality workbooks.
- Keys: "row:col" (0-based, header = row 0) or Excel A1. Colors: #RRGGBB or rgb().
- Palette: #1F3864 navy headers, #8EA9DB sections, #E8F5E9 gains, #FFEBEE losses; blue font #0000FF for inputs.
- Formula cells: strings starting with "=". Add a Legend sheet when color-coding.
- When present, fills/fonts are written into real .xlsx and survive Excel / LibreOffice.

Output rules:
- Include "output_name" (no extension) describing the spreadsheet topic.
- Prefer MULTIPLE sheets whenever the request covers distinct categories (e.g. Itinerary + Budget + Packing; Overview + Details; Sales + Inventory). Never cram unrelated tables into one sheet.
- Each sheet "name" must be a SHORT tab label (≤31 chars).
- For dashboards, analysis, or "chart/visualize" requests: include at least one ADD_CHART after the data is present.
- For document/form extraction, prefer columns like "Field" and "Value", or logical domain columns.
- When web search excerpts are provided, treat them as the only source of truth — never fabricate data not in those excerpts.
- Keep cell values as strings; numbers without currency symbols unless requested.

${NELA_NUMERICAL_ACCURACY_RULES}`;

export type SpreadsheetSystemParts = {
  cacheable: string;
  dynamic: string;
};

export type CloudSpreadsheetMode = "csv" | "json" | "local";

/** Cloud Smart/Deep: stream CSV inside a nela-artifact tag (no JSON ops plan). */
export const SPREADSHEET_CLOUD_CSV_STATIC = `You generate spreadsheet data as CSV wrapped in NELA artifact tags — one tag per Excel worksheet.

OUTPUT FORMAT (mandatory):
1. BEFORE any tag: 2–4 sentences explaining the workbook (plain text ONLY — never write the words "nela-artifact" outside the real tags).
2. Emit ONE OR MORE sheets. Each sheet is its own artifact tag:
   <nela-artifact type="text/csv" title="Short Sheet Title" filename="Short File Name">
   CSV header row
   CSV data rows…
   </nela-artifact>
3. Use a DIFFERENT short title (≤31 chars) for each sheet — these become Excel tab names.
4. On the FIRST tag only, set filename="…" to a short download name (no extension, no user-prompt paste). Example: filename="Andaman 5-Day Trip".
5. AFTER the last tag: 2–4 sentences summarizing sheets, columns, row coverage, and caveats.

MULTI-SHEET RULES (critical):
- When the topic has distinct tables, emit MULTIPLE <nela-artifact type="text/csv"> blocks (one per sheet).
  Examples: trip plan → Overview, Itinerary, Transport, Hotels, Activities, Budget; business → Overview, Revenue, Costs; research → Summary, Sources.
- Travel / trip / itinerary requests MUST be multi-sheet (Overview + Itinerary + Transport + Hotels + Activities + Budget). Never output only a flight-fare table.
- Name every sheet in your intro (“six tabs: …”), then emit that many tagged blocks — never describe multiple sheets and only output one.
- Web search tables are inputs, not the workbook. A fare scrape belongs on Transport only.
- Do NOT dump unrelated columns into a single mega-sheet when separate sheets would be clearer.
- A simple single-table request may use exactly one artifact tag.

NEVER write fake tags like **nela-artifact type="text/csv"** or nela-artifact without < >.

CSV RULES (per sheet):
- Use a real header row with clear column names.
- Include enough realistic data rows to fulfill the request (prefer ≥8 when listing items).
- Escape fields that contain commas by wrapping in double quotes.
- Do NOT return JSON ops plans (no WRITE_DATA, no {"ops":...}).
- Do NOT use markdown fences.
- When web excerpts are provided, treat them as source of truth — do not invent numbers not present.
- Stay on the USER'S TOPIC.
- TRAVEL / TRIP / LOGISTICS workbooks: prefer separate sheets such as Itinerary, Transport, Budget (and Packing when useful). Prefer columns like:
  Day, From, To, Mode (rental car / train / bus / taxi / walk), Operator or company, Duration, Distance, Est. cost, Booking notes, Source URL.
  Compare rental car vs trains/buses when relevant. Flights only as bookend rows unless the user asks for them.
- LINKS: Put every source URL in its own column named "Source URL" (or "Link") as a bare https://… URL with no surrounding text.
  Do not bury URLs inside Notes. Notes may say "see Source URL" but the clickable link must be the bare URL cell.
  Example: ...,"Day hike to Kolsai","https://example.com/kolsai"

${NELA_NUMERICAL_ACCURACY_RULES}
`;

export function buildSpreadsheetSystemParts(
  hasSourceData: boolean,
  rowCount?: number | null,
  options?: { cloudMode?: CloudSpreadsheetMode }
): SpreadsheetSystemParts {
  if (options?.cloudMode === "csv") {
    const rowRule =
      rowCount && rowCount > 0
        ? `Include EXACTLY ${rowCount} data rows (not counting the header).`
        : "Include a substantial number of data rows for the topic.";
    const dataRule = hasSourceData
      ? "Source table/document context may be attached — derive columns and values from it; do not invent conflicting numbers."
      : "No source table attached — invent plausible, topic-specific rows.";
    return {
      cacheable: SPREADSHEET_CLOUD_CSV_STATIC,
      dynamic: [rowRule, dataRule].filter(Boolean).join("\n"),
    };
  }

  const dataRules = hasSourceData
    ? `- Source data is already attached. Do NOT use WRITE_DATA to duplicate it.
- Use transform ops: SORT_ASC, SORT_DESC, FILTER_ROWS, SUM_COLUMN, COUNT_BY_GROUP, AVERAGE_BY_GROUP, ADD_COLUMN, PIVOT.
- Every "col", "group_col", "value_col", "row_col", "col_col" must EXACTLY match an attached column name.`
    : `- No source table is attached. Your FIRST op MUST be WRITE_DATA with complete "headers" and "rows".
- Populate rows from the source document context or from the user request. Do not leave rows empty.
- Use additional ops after WRITE_DATA only when needed (SORT, FILTER, RENAME_SHEET, etc.).`;

  const rowCountRule =
    rowCount && rowCount > 0
      ? `- The user requested EXACTLY ${rowCount} data rows in WRITE_DATA (not counting the header row).
- WRITE_DATA.rows MUST contain precisely ${rowCount} entries — do not stop at ${rowCount - 1}.
- Include a Rank or # column numbered 1 through ${rowCount} when listing ranked items.`
      : "";

  const dynamic = [
    "Data rules:",
    dataRules,
    rowCountRule ? `Row count rules:\n${rowCountRule}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { cacheable: SPREADSHEET_SCHEMA_STATIC, dynamic };
}

/** System prompt for spreadsheet synthesis plans. */
export function buildSpreadsheetSystemPrompt(
  hasSourceData: boolean,
  rowCount?: number | null
): string {
  const parts = buildSpreadsheetSystemParts(hasSourceData, rowCount);
  return `${parts.cacheable}\n\n${parts.dynamic}`;
}

function slugifySpreadsheetName(text: string): string {
  const slug = text
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return slug || "spreadsheet";
}

/** Excel worksheet names: max 31 chars; no \\ / * ? : [ ] */
export function sanitizeExcelSheetName(name: string): string {
  let cleaned = name.trim();
  const codeMatch = cleaned.match(/set_name\s*\(\s*["'](.+?)["']\s*\)/i);
  if (codeMatch) cleaned = codeMatch[1];
  cleaned = cleaned.replace(/^["']+|["']+$/g, "").trim();
  cleaned = cleaned.replace(/[\\/*?:[\]]/g, "_");
  const chars = [...cleaned];
  const truncated = chars.slice(0, 31).join("").trim();
  return truncated || "Sheet1";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? ""));
}

function asStringMatrix(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    // Model sometimes emits a CSV line string instead of a cell array.
    if (typeof row === "string") {
      return splitCsvAwareLine(row);
    }
    return asStringArray(row);
  });
}

/** Minimal CSV line split that respects double quotes. */
function splitCsvAwareLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Rejoin cells incorrectly split on thousands separators
 * (e.g. "$21","300" → "$21,300") when the row is wider than the header.
 */
export function repairMisalignedRow(
  headers: string[],
  row: string[]
): string[] {
  const width = headers.length;
  if (width <= 0) return row;
  const cells = [...row];
  let guard = 0;
  while (cells.length > width && guard++ < 64) {
    let merged = false;
    for (let i = 0; i < cells.length - 1; i++) {
      const a = cells[i] ?? "";
      const b = cells[i + 1] ?? "";
      if (looksLikeThousandSplit(a, b)) {
        cells.splice(i, 2, `${a},${b}`);
        merged = true;
        break;
      }
    }
    if (!merged) break;
  }
  while (cells.length < width) cells.push("");
  return cells.slice(0, width);
}

function looksLikeThousandSplit(left: string, right: string): boolean {
  const a = left.trim();
  const b = right.trim();
  // "$21" + "300" / "21" + "300" / "$(1" + "234)" style fragments
  if (!/^\(?\$?-?\d{1,3}$/.test(a)) return false;
  if (!/^\d{3}(\.\d+)?%?\)?$/.test(b)) return false;
  return true;
}

/** Align every data row to header width, repairing comma-split money values. */
export function alignSheetRows(
  headers: string[],
  rows: string[][]
): string[][] {
  const width = headers.length;
  if (width <= 0) return rows;
  return rows
    .map((row) => repairMisalignedRow(headers, row))
    .filter((row) => row.some((cell) => cell.trim().length > 0));
}

/**
 * True when a sheet looks like chat prose / markdown dumped into cells
 * (e.g. "Based on the official…", "- **Net Revenues**: …") rather than a table.
 */
export function isNarrativeJunkSheet(
  name: string,
  headers: string[],
  rows: string[][]
): boolean {
  const samples: string[] = [
    ...headers.map((h) => String(h ?? "")),
    ...rows.flatMap((r) => r.map((c) => String(c ?? ""))),
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  if (samples.length === 0) return true;

  const proseHits = samples.filter((s) =>
    /^(based on|here are|now creating|i('ll| will)|sure[,!]?\s|below is|- \*\*|^\*\*)/i.test(
      s
    ) ||
    /\[[0-9]+\]/.test(s) || // citation markers in a "header"
    (s.length > 80 && /\b(earnings|confirmed figures|spreadsheet)\b/i.test(s))
  ).length;

  const shortHeaders = headers.filter((h) => {
    const t = String(h ?? "").trim();
    return t.length > 0 && t.length <= 40 && !/\s{2,}/.test(t);
  });
  const looksLikeMarkdownList =
    rows.filter((r) => /^[-*•]\s/.test(String(r[0] ?? "").trim())).length >=
    Math.max(2, Math.floor(rows.length * 0.5));

  // Generic Sheet1/SheetN with mostly prose, or any sheet that is mostly bullets.
  const genericName = /^sheet\s*\d*$/i.test(name.trim());
  if (looksLikeMarkdownList) return true;
  if (genericName && proseHits >= 2) return true;
  if (proseHits >= 3 && shortHeaders.length <= 1) return true;
  // Header row itself is a sentence.
  if (
    headers.length <= 2 &&
    headers.some((h) => String(h).trim().length > 60)
  ) {
    return true;
  }
  return false;
}

/** Sanitize sparse cell color maps from model / tool JSON.
 * Accepts `"row:col"`, `"row,col"`, or Excel `"A1"` keys → `#RRGGBB`.
 * Colors: `#RGB`, `#RRGGBB`, `RRGGBB`, or `rgb(r,g,b)`.
 */
export function sanitizeCellFills(
  raw: unknown
): Record<string, string> | undefined {
  return sanitizeColorMap(raw);
}

/** Same key/color rules as cell_fills — used for font colors. */
export function sanitizeCellFonts(
  raw: unknown
): Record<string, string> | undefined {
  return sanitizeColorMap(raw);
}

function sanitizeColorMap(
  raw: unknown
): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const hex = parseFlexibleColor(v);
    if (!hex) continue;
    const key = normalizeCellKey(k);
    if (key) out[key] = hex;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Normalize a color string to `#RRGGBB` or null. */
export function parseFlexibleColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  const rgb = t.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgb) {
    const r = Math.min(255, Number(rgb[1]));
    const g = Math.min(255, Number(rgb[2]));
    const b = Math.min(255, Number(rgb[3]));
    if (![r, g, b].every((n) => Number.isFinite(n))) return null;
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }
  const hexMatch = t.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!hexMatch) return null;
  let h = hexMatch[1]!.toUpperCase();
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return `#${h}`;
}

function normalizeCellKey(raw: string): string | null {
  const key = raw.trim();
  if (/^\d+:\d+$/.test(key)) return key;
  const comma = key.match(/^(\d+)\s*[,;]\s*(\d+)$/);
  if (comma) return `${comma[1]}:${comma[2]}`;
  const a1 = excelA1ToRowCol(key);
  if (a1) return `${a1.r}:${a1.c}`;
  return null;
}

/** Excel A1 → 0-based row/col. */
export function excelA1ToRowCol(
  ref: string
): { r: number; c: number } | null {
  const m = ref.trim().match(/^([A-Za-z]+)(\d+)$/);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]!.toUpperCase()) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  const r = parseInt(m[2]!, 10) - 1;
  const c = col - 1;
  if (!Number.isFinite(r) || !Number.isFinite(c) || r < 0 || c < 0) return null;
  return { r, c };
}

/** True when the user asked for color coding / highlights on a spreadsheet. */
export function wantsSpreadsheetColorCoding(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    /\bcolou?r[\s-]?cod(?:e|ed|ing)?\b/i.test(t) ||
    /\b(conditional\s*format|heat\s*map|traffic\s*light)\b/i.test(t) ||
    /\b(with|add|use|apply|proper|nice|professional)\b[\s\S]{0,48}\bcolou?rs?\b/i.test(
      t
    ) ||
    /\bcolou?rs?\b[\s\S]{0,48}\b(code|coded|coding|highlight|sheet|excel|cells?|legend)\b/i.test(
      t
    ) ||
    /\bhighlight\b[\s\S]{0,40}\b(cells?|rows?|gains?|losses?|metrics?)\b/i.test(
      t
    ) ||
    /\blegend\b[\s\S]{0,40}\b(sheet|excel|color|colour)\b/i.test(t)
  );
}

function looksNegativeMetric(cell: string): boolean {
  const t = cell.trim();
  if (!t) return false;
  if (/^\(.*\)$/.test(t)) return true;
  if (/^-\s*[\d$€£¥%]/.test(t)) return true;
  if (/-\d/.test(t) && /%|bps|yoy|growth/i.test(t)) return true;
  return false;
}

function looksPositiveMetric(cell: string): boolean {
  const t = cell.trim();
  if (!t || looksNegativeMetric(t)) return false;
  if (/^\+\s*[\d$€£¥%]/.test(t)) return true;
  if (/\+\d/.test(t) && /%|bps|yoy|growth/i.test(t)) return true;
  if (/^(up|gain|beat|record|strong)\b/i.test(t)) return true;
  return false;
}

function looksSectionLabel(row: string[], width: number): boolean {
  const label = String(row[0] ?? "").trim();
  if (!label || label.length > 48) return false;
  // Section bands are label-only rows (no figures in other columns).
  let hasOtherContent = false;
  for (let c = 1; c < width; c++) {
    if (String(row[c] ?? "").trim()) {
      hasOtherContent = true;
      break;
    }
  }
  if (hasOtherContent) return false;
  if (
    /^(revenues?|expenses?|income|assets|liabilities|capital|segments?|notes?|totals?)\b/i.test(
      label
    )
  ) {
    return true;
  }
  return /:$/.test(label) || /^(net |total |operating )/i.test(label);
}

/**
 * Host-side presentable fills when the model omitted cell_fills but the user
 * asked for color coding. Navy header band + section tint + +/- heuristics.
 */
export function buildAutoCellFills(
  headers: string[],
  rows: string[][]
): Record<string, string> {
  const fills: Record<string, string> = {};
  const width = Math.max(
    headers.length,
    ...rows.map((r) => r.length),
    0
  );
  for (let c = 0; c < width; c++) {
    fills[`0:${c}`] = "#1F3864";
  }
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const zebra = r % 2 === 1;
    const section = looksSectionLabel(row, width);
    for (let c = 0; c < width; c++) {
      const key = `${r + 1}:${c}`;
      const cell = String(row[c] ?? "");
      if (section) fills[key] = "#8EA9DB";
      else if (looksNegativeMetric(cell)) fills[key] = "#FFEBEE";
      else if (looksPositiveMetric(cell)) fills[key] = "#E8F5E9";
      else if (zebra) fills[key] = "#F2F2F2";
    }
  }
  return fills;
}

/** White text on navy/section header bands when auto-filling. */
export function buildAutoCellFonts(
  headers: string[],
  rows: string[][],
  fills: Record<string, string>
): Record<string, string> {
  const fonts: Record<string, string> = {};
  const width = Math.max(
    headers.length,
    ...rows.map((r) => r.length),
    0
  );
  for (let c = 0; c < width; c++) {
    const key = `0:${c}`;
    if (fills[key]) fonts[key] = "#FFFFFF";
  }
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < width; c++) {
      const key = `${r + 1}:${c}`;
      const fill = fills[key];
      if (fill === "#8EA9DB" || fill === "#1F3864") fonts[key] = "#FFFFFF";
      else {
        const cell = String(rows[r]?.[c] ?? "").trim();
        // Hardcoded numeric inputs (not formulas) → blue font.
        if (
          cell &&
          !cell.startsWith("=") &&
          c > 0 &&
          /^-?[\d,.$€£¥]+(\.\d+)?%?$/.test(cell.replace(/[()\s]/g, ""))
        ) {
          fonts[key] = "#0000FF";
        }
      }
    }
  }
  return fonts;
}

function normalizeOp(raw: Record<string, unknown>): SpreadsheetOp | null {
  const op = String(raw.op ?? "").toUpperCase();
  if (!op) return null;

  switch (op) {
    case "SUM_COLUMN":
      return {
        op: "SUM_COLUMN",
        col: String(raw.col ?? ""),
        ...(raw.label != null ? { label: String(raw.label) } : {}),
      };
    case "AVERAGE_BY_GROUP":
      return {
        op: "AVERAGE_BY_GROUP",
        value_col: String(raw.value_col ?? ""),
        group_col: String(raw.group_col ?? ""),
      };
    case "PIVOT":
      return {
        op: "PIVOT",
        row_col: String(raw.row_col ?? ""),
        col_col: String(raw.col_col ?? ""),
        value_col: String(raw.value_col ?? ""),
      };
    case "SORT_DESC":
      return { op: "SORT_DESC", col: String(raw.col ?? "") };
    case "SORT_ASC":
      return { op: "SORT_ASC", col: String(raw.col ?? "") };
    case "FILTER_ROWS":
      return {
        op: "FILTER_ROWS",
        col: String(raw.col ?? ""),
        value: String(raw.value ?? ""),
      };
    case "COUNT_BY_GROUP":
      return { op: "COUNT_BY_GROUP", group_col: String(raw.group_col ?? "") };
    case "ADD_COLUMN":
      return {
        op: "ADD_COLUMN",
        name: String(raw.name ?? ""),
        formula: String(raw.formula ?? ""),
      };
    case "RENAME_SHEET":
      return {
        op: "RENAME_SHEET",
        name: sanitizeExcelSheetName(String(raw.name ?? "")),
      };
    case "WRITE_DATA":
      return {
        op: "WRITE_DATA",
        headers: asStringArray(raw.headers),
        rows: asStringMatrix(raw.rows),
      };
    case "ADD_CHART":
      return {
        op: "ADD_CHART",
        chart_type: String(raw.chart_type ?? "column"),
        category_col: String(raw.category_col ?? ""),
        ...(raw.value_col != null && String(raw.value_col).trim()
          ? { value_col: String(raw.value_col) }
          : {}),
        ...(raw.title != null ? { title: String(raw.title) } : {}),
      };
    default:
      return null;
  }
}

/** Normalize and validate a spreadsheet plan before sending to the Excel sidecar. */
export function normalizeSpreadsheetPlan(
  plan: Record<string, unknown>,
  options: {
    prompt: string;
    hasSourceData: boolean;
    expectedRowCount?: number | null;
    /** When true (or when prompt asks for color coding), fill missing cell_fills. */
    ensureColorFills?: boolean;
  }
): SpreadsheetPlan {
  const output_name = deriveArtifactFilename({
    llmName:
      (typeof plan.output_name === "string" && plan.output_name.trim()) ||
      (typeof plan.title === "string" && plan.title.trim()) ||
      null,
    topic: options.prompt,
    fallback: "spreadsheet",
  });
  const ensureColorFills =
    options.ensureColorFills === true ||
    wantsSpreadsheetColorCoding(options.prompt);

  // Preferred path: explicit sheets[] (cloud tool / multi-CSV / JSON multi-sheet).
  const rawSheets = Array.isArray(plan.sheets) ? plan.sheets : [];
  if (rawSheets.length > 0) {
    const sheets: SpreadsheetSheet[] = [];
    for (let i = 0; i < rawSheets.length; i++) {
      const item = rawSheets[i];
      if (!item || typeof item !== "object") continue;
      const raw = item as Record<string, unknown>;
      const name = sanitizeExcelSheetName(
        String(raw.name ?? raw.title ?? `Sheet${i + 1}`)
      );
      let headers = asStringArray(raw.headers);
      let cleanRows = asStringMatrix(raw.rows ?? raw.source_rows);
      let cell_fills = sanitizeCellFills(raw.cell_fills ?? raw.cellFills);
      let cell_fonts = sanitizeCellFonts(raw.cell_fonts ?? raw.cellFonts);
      const ops: SpreadsheetOp[] = Array.isArray(raw.ops)
        ? raw.ops
            .map((op) =>
              op && typeof op === "object"
                ? normalizeOp(op as Record<string, unknown>)
                : null
            )
            .filter((op): op is SpreadsheetOp => op !== null)
        : [];

      const width = headers.length;
      if (width > 0) {
        cleanRows = alignSheetRows(headers, cleanRows);
      }

      // Pull table out of WRITE_DATA when we need host-side fills.
      if (
        (!headers.length || ensureColorFills) &&
        ops.some((op) => op.op === "WRITE_DATA")
      ) {
        const write = ops.find((op) => op.op === "WRITE_DATA");
        if (write && write.op === "WRITE_DATA") {
          if (!headers.length) headers = write.headers;
          if (!cleanRows.length || ensureColorFills) {
            cleanRows = alignSheetRows(
              headers.length ? headers : write.headers,
              write.rows
            );
          }
        }
      }

      if (!options.hasSourceData) {
        const hasWrite = ops.some((op) => op.op === "WRITE_DATA");
        // Prefer bare headers/rows (preserves fills/fonts/formulas) over WRITE_DATA.
        if (hasWrite) {
          for (const op of ops) {
            if (op.op !== "WRITE_DATA") continue;
            op.rows = alignSheetRows(op.headers, op.rows);
          }
        }
      }

      if (ensureColorFills && !cell_fills && headers.length > 0) {
        cell_fills = buildAutoCellFills(headers, cleanRows);
      }
      if (ensureColorFills && cell_fills && !cell_fonts && headers.length > 0) {
        cell_fonts = buildAutoCellFonts(headers, cleanRows, cell_fills);
      }

      if (ops.length === 0 && headers.length === 0) continue;
      if (isNarrativeJunkSheet(name, headers, cleanRows)) continue;
      // Bare table whenever headers exist so rust_xlsxwriter applies styles once.
      const useBareTable = headers.length > 0;
      const sheetOps = useBareTable
        ? ops.filter((op) => op.op !== "WRITE_DATA")
        : ops;
      sheets.push({
        name,
        ...(useBareTable ? { headers, rows: cleanRows } : {}),
        ...(cell_fills ? { cell_fills } : {}),
        ...(cell_fonts ? { cell_fonts } : {}),
        ops: sheetOps,
      });
    }

    if (sheets.length > 0) {
      return { ops: [], sheets, output_name };
    }
  }

  const rawOps = Array.isArray(plan.ops) ? plan.ops : [];
  let ops: SpreadsheetOp[] = rawOps
    .map((item) =>
      item && typeof item === "object"
        ? normalizeOp(item as Record<string, unknown>)
        : null
    )
    .filter((op): op is SpreadsheetOp => op !== null);

  // Multiple WRITE_DATA ops → split into multiple sheets.
  const writeCount = ops.filter((op) => op.op === "WRITE_DATA").length;
  if (writeCount > 1 && !options.hasSourceData) {
    const sheets = splitOpsIntoSheets(ops);
    if (sheets.length > 1) {
      return { ops: [], sheets, output_name };
    }
  }

  if (options.hasSourceData) {
    ops = ops.filter((op) => op.op !== "WRITE_DATA");
  } else {
    const writeIdx = ops.findIndex((op) => op.op === "WRITE_DATA");
    if (writeIdx > 0) {
      const writeOp = ops[writeIdx];
      ops = [writeOp, ...ops.filter((_, i) => i !== writeIdx)];
    }
  }

  if (!options.hasSourceData) {
    const writeOp = ops.find((op) => op.op === "WRITE_DATA");
    if (writeOp && writeOp.op === "WRITE_DATA") {
      writeOp.rows = alignSheetRows(writeOp.headers, writeOp.rows);

      const expected = options.expectedRowCount;
      if (expected && expected > 0 && writeOp.rows.length < expected) {
        console.warn(
          `WRITE_DATA has ${writeOp.rows.length} data rows but ${expected} were requested.`
        );
      }
    }
  }

  const hasRename = ops.some((op) => op.op === "RENAME_SHEET");
  if (!hasRename) {
    ops.push({
      op: "RENAME_SHEET",
      name: sanitizeExcelSheetName(slugifySpreadsheetName(options.prompt)),
    });
  } else {
    for (const op of ops) {
      if (op.op === "RENAME_SHEET") {
        op.name = sanitizeExcelSheetName(op.name);
      }
    }
  }

  // Auto-embed a chart when the user asked for a dashboard / visualization.
  const wantsChart = /\b(dashboard|chart|visuali[sz]e|graph|plot)\b/i.test(
    options.prompt
  );
  if (wantsChart && !ops.some((op) => op.op === "ADD_CHART")) {
    const headers =
      (Array.isArray(plan.headers)
        ? plan.headers.map((h) => String(h ?? ""))
        : null) ??
      (ops.find((op) => op.op === "WRITE_DATA") as
        | Extract<SpreadsheetOp, { op: "WRITE_DATA" }>
        | undefined)?.headers ??
      [];
    if (headers.length >= 1) {
      const category_col = headers[0]!;
      const value_col =
        headers.find((h, i) => i > 0 && /revenue|sales|amount|value|count|total|score|price/i.test(h)) ??
        headers[1];
      ops.push({
        op: "ADD_CHART",
        chart_type: "column",
        category_col,
        ...(value_col ? { value_col } : {}),
        title: "Dashboard",
      });
    }
  }

  const normalized: SpreadsheetPlan = {
    ops,
    output_name,
  };

  if (options.hasSourceData && Array.isArray(plan.headers) && Array.isArray(plan.source_rows)) {
    normalized.headers = asStringArray(plan.headers);
    normalized.source_rows = asStringMatrix(plan.source_rows);
  }

  return normalized;
}

/** Split a flat ops list with multiple WRITE_DATA into workbook sheets. */
function splitOpsIntoSheets(ops: SpreadsheetOp[]): SpreadsheetSheet[] {
  const sheets: SpreadsheetSheet[] = [];
  let pendingName = "";
  let currentOps: SpreadsheetOp[] = [];
  let currentName = "Sheet1";

  const flush = () => {
    if (!currentOps.length) return;
    const write = currentOps.find((o) => o.op === "WRITE_DATA") as
      | Extract<SpreadsheetOp, { op: "WRITE_DATA" }>
      | undefined;
    sheets.push({
      name: sanitizeExcelSheetName(currentName || `Sheet${sheets.length + 1}`),
      ...(write
        ? { headers: write.headers, rows: write.rows }
        : {}),
      ops: currentOps.filter((o) => o.op !== "RENAME_SHEET"),
    });
    currentOps = [];
    currentName = `Sheet${sheets.length + 1}`;
  };

  for (const op of ops) {
    if (op.op === "RENAME_SHEET") {
      if (currentOps.length === 0) {
        currentName = op.name;
      } else {
        pendingName = op.name;
      }
      continue;
    }
    if (op.op === "WRITE_DATA" && currentOps.some((o) => o.op === "WRITE_DATA")) {
      flush();
      if (pendingName) {
        currentName = pendingName;
        pendingName = "";
      }
    }
    currentOps.push(op);
  }
  flush();
  return sheets;
}

/** Estimate plan token budget from expected WRITE_DATA size. */
export function spreadsheetPlanMaxTokens(
  hasSourceData: boolean,
  ambientContent?: string,
  rowCount?: number | null
): number {
  if (hasSourceData) return 800;
  const ambientLen = ambientContent?.length ?? 0;
  if (rowCount && rowCount > 0) {
    return Math.min(2048, 512 + rowCount * 180);
  }
  if (ambientLen > 6000) return 2048;
  if (ambientLen > 2000) return 1536;
  return 1200;
}

/**
 * Extract Field/Value rows from unstructured document text (PDF forms, onboarding docs).
 * Used when the model fails to emit valid WRITE_DATA JSON.
 */
export function extractFieldValueRowsFromText(text: string): {
  headers: string[];
  rows: string[][];
} {
  const headers = ["Field", "Value"];
  const rows: string[][] = [];
  const seen = new Set<string>();

  const pushRow = (field: string, value: string) => {
    const f = field.replace(/\s+/g, " ").trim();
    const v = value.replace(/\s+/g, " ").trim();
    if (!f || !v || f === v) return;
    const key = `${f}\0${v}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push([f, v]);
  };

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const metadataValues = new Set([
    "yes",
    "no",
    "primary",
    "private",
    "public was private",
    "usage",
    "visibility",
    "wa",
    "s",
  ]);

  const isNoise = (line: string): boolean => {
    const lower = line.toLowerCase().trim();
    if (!lower || lower.length <= 1) return true;
    if (metadataValues.has(lower)) return true;
    if (/privacy statement|dentsu\.com/i.test(line)) return true;
    if (/^tasks to complete/i.test(line)) return true;
    if (/^you can access/i.test(line)) return true;
    if (/^-- \d+ of \d+ --$/i.test(line)) return true;
    if (/page \d+ of \d+/i.test(line)) return true;
    if (/^\(\d+\)$/.test(line)) return true;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}page/i.test(lower)) return true;
    return false;
  };

  const isSectionHeader = (line: string): boolean =>
    /^(change home contact information|change personal information|place of birth|nationality|health|last medical exam)$/i.test(
      line.trim()
    );

  const findLabelBefore = (index: number): string | null => {
    for (let j = index - 1; j >= 0 && j >= index - 12; j--) {
      const candidate = lines[j];
      if (isNoise(candidate) || isSectionHeader(candidate)) continue;
      if (candidate.length > 80) continue;
      return candidate;
    }
    return null;
  };

  // Pass 1: "value added" markers (common in HR onboarding exports).
  for (let i = 0; i < lines.length; i++) {
    const addedMatch = lines[i].match(/^(.+?)\s+added$/i);
    if (!addedMatch) continue;
    const value = addedMatch[1].trim();
    const field = findLabelBefore(i);
    if (field) pushRow(field, value);
  }

  // Pass 2: consecutive label → value pairs.
  for (let i = 0; i < lines.length - 1; i++) {
    if (isNoise(lines[i]) || isNoise(lines[i + 1])) continue;
    if (isSectionHeader(lines[i])) continue;
    if (/\s+added$/i.test(lines[i + 1])) continue;

    const field = lines[i];
    let value = lines[i + 1];

    // Skip repeated header lines before the value (e.g. "Legal Name" x3 then value).
    if (value === field && i + 2 < lines.length) {
      value = lines[i + 2];
      i += 2;
    } else {
      i += 1;
    }

    if (isNoise(value) || isSectionHeader(value)) continue;
    pushRow(field, value);
  }

  return { headers, rows };
}

export interface SpreadsheetPlanParseFallback {
  prompt: string;
  hasSourceData: boolean;
  ambientContent?: string;
}

function buildWriteDataFromText(text: string): Record<string, unknown> | null {
  const extracted = extractFieldValueRowsFromText(text);
  if (extracted.rows.length === 0) return null;
  return {
    ops: [
      {
        op: "WRITE_DATA",
        headers: extracted.headers,
        rows: extracted.rows,
      },
    ],
  };
}

function spreadsheetPlanFromAmbient(
  fallback: SpreadsheetPlanParseFallback
): Record<string, unknown> | null {
  if (fallback.ambientContent?.trim()) {
    const plan = buildWriteDataFromText(fallback.ambientContent);
    if (plan) return plan;
  }
  return null;
}

export function buildSpreadsheetFallbackPlan(
  fallback: SpreadsheetPlanParseFallback
): Record<string, unknown> | null {
  if (fallback.hasSourceData) {
    return { ops: [] };
  }
  return spreadsheetPlanFromAmbient(fallback);
}

/**
 * Parse a spreadsheet plan — tries JSON, salvages partial ops, then falls back
 * to attached source data or document field extraction. Never leaves the caller
 * without a plan when any text source is available.
 */
export function parseSpreadsheetPlanJson(
  raw: string,
  fallback: SpreadsheetPlanParseFallback
): Record<string, unknown> {
  if (!raw.trim()) {
    if (fallback.hasSourceData) {
      console.warn("Spreadsheet plan empty; using attached source data only.");
      return { ops: [] };
    }
    const ambient = spreadsheetPlanFromAmbient(fallback);
    if (ambient) return ambient;
    throw new Error("Model produced no output for spreadsheet plan.");
  }

  const direct = parseJsonCandidates(raw);
  if (direct && Array.isArray(direct.ops) && direct.ops.length > 0) {
    return direct;
  }
  if (direct && fallback.hasSourceData) {
    return direct;
  }

  const salvaged = extractSpreadsheetPlanFallback(raw);
  if (salvaged) return salvaged;

  if (fallback.hasSourceData) {
    console.warn(
      "Spreadsheet plan JSON parse failed; using attached source data only. Output preview:",
      raw.slice(0, 400)
    );
    return { ops: [] };
  }

  const ambient = spreadsheetPlanFromAmbient(fallback);
  if (ambient) {
    console.warn(
      "Spreadsheet plan JSON parse failed; built WRITE_DATA from document text. Output preview:",
      raw.slice(0, 400)
    );
    return ambient;
  }

  if (direct) return direct;

  // Last resort: try field extraction on whatever the model did output.
  const fromRaw = buildWriteDataFromText(raw);
  if (fromRaw) {
    console.warn(
      "Spreadsheet plan salvage from raw model text. Preview:",
      raw.slice(0, 400)
    );
    return fromRaw;
  }

  console.error(
    "Spreadsheet plan parse failed with no document fallback. Model output:",
    raw.slice(0, 800)
  );
  throw new Error("No valid JSON object found in model output.");
}
