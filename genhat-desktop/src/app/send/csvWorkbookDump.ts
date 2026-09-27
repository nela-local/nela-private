/**
 * Detect and salvage when the model pastes a multi-sheet CSV workbook into chat
 * instead of calling generate_spreadsheet.
 */

import { parseCSV } from "./csvParse";
import { wantsNewSpreadsheetArtifact } from "../spreadsheetDashboardIntent";
import { sanitizeExcelSheetName } from "../spreadsheetPlan";

const EXCEL_INTENT_RE =
  /\b(excel|spreadsheet|xlsx|workbook|color[\s-]?cod(?:e|ed|ing)|colour[\s-]?cod(?:e|ed|ing))\b/i;

const CREATE_OR_DELIVER_RE =
  /\b(create|make|build|generate|write|give me|show me|produce|export|download|prepare|color[\s-]?code|colour[\s-]?code)\b/i;

/** True when the user asked for a downloadable Excel / spreadsheet artifact. */
export function userAskedForSpreadsheetArtifact(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (wantsNewSpreadsheetArtifact(t)) return true;
  // Broader: "color code excel" / "morgan stanley finances in excel" without a strong create verb.
  return EXCEL_INTENT_RE.test(t) && (CREATE_OR_DELIVER_RE.test(t) || /\bfinances?\b/i.test(t));
}

/** Extract fenced ```csv``` / ``` bodies, or the whole text if it looks like CSV. */
export function extractCsvDumpBodies(text: string): string[] {
  const bodies: string[] = [];
  const fenceRe = /```(?:csv|CSV|tsv)?\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    const body = (m[1] || "").trim();
    if (body) bodies.push(body);
  }
  if (bodies.length > 0) return bodies;
  const trimmed = text.trim();
  if (looksLikeRawCsvWorkbook(trimmed)) return [trimmed];
  return [];
}

function looksLikeRawCsvWorkbook(text: string): boolean {
  if (!text || text.length < 40) return false;
  const sheetMarkers = text.match(/["']?Sheet\s*\d+\s*:/gi) ?? [];
  if (sheetMarkers.length >= 2) return true;
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const csvish = lines.filter((l) => countUnquotedCommas(l) >= 1).length;
  return csvish >= 4 && /["']?[A-Za-z][^,"\n]{0,40}["']?\s*,/.test(text);
}

function countUnquotedCommas(line: string): number {
  let n = 0;
  let inQuotes = false;
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (c === "," && !inQuotes) n += 1;
  }
  return n;
}

/**
 * True when the assistant message looks like a multi-sheet CSV workbook dump
 * (fenced csv, SheetN: markers, or dense quoted CSV rows) rather than prose.
 */
export function looksLikeCsvWorkbookDump(text: string): boolean {
  const bodies = extractCsvDumpBodies(text);
  if (bodies.length === 0) {
    // Also catch unfenced Sheet markers mixed with prose.
    const sheetMarkers = text.match(/["']Sheet\s*\d+\s*:[^"'\n]+["']/gi) ?? [];
    if (sheetMarkers.length < 2) return false;
    return true;
  }
  const joined = bodies.join("\n");
  const sheetMarkers = joined.match(/Sheet\s*\d+\s*:/gi) ?? [];
  if (sheetMarkers.length >= 2) return true;
  const lines = joined.split(/\r?\n/).filter((l) => l.trim());
  const csvLines = lines.filter((l) => countUnquotedCommas(l) >= 1);
  return csvLines.length >= 3;
}

export interface SalvagedSheet {
  name: string;
  headers: string[];
  rows: string[][];
}

/**
 * Parse a CSV workbook dump into sheets[]. Supports:
 * - "Sheet1: Title" marker rows (quoted or bare)
 * - Multiple ```csv``` fences
 * - Single table fallback
 */
export function parseCsvWorkbookDump(text: string): SalvagedSheet[] {
  const bodies = extractCsvDumpBodies(text);
  const source =
    bodies.length > 0
      ? bodies.join("\n")
      : text;
  const lines = source.split(/\r?\n/);

  type Section = { title: string; lines: string[] };
  const sections: Section[] = [];
  let current: Section | null = null;

  const sheetHeaderRe =
    /^["']?\s*Sheet\s*(\d+)\s*:\s*(.+?)\s*["']?\s*$/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const hm = trimmed.match(sheetHeaderRe);
    if (hm) {
      if (current && current.lines.length > 0) sections.push(current);
      const label = hm[2]!.replace(/^["']|["']$/g, "").trim();
      current = {
        title: label || `Sheet${hm[1]}`,
        lines: [],
      };
      continue;
    }
    if (!current) {
      current = { title: "Sheet1", lines: [] };
    }
    current.lines.push(line);
  }
  if (current && current.lines.length > 0) sections.push(current);

  const sheets: SalvagedSheet[] = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i]!;
    const { headers, rows } = parseCSV(sec.lines.join("\n"));
    if (!headers.length) continue;
    // Skip narrative junk headers.
    if (headers.some((h) => h.length > 80)) continue;
    sheets.push({
      name: sanitizeExcelSheetName(sec.title || `Sheet${i + 1}`),
      headers,
      rows,
    });
  }
  return sheets;
}

export function spreadsheetCsvDumpRepairUserMessage(): string {
  return (
    "Do NOT paste CSV, markdown tables, Sheet1 blocks, or <nela-artifact type=\"text/csv\"> into the chat. " +
    "Call run_xlsx_python NOW with a complete openpyxl script (wb.save(os.environ['NELA_XLSX_OUT'])) " +
    "using the figures you already gathered — that IS the Python sandbox on NELA Cloud. " +
    "For a simple flat table only, generate_spreadsheet is OK. " +
    "Never claim Python is unavailable. The only Excel deliverable is that tool call."
  );
}
