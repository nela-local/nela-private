/**
 * Detect when a model dumps structured tool/planner JSON into the chat turn
 * instead of a valid tool call, and craft a repair nudge for another round.
 */

const MAX_TOOL_PAYLOAD_REPAIRS = 2;

export function maxToolPayloadRepairs(): number {
  return MAX_TOOL_PAYLOAD_REPAIRS;
}

const JSON_STRING = String.raw`"(?:\\.|[^"\\])*"`;
const FACET_PLAN_BLOCK_RE = /\{\s*"facets"\s*:\s*\[[\s\S]*?(?:\]\s*\}|$)/g;
const FACET_ITEM_RE = new RegExp(
  String.raw`\{\s*"name"\s*:\s*${JSON_STRING}\s*,\s*"query"\s*:\s*${JSON_STRING}` +
    String.raw`(?:\s*,\s*"profile"\s*:\s*${JSON_STRING})?\s*\}\s*,?`,
  "g"
);
/** Tail of a cut-off facet plan, e.g. `…for the workbook sheet."}]}` or `…","profile":"news"}]}`. */
const FACET_TAIL_RE =
  /(^|\n)[^\n{}]*"\s*(?:,\s*"profile"\s*:\s*"[a-z]*"\s*)?\}\s*\]\s*\}/g;
const XML_TOOL_CALL_RE = /<tool_call\b[\s\S]*?(?:<\/tool_call\s*>|$)/gi;
const XML_TOOL_TAG_RE = /<\/?(?:tool_call|arg_key|arg_value)\b[^>]*>/gi;

function stripLeaksOutsideFence(segment: string): string {
  return segment
    .replace(XML_TOOL_CALL_RE, "")
    .replace(XML_TOOL_TAG_RE, "")
    .replace(FACET_PLAN_BLOCK_RE, "")
    .replace(FACET_ITEM_RE, "")
    .replace(FACET_TAIL_RE, "$1");
}

/**
 * Remove internal research-plan JSON and XML tool markup from assistant prose.
 * Fenced code blocks are left untouched so legitimate JSON answers survive.
 */
export function stripLeakedToolPayloads(text: string): string {
  if (!text) return "";
  const parts = text.split(/(```[\s\S]*?(?:```|$))/g);
  const cleaned = parts
    .map((part) => (part.startsWith("```") ? part : stripLeaksOutsideFence(part)))
    .join("");
  return cleaned === text ? text : cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

/** Anthropic-style XML tool markup dumped into assistant text (not OpenAI tool_calls). */
export function looksLikeXmlToolCallLeak(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 12) return false;
  if (/<\/?tool_call\b/i.test(t)) return true;
  if (/<arg_key\b/i.test(t) && /<arg_value\b/i.test(t)) return true;
  if (/<\/?invoke\b/i.test(t) && /<\/?parameter\b/i.test(t)) return true;
  return false;
}

/** Extract likely JSON object/array text from a model reply. */
export function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]?.trim()) return fence[1].trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  const brace = trimmed.match(/\{[\s\S]*\}/);
  if (brace?.[0]) return brace[0];
  const bracket = trimmed.match(/\[[\s\S]*\]/);
  if (bracket?.[0]) return bracket[0];
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** True when JSON looks like the internal facet planner schema (not a tool call). */
export function looksLikeFacetPlannerPayload(parsed: unknown): boolean {
  if (!isRecord(parsed)) return false;
  if (!Array.isArray(parsed.facets)) return false;
  if (parsed.facets.length === 0) return false;
  return parsed.facets.some(
    (item) =>
      isRecord(item) &&
      typeof item.query === "string" &&
      item.query.trim().length > 0
  );
}

/**
 * Heuristic for truncated / mid-stream facet plans that fail JSON.parse
 * (e.g. `2026 revenue","profile":"news"}]}`).
 */
