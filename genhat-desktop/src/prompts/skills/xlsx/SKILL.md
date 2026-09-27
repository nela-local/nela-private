---
name: xlsx
description: >-
  Use whenever the deliverable is an Excel workbook (.xlsx): create, color-code,
  or structure financial/tabular data for download. Prefer run_xlsx_python
  (openpyxl) for rich workbooks; generate_spreadsheet for simple tables.
---

# NELA Excel skill

## Which tool?

| Goal | Tool |
|------|------|
| **Rich** financial / color-coded / titled workbook (Claude-style) | `run_xlsx_python` |
| Simple flat tables | `generate_spreadsheet` |
| Never | `generate_html`, CSV fences in chat |

## `run_xlsx_python` (preferred for analyst workbooks)

Write a complete **openpyxl** script. Packages `openpyxl` and `pandas` are preinstalled — **do not** `pip install`.

Scripts run on **NELA Cloud**: openpyxl builds the file → **LibreOffice headless recalculates formulas** → formula errors are returned. The desktop app only saves the bytes. If `formula_errors` is non-empty, **fix and call again**.

**Never** say Python is unavailable. **Never** use `local_shell` (read-only file inspection) or `generate_html` as a substitute for Excel — call `run_xlsx_python`.

```python
import os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

wb = Workbook()
ws = wb.active
ws.title = "Summary"

# Title block
ws.merge_cells("A1:E1")
ws["A1"] = "Morgan Stanley — Q2 2026 Executive Summary"
ws["A1"].font = Font(name="Arial", size=16, bold=True, color="FFFFFF")
ws["A1"].fill = PatternFill("solid", fgColor="1F3864")

ws.merge_cells("A2:E2")
ws["A2"] = "Figures in $ millions unless noted. Source: company earnings / SEC."
ws["A2"].font = Font(name="Arial", size=10, color="595959")

# Headers on row 4
headers = ["Metric", "2Q 2026", "2Q 2025", "$ Chg", "% Chg"]
for i, h in enumerate(headers, 1):
    cell = ws.cell(4, i, h)
    cell.font = Font(name="Arial", bold=True, color="FFFFFF")
    cell.fill = PatternFill("solid", fgColor="1F3864")

# Inputs = blue font; formulas = black (LibreOffice will evaluate)
# Default: 2 decimal places unless the user asked for different precision
ws["B5"] = round(21300.0, 2)
ws["B5"].number_format = "#,##0.00"
ws["B5"].font = Font(name="Arial", color="0000FF")
ws["C5"] = round(16800.0, 2)
ws["C5"].number_format = "#,##0.00"
ws["C5"].font = Font(name="Arial", color="0000FF")
ws["D5"] = "=B5-C5"
ws["D5"].number_format = "#,##0.00"
ws["E5"] = '=IF(C5=0,"-",B5/C5-1)'
ws["E5"].number_format = "0.00%"

# ALWAYS save here:
wb.save(os.environ["NELA_XLSX_OUT"])
```

### Requirements

- **2 decimal places by default**: `round(value, 2)` for hardcoded numerics and set `cell.number_format` to `0.00` or `#,##0.00` (use `0.00%` for ratios/percentages). Only use more/fewer decimals when the user explicitly asks
- **Professional fonts** (Arial) throughout
- **Formulas** for change columns (`=B5-C5`), not hardcoded results — LibreOffice recalculates them; still set `number_format` on formula cells
- Prefer **LibreOffice-safe** formulas (`SUM`, `IF`, `AVERAGE`, basic arithmetic). Avoid Excel-only / volatile / array formulas that fail in Calc
- **Blue font** (`0000FF`) for hardcoded sourced inputs; black for formulas
- **Navy** (`1F3864`) title/header fills; section bands `8EA9DB`; +/- fills `E8F5E9` / `FFEBEE`
- **Multi-sheet**: Summary, Segments, Capital/Ratios, **Legend** (required when color-coding)
- Title + subtitle rows with larger/smaller fonts; optional merges
- Document sources on Legend / Notes
- One money value per cell — never split `$21` / `300`
- **Never** paste ```csv``` or `"Sheet1: …"` into the assistant message
- When the tool returns `formula_errors` (e.g. `#DIV/0!`, `#REF!`), fix the script and re-run

### Anti-patterns

- Leaving long float tails (e.g. `21.349999999`) without rounding / number formats
- Chat prose dumped onto a Sheet1 tab
- Only a Legend with no data sheets
- `pip install` or network calls
- Forgetting `wb.save(os.environ["NELA_XLSX_OUT"])`
- Ignoring `formula_errors` from the tool result

## `generate_spreadsheet` (simple tables)

```json
{
  "output_name": "Short_Stem",
  "sheets": [{
    "name": "Summary",
    "headers": ["Metric", "2Q 2026", "2Q 2025"],
    "rows": [["Net Revenues", "21300", "16800"]],
    "cell_fills": { "0:0": "#1F3864" },
    "cell_fonts": { "0:0": "#FFFFFF", "B2": "#0000FF" }
  }]
}
```
