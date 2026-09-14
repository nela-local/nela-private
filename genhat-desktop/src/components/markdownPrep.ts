/**
 * Drop a trailing web-search "Sources" bibliography dump (citations render as
 * icons). Must NOT strip mid-document lines like `**Sources [1]:** Carta…` or
 * sections such as `## References & Data Sources` — a prior regex matched those
 * and deleted the rest of long answers from the render path (copy still showed
 * full `msg.content`).
 */
export function stripTrailingSourcesSection(md: string): string {
  // Heading line must be Sources alone (optional ## / ** / trailing colon),
  // then a newline — never "**Sources [1]:** …" on the same line.
  const re =
    /\n{1,3}((?:#{1,6}\s+)?(?:\*\*|__)?Sources(?:\*\*|__)?\s*:?[ \t]*)\n([\s\S]*)$/i;
  const match = md.match(re);
  if (!match || match.index == null) return md;

  const heading = match[1] ?? "";
  const remainder = match[2] ?? "";

  const headingCore = heading
    .replace(/^#{1,6}\s+/, "")
    .trim()
    .replace(/:$/, "")
    .trim()
    .replace(/^\*\*|\*\*$/g, "")
    .replace(/^__|__$/g, "")
    .trim();
  if (!/^sources$/i.test(headingCore)) return md;

  // If more document sections follow, this isn't a trailing dump.
  if (/^#{1,6}\s+\S/m.test(remainder)) return md;

  const trimmed = remainder.trim();
  if (!trimmed) return md.slice(0, match.index).trimEnd();
  const looksLikeDump =
    /https?:\/\//i.test(trimmed) ||
    /^(?:\s*(?:[-*]|\d+[.)])\s+\S.*\n?){1,}/m.test(trimmed);
  if (!looksLikeDump) return md;

  return md.slice(0, match.index).trimEnd();
}