export function looksLikeTruncatedFacetPlannerText(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 20) return false;
  const hasFacetsKey = /"facets"\s*:/i.test(t);
  const hasQuery = /"query"\s*:/i.test(t);
  const hasProfile = /"profile"\s*:\s*"(?:news|research|simple)"/i.test(t);
  if (hasFacetsKey && hasQuery) return true;
  if (hasQuery && hasProfile && /[{}[\]]/.test(t)) return true;
  // Trailing fragment of a facet object (common stream truncation).
  if (/","profile"\s*:\s*"(?:news|research|simple)"\s*\}/.test(t)) {
    return true;
  }
  // Bare tail of a cut-off plan: `…for the workbook sheet."}]}`
  if (!t.includes("```") && /"\s*\}\s*\]\s*\}/.test(t)) return true;
  return false;
}

/**
 * Pull search queries out of a (possibly truncated) facet-plan dump so the
 * host can run web_search instead of showing the JSON to the user.
 */
export function extractQueriesFromFacetDump(text: string): string[] {
  const queries: string[] = [];
  const re = /"query"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const q = m[1]!.replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
    if (q.length > 2) queries.push(q.slice(0, 200));
  }
  return [...new Set(queries)].slice(0, 6);
}

/**
 * True when the model reply is structured tool/planner JSON that must not be
 * shown as the final answer (and should trigger a repair re-ask).
 */
export function looksLikeMisplacedToolOrPlannerPayload(text: string): boolean {
  if (looksLikeXmlToolCallLeak(text)) return true;
  if (looksLikeTruncatedFacetPlannerText(text)) return true;

  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    const trimmed = text.trim();
    if (
      trimmed.length > 40 &&
      /["']?facets["']?\s*:/i.test(trimmed) &&
      /["']?query["']?\s*:/i.test(trimmed)
    ) {
      return true;
    }
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const trimmed = text.trim();
    if (
      ((trimmed.startsWith("{") || trimmed.startsWith("[")) &&
        trimmed.length > 40 &&
        /["']?(?:facets|tool|name|arguments|query)["']?\s*:/i.test(trimmed)) ||
      looksLikeTruncatedFacetPlannerText(trimmed)
    ) {
      return true;
    }
    return false;
  }

  if (looksLikeFacetPlannerPayload(parsed)) return true;

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return false;
    return parsed.every(
      (item) =>
        isRecord(item) &&
        (typeof item.tool === "string" ||
          typeof item.name === "string" ||
          typeof item.query === "string")
    );
  }

  if (!isRecord(parsed)) return false;

  const tool =
    (typeof parsed.tool === "string" && parsed.tool) ||
    (typeof parsed.name === "string" && parsed.name) ||
    "";
  if (tool) return true;

  if (
    typeof parsed.query === "string" &&
    parsed.query.trim() &&
    (parsed.depth != null ||
      parsed.web_depth != null ||
      parsed.profile != null ||
      Array.isArray(parsed.urls))
  ) {
    return true;
  }

  return false;
}

export type ToolCallRepairMode = "json-host" | "native";

/** User-turn nudge asking for a proper tool call (or prose answer). */
export function toolCallRepairUserMessage(mode: ToolCallRepairMode): string {
  if (mode === "native") {
    return (
      "That reply was not a valid tool call. Never write a research plan, list of search queries, or any JSON into the chat. " +
      "Do NOT emit XML tool markup — it is not executed. " +
      "Use the API's native function/tool_calls only. " +
      "For Excel/workbooks call run_xlsx_python (or generate_spreadsheet for simple tables) — " +
      "never claim Python is unavailable and never use local_shell or generate_html as a substitute. " +
      "If you need live web facts, emit a native web_search tool call with " +
      '{"query":"short keywords","depth":"snippet|full|standard|deep"} ' +
      "(use depth=standard or deep for multi-facet research — the host plans facets). " +
      "You may emit several web_search / search_knowledge_base tool calls in one turn. " +
      "Otherwise answer the user in normal prose with no JSON and no XML tool markup."
    );
  }
  return (
    "That reply was not a valid tool call. Never write a research plan or list of search queries into the chat. " +
    "Do NOT emit XML tool markup. " +
    "If you need live web facts, reply with ONLY this JSON (no markdown): " +
    '{"tool":"web_search","query":"short keywords","depth":"snippet|full|standard|deep"} ' +
    "(use depth=standard or deep for multi-facet research — the host plans facets). " +
    "For local files use {\"tool\":\"search_knowledge_base\",\"query\":\"...\"}. " +
    "Otherwise answer the user in normal prose with no JSON."
  );
}
