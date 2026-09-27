/**
 * Runtime agent skills (Claude-style SKILL.md) injected into Cloud tool turns.
 * Skills teach presentation quality for generate_spreadsheet / generate_presentation.
 */

import xlsxSkillRaw from "../../prompts/skills/xlsx/SKILL.md?raw";
import pptxSkillRaw from "../../prompts/skills/pptx/SKILL.md?raw";

function stripFrontmatter(md: string): string {
  const trimmed = md.trim();
  if (!trimmed.startsWith("---")) return trimmed;
  const end = trimmed.indexOf("\n---", 3);
  if (end < 0) return trimmed;
  return trimmed.slice(end + 4).trim();
}

const XLSX_SKILL = stripFrontmatter(xlsxSkillRaw);
const PPTX_SKILL = stripFrontmatter(pptxSkillRaw);

/** Compact skill blobs for the dynamic tool-reminder system message. */
export function spreadsheetSkillReminder(): string {
  return (
    "EXCEL SKILL (follow when creating .xlsx — prefer run_xlsx_python for rich workbooks; " +
    "generate_spreadsheet for simple tables):\n" +
    XLSX_SKILL
  );
}

export function presentationSkillReminder(): string {
  return `PRESENTATION SKILL (follow when calling generate_presentation):\n${PPTX_SKILL}`;
}
