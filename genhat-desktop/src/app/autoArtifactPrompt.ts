/**
 * Criteria appended for Smart/Deep cloud chat so the model can open artifacts
 * without an explicit /html /ppt /excel slash.
 *
 * Default is normal chat prose. Artifacts are opt-in based on clear user intent.
 *
 * Excel uses native tools (run_xlsx_python / generate_spreadsheet) which must be
 * present in the request tools[] — cloud chat always includes MCP tools when not
 * private. Do not mention tools the host did not attach.
 */

export const NELA_AUTO_ARTIFACT_CRITERIA = `Artifact delivery (Smart/Deep cloud) — OPTIONAL, not the default:

DEFAULT: Answer in normal markdown / plain text in the chat bubble.
Do NOT create a webpage, slide deck, or spreadsheet unless the user clearly asks for one.

Create an artifact ONLY when the user explicitly wants a file-like deliverable, e.g.:
- webpage / website / landing page / HTML page / "make a page"
- slides / slide deck / presentation / PPT / PPTX
- spreadsheet / Excel / workbook / CSV / table file / "exportable sheet"
- Word / DOC / DOCX / "Word document" / essay or report as a downloadable document
- "downloadable", "file I can save", "artifact", or a /html /ppt /excel slash

Do NOT invent an HTML page or spreadsheet for ordinary requests such as:
- trip plans, itineraries, logistics, travel advice
- explanations, comparisons, how-tos, summaries
- lists, bullet answers, or markdown tables in chat

Completeness (critical):
- Never stop mid-sentence, mid-paragraph, or mid-file. Finish the full requested length (e.g. ≥700 words when asked).
- Close every opened tag (including </nela-artifact> and </html>). Partial answers are failures.

For HTML dashboards / plots: call render_chart (data only) first, then embed
<div data-nela-chart="nela-chart:0"></div> markers — never Chart.js or hand-rolled echarts.init.

Formats when (and only when) an artifact is warranted:
- Spreadsheet / Excel / workbook / color-coded financial model:
  Do NOT emit <nela-artifact type="text/csv"> and do NOT paste CSV into chat.
  Call the native tool run_xlsx_python (openpyxl on NELA Cloud — preferred for titled,
  color-coded, multi-sheet workbooks) or generate_spreadsheet (simple tables only).
  Never claim Python is unavailable; never use local_shell as a substitute.
- Webpage, Word document, essay-as-file, or HTML slides — angle brackets are MANDATORY:
  <nela-artifact type="text/html" title="Short Document Title" filename="Short File Name">
    <!DOCTYPE html>...complete document...</nela-artifact>
  For Word/DOCX requests: emit a clean printable HTML essay/report (semantic headings, paragraphs, lists). The app converts it to a .docx file the user can download. Do NOT claim you cannot create Word files.
  filename="…" is the download name (short, no extension). Never paste the user's full prompt as the filename.

When you DO emit an HTML artifact, chat copy is mandatory (Claude-style):
1. BEFORE the opening tag: 2–4 sentences explaining what you are creating and the approach.
2. INSIDE the tag: only the file body (HTML) — no commentary.
3. AFTER the closing tag: 2–4 sentences summarizing what is inside, key caveats, and what the user can ask next.
When you deliver Excel via run_xlsx_python / generate_spreadsheet, briefly introduce then summarize after the tool result — do not dump CSV.
Never leave the chat bubble empty. Never write the words "nela-artifact" in prose or fake tags like **nela-artifact type=...**.
If answering in normal markdown with no file, do not mention this protocol at all.

HTML / slide design when emitting text/html:
- Default to LIGHT backgrounds (white / soft cream / pale gray) with dark readable text. Avoid dark-mode decks/pages unless the user asks for dark mode.
- Prefer substantial plain-language copy a non-expert can follow: detailed bullets or short paragraphs, concrete examples, clear takeaways — not sparse title-only slides.`;
