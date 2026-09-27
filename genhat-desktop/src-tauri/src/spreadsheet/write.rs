//! Render spreadsheet artifacts to XLSX files.

use std::collections::HashMap;
use std::path::PathBuf;

use rust_xlsxwriter::{Chart, ChartType, Color, Format, FormatBorder, Url, Workbook, Worksheet};

use crate::grammar::schema::{SpreadsheetOp, SpreadsheetPlan, SpreadsheetSheet};

// ─────────────────────────────────────────────────────────────────────────────
// XLSX generation
// ─────────────────────────────────────────────────────────────────────────────

pub fn write_spreadsheet_plan(plan: SpreadsheetPlan) -> Result<(PathBuf, Option<String>), String> {
    // ── Resolve output path first ────────────────────────────────────────────
    let output_name = plan.output_name.as_deref().unwrap_or("nela_artifact");
    let out_dir = crate::paths::artifacts_dir();
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("Create output dir: {e}"))?;
    let path = crate::paths::unique_artifact_path(&out_dir, output_name, "xlsx");

    let mut workbook = Workbook::new();

    let header_fmt = Format::new()
        .set_font_name("Arial")
        .set_bold()
        .set_font_color(Color::White)
        .set_background_color(Color::RGB(0x1F38_64)) // Navy header (analyst style)
        .set_border(FormatBorder::Thin)
        .set_border_color(Color::RGB(0x1630_4F));

    let cell_fmt = Format::new()
        .set_font_name("Arial")
        .set_border(FormatBorder::Thin)
        .set_border_color(Color::RGB(0xD0D0_D0));

    let sheets = resolve_sheets(&plan);
    let mut warnings: Vec<String> = Vec::new();
    let mut used_names: HashMap<String, usize> = HashMap::new();

    for (sheet_idx, sheet) in sheets.iter().enumerate() {
        let worksheet = workbook.add_worksheet();
        let sheet_name = unique_sheet_name(&sheet.name, sheet_idx, &mut used_names);
        if let Err(e) = worksheet.set_name(&sheet_name) {
            warnings.push(format!("Rename sheet '{sheet_name}': {e}"));
        }

        if let Err(mut sheet_warnings) =
            write_one_sheet(worksheet, sheet, &header_fmt, &cell_fmt)
        {
            warnings.append(&mut sheet_warnings);
        }
    }

    // ── Save the workbook ────────────────────────────────────────────────────
    workbook
        .save(&path)
        .map_err(|e| format!("Save workbook: {e}"))?;

    let warning = if warnings.is_empty() {
        None
    } else {
        Some(warnings.join("; "))
    };

    Ok((path, warning))
}

fn resolve_sheets(plan: &SpreadsheetPlan) -> Vec<SpreadsheetSheet> {
    if let Some(sheets) = &plan.sheets {
        let nonempty: Vec<SpreadsheetSheet> = sheets
            .iter()
            .filter(|s| {
                !s.ops.is_empty()
                    || s.headers.as_ref().is_some_and(|h| !h.is_empty())
                    || s.rows.as_ref().is_some_and(|r| !r.is_empty())
            })
            .cloned()
            .collect();
        if !nonempty.is_empty() {
            return nonempty;
        }
    }

    // Legacy single-sheet path: top-level ops / headers / source_rows.
    vec![SpreadsheetSheet {
        name: sheet_name_from_ops(&plan.ops).unwrap_or_else(|| "Sheet1".into()),
        headers: plan.headers.clone(),
        rows: plan.source_rows.clone(),
        ops: plan.ops.clone(),
        cell_fills: None,
        cell_fonts: None,
    }]
}

fn sheet_name_from_ops(ops: &[SpreadsheetOp]) -> Option<String> {
    ops.iter().find_map(|op| match op {
        SpreadsheetOp::RenameSheet { name } if !name.trim().is_empty() => Some(name.clone()),
        _ => None,
    })
}

fn unique_sheet_name(
    raw: &str,
    sheet_idx: usize,
    used: &mut HashMap<String, usize>,
) -> String {
    let mut cleaned = raw.trim().to_string();
    cleaned = cleaned.replace(['\\', '/', '*', '?', ':', '[', ']'], "_");
    if cleaned.is_empty() {
        cleaned = format!("Sheet{}", sheet_idx + 1);
    }
    // Excel max 31 chars
    let mut chars: Vec<char> = cleaned.chars().collect();
    if chars.len() > 31 {
        chars.truncate(31);
    }
    cleaned = chars.into_iter().collect::<String>().trim().to_string();
    if cleaned.is_empty() {
        cleaned = format!("Sheet{}", sheet_idx + 1);
    }

    let key = cleaned.to_ascii_lowercase();
    let n = used.entry(key).or_insert(0);
    *n += 1;
    if *n == 1 {
        cleaned
    } else {
        let suffix = format!(" ({n})");
        let max_base = 31usize.saturating_sub(suffix.len());
        let mut base: String = cleaned.chars().take(max_base).collect();
        base.push_str(&suffix);
        base
    }
}

fn write_one_sheet(
    worksheet: &mut Worksheet,
    sheet: &SpreadsheetSheet,
    header_fmt: &Format,
    cell_fmt: &Format,
) -> Result<(), Vec<String>> {
    let mut warnings: Vec<String> = Vec::new();

    // Track working table so WRITE_DATA + ADD_CHART share the same columns.
    let mut working_headers: Vec<String> = sheet.headers.clone().unwrap_or_default();
    let mut working_rows: Vec<Vec<String>> = sheet.rows.clone().unwrap_or_default();

    // Build column-index map from headers.
    let mut col_index: HashMap<String, usize> = working_headers
        .iter()
        .enumerate()
        .map(|(i, h)| (h.clone(), i))
        .collect();

    // Cache Format objects for sparse cell fills/fonts (keyed by style signature).
    let mut style_fmts: HashMap<String, Format> = HashMap::new();
    let fills = sheet.cell_fills.as_ref();
    let fonts = sheet.cell_fonts.as_ref();

    let resolve_style = |cache: &mut HashMap<String, Format>,
                         fill_hex: Option<&str>,
                         font_hex: Option<&str>,
                         bold: bool,
                         fallback: &Format|
     -> Format {
        let fill_n = fill_hex.and_then(normalize_fill_hex);
        let font_n = font_hex.and_then(normalize_fill_hex);
        if fill_n.is_none() && font_n.is_none() && !bold {
            return fallback.clone();
        }
        let key = format!(
            "{}|{}|{}",
            fill_n.as_deref().unwrap_or("-"),
            font_n.as_deref().unwrap_or("-"),
            if bold { "b" } else { "" }
        );
        if let Some(existing) = cache.get(&key) {
            return existing.clone();
        }
        let mut fmt = Format::new()
            .set_font_name("Arial")
            .set_border(FormatBorder::Thin)
            .set_border_color(Color::RGB(0xD0D0_D0));
        if bold {
            fmt = fmt.set_bold();
        }
        if let Some(ref hex) = fill_n {
            if let Ok(rgb) = u32::from_str_radix(&hex[1..], 16) {
                fmt = fmt.set_background_color(Color::RGB(rgb));
            }
        }
        if let Some(ref hex) = font_n {
            if let Ok(rgb) = u32::from_str_radix(&hex[1..], 16) {
                fmt = fmt.set_font_color(Color::RGB(rgb));
            }
        } else if fill_n.is_some() && bold {
            // Dark header fills default to white text when font color omitted.
            fmt = fmt.set_font_color(Color::White);
        }
        cache.insert(key, fmt.clone());
        fmt
    };

    // Write headers.
    for (col_idx, header) in working_headers.iter().enumerate() {
        let key = format!("0:{col_idx}");
        let fill = fills.and_then(|m| m.get(&key)).map(String::as_str);
        let font = fonts.and_then(|m| m.get(&key)).map(String::as_str);
        let write_fmt = if fill.is_some() || font.is_some() {
            resolve_style(&mut style_fmts, fill, font, true, header_fmt)
        } else {
            header_fmt.clone()
        };
        if let Err(e) =
            worksheet.write_with_format(0, col_idx as u16, header.as_str(), &write_fmt)
        {
            warnings.push(format!("Write header: {e}"));
        }
    }

    // Write data rows.
    for (row_idx, row) in working_rows.iter().enumerate() {
        let excel_row = row_idx as u32 + 1;
        for (col_idx, cell) in row.iter().enumerate() {
            let key = format!("{}:{}", row_idx + 1, col_idx);
            let fill = fills.and_then(|m| m.get(&key)).map(String::as_str);
            let font = fonts.and_then(|m| m.get(&key)).map(String::as_str);
            let fmt_owned = if fill.is_some() || font.is_some() {
                Some(resolve_style(
                    &mut style_fmts,
                    fill,
                    font,
                    false,
                    cell_fmt,
                ))
            } else {
                None
            };
            let fmt_ref = fmt_owned.as_ref().unwrap_or(cell_fmt);
            if let Err(e) = write_smart_cell(
                worksheet,
                excel_row,
                col_idx as u16,
                cell,
                fmt_ref,
            ) {
                warnings.push(e);
            }
        }
    }

    // ── Apply operations ─────────────────────────────────────────────────────
    let mut next_row = if working_headers.is_empty() && working_rows.is_empty() {
        0u32
    } else {
        working_rows.len() as u32 + 2 // +1 header, +1 blank gap
    };
    // When the sheet already has a table from headers/rows, WRITE_DATA should
    // replace rather than append below — start at row 0 if table empty.
    if working_headers.is_empty() && working_rows.is_empty() {
        next_row = 0;
    }
    let mut chart_slot: u16 = 0;
    let mut wrote_primary_table = !working_headers.is_empty() || !working_rows.is_empty();

    for op in &sheet.ops {
        match op {
            SpreadsheetOp::SumColumn { col, label } => {
                let col_letter = excel_col_letter(col_index.get(col.as_str()).copied());
                let data_rows = working_rows.len() as u32;

                if let Some(&ci) = col_index.get(col.as_str()) {
                    let default_label = format!("SUM({col})");
                    let lbl = label.as_deref().unwrap_or(&default_label);
                    if let Err(e) = worksheet.write(next_row, 0, lbl) {
                        warnings.push(format!("Write SUM label: {e}"));
                    }
                    let formula = format!("=SUM({col_letter}2:{col_letter}{})", data_rows + 1);
                    if let Err(e) = worksheet.write_formula(next_row, ci as u16, formula.as_str())
                    {
                        warnings.push(format!("Write SUM formula: {e}"));
                    }
                    next_row += 1;
                } else {
                    warnings.push(format!("SUM_COLUMN: column '{col}' not found in headers"));
                }
            }

            SpreadsheetOp::RenameSheet { .. } => {
                // Sheet name already applied via sheet.name / unique_sheet_name.
            }

            SpreadsheetOp::AverageByGroup { value_col, group_col } => {
                warnings.push(format!(
                    "AVERAGE_BY_GROUP({value_col} by {group_col}): simplified — use ADD_CHART for visual grouping"
                ));
            }
            SpreadsheetOp::SortDesc { col } | SpreadsheetOp::SortAsc { col } => {
                warnings.push(format!(
                    "SORT on '{col}': xlsxwriter does not support in-place sort; sort data before ingestion"
                ));
            }
            SpreadsheetOp::CountByGroup { group_col } => {
                warnings.push(format!(
                    "COUNT_BY_GROUP({group_col}): prefer ADD_CHART with category_col for a visual dashboard"
                ));
            }
            SpreadsheetOp::FilterRows { col, value } => {
                warnings.push(format!(
                    "FILTER_ROWS({col}={value}): AutoFilter applied; user must activate filter"
                ));
                if !working_headers.is_empty() && !working_rows.is_empty() {
                    let _ = worksheet.autofilter(
                        0,
                        0,
                        working_rows.len() as u32,
                        (working_headers.len() - 1) as u16,
                    );
                }
            }
            SpreadsheetOp::Pivot {
                row_col,
                col_col,
                value_col,
            } => {
                match compute_pivot_matrix(
                    &working_headers,
                    &working_rows,
                    row_col,
                    col_col,
                    value_col,
                ) {
                    Ok((pivot_headers, pivot_rows)) => {
                        let write_at = next_row;
                        if write_at > 0 {
                            // Leave a blank gap after the source table.
                        }
                        for (col_idx, header) in pivot_headers.iter().enumerate() {
                            if let Err(e) = worksheet.write_with_format(
                                write_at,
                                col_idx as u16,
                                header.as_str(),
                                header_fmt,
                            ) {
                                warnings.push(format!("Write PIVOT header: {e}"));
                            }
                        }
                        let mut row_cursor = write_at + 1;
                        for row in &pivot_rows {
                            for (col_idx, cell) in row.iter().enumerate() {
                                if let Err(e) = write_smart_cell(
                                    worksheet,
                                    row_cursor,
                                    col_idx as u16,
                                    cell,
                                    cell_fmt,
                                ) {
                                    warnings.push(e);
                                }
                            }
                            row_cursor += 1;
                        }
                        next_row = row_cursor + 1;
                        // If the sheet had no primary table, treat pivot as the working table.
                        if !wrote_primary_table {
                            working_headers = pivot_headers;
                            working_rows = pivot_rows;
                            col_index = working_headers
                                .iter()
                                .enumerate()
                                .map(|(i, h)| (h.clone(), i))
                                .collect();
                            wrote_primary_table = true;
                        }
                    }
                    Err(msg) => warnings.push(msg),
                }
            }
            SpreadsheetOp::AddColumn { name, formula } => {
                warnings.push(format!(
                    "ADD_COLUMN({name}={formula}): column appended as a note; formula not auto-wired"
                ));
                let new_col_idx = working_headers.len() as u16;
                if let Err(e) =
                    worksheet.write_with_format(0, new_col_idx, name.as_str(), header_fmt)
                {
                    warnings.push(format!("Write ADD_COLUMN header: {e}"));
                }
            }
            SpreadsheetOp::WriteData {
                headers: wd_headers,
                rows: wd_rows,
            } => {
                // Skip duplicate WRITE_DATA when the primary bare table was
                // already written (same shape) — prevents blank-row + replay.
                if wrote_primary_table
                    && wd_headers == &working_headers
                    && wd_rows == &working_rows
                {
                    continue;
                }
                // First WRITE_DATA on an empty sheet writes at the top.
                let write_at = if !wrote_primary_table { 0 } else { next_row };
                for (col_idx, header) in wd_headers.iter().enumerate() {
                    // cell_fills keys are relative to the WRITE_DATA block
                    // (0:col = header, 1:col = first data row), same as bare tables.
                    let key = format!("0:{col_idx}");
                    let fill = fills.and_then(|m| m.get(&key)).map(String::as_str);
                    let font = fonts.and_then(|m| m.get(&key)).map(String::as_str);
                    let write_fmt = if fill.is_some() || font.is_some() {
                        resolve_style(&mut style_fmts, fill, font, true, header_fmt)
                    } else {
                        header_fmt.clone()
                    };
                    if let Err(e) = worksheet.write_with_format(
                        write_at,
                        col_idx as u16,
                        header.as_str(),
                        &write_fmt,
                    ) {
                        warnings.push(format!("Write WRITE_DATA header: {e}"));
                    }
                }
                let mut row_cursor = write_at + 1;
                for (data_idx, row) in wd_rows.iter().enumerate() {
                    for (col_idx, cell) in row.iter().enumerate() {
                        let key = format!("{}:{}", data_idx + 1, col_idx);
                        let fill = fills.and_then(|m| m.get(&key)).map(String::as_str);
                        let font = fonts.and_then(|m| m.get(&key)).map(String::as_str);
                        let fmt_owned = if fill.is_some() || font.is_some() {
                            Some(resolve_style(
                                &mut style_fmts,
                                fill,
                                font,
                                false,
                                cell_fmt,
                            ))
                        } else {
                            None
                        };
                        let fmt_ref = fmt_owned.as_ref().unwrap_or(cell_fmt);
                        if let Err(e) = write_smart_cell(
                            worksheet,
                            row_cursor,
                            col_idx as u16,
                            cell,
                            fmt_ref,
                        ) {
                            warnings.push(e);
                        }
                    }
                    row_cursor += 1;
                }
                next_row = row_cursor + 1;
                if !wrote_primary_table || working_headers.is_empty() || working_rows.is_empty() {
                    working_headers = wd_headers.clone();
                    working_rows = wd_rows.clone();
                    col_index = working_headers
                        .iter()
                        .enumerate()
                        .map(|(i, h)| (h.clone(), i))
                        .collect();
                    wrote_primary_table = true;
                }
            }
            SpreadsheetOp::AddChart {
                chart_type,
                category_col,
                value_col,
                title,
            } => {
                match insert_dashboard_chart(
                    worksheet,
                    header_fmt,
                    cell_fmt,
                    &working_headers,
                    &working_rows,
                    chart_type,
                    category_col,
                    value_col.as_deref(),
                    title.as_deref(),
                    chart_slot,
                ) {
                    Ok(()) => chart_slot = chart_slot.saturating_add(1),
                    Err(msg) => warnings.push(msg),
                }
            }
        }
    }

    if warnings.is_empty() {
        Ok(())
    } else {
        Err(warnings)
    }
}

fn insert_dashboard_chart(
    worksheet: &mut Worksheet,
    header_fmt: &Format,
    cell_fmt: &Format,
    headers: &[String],
    rows: &[Vec<String>],
    chart_type: &str,
    category_col: &str,
    value_col: Option<&str>,
    title: Option<&str>,
    chart_slot: u16,
) -> Result<(), String> {
    if headers.is_empty() || rows.is_empty() {
        return Err("ADD_CHART: no tabular data available".into());
    }

    let cat_idx = column_index(headers, category_col)
        .ok_or_else(|| format!("ADD_CHART: category column '{category_col}' not found"))?;

    let points = if let Some(vcol) = value_col.filter(|s| !s.trim().is_empty()) {
        let val_idx = column_index(headers, vcol)
            .ok_or_else(|| format!("ADD_CHART: value column '{vcol}' not found"))?;
        aggregate_sum(rows, cat_idx, val_idx)
    } else {
        aggregate_count(rows, cat_idx)
    };

    if points.is_empty() {
        return Err("ADD_CHART: no plottable points".into());
    }

    let base_col = (headers.len() as u16)
        .saturating_add(2)
        .saturating_add(chart_slot * 4);
    let summary_title = title.unwrap_or("Chart data");
    worksheet
        .write_with_format(0, base_col, "Category", header_fmt)
        .map_err(|e| format!("ADD_CHART header: {e}"))?;
    worksheet
        .write_with_format(0, base_col + 1, summary_title, header_fmt)
        .map_err(|e| format!("ADD_CHART header: {e}"))?;

    for (i, (label, value)) in points.iter().enumerate() {
        let r = (i as u32) + 1;
        worksheet
            .write_with_format(r, base_col, label.as_str(), cell_fmt)
            .map_err(|e| format!("ADD_CHART category: {e}"))?;
        worksheet
            .write_number_with_format(r, base_col + 1, *value, cell_fmt)
            .map_err(|e| format!("ADD_CHART value: {e}"))?;
    }

    let last_row = points.len() as u32;
    let cat_letter = excel_col_letter(Some(base_col as usize));
    let val_letter = excel_col_letter(Some((base_col + 1) as usize));
    let cats = format!("{cat_letter}2:{cat_letter}{}", last_row + 1);
    let vals = format!("{val_letter}2:{val_letter}{}", last_row + 1);

    let ctype = match chart_type.to_ascii_lowercase().as_str() {
        "bar" => ChartType::Bar,
        "line" => ChartType::Line,
        "pie" => ChartType::Pie,
        _ => ChartType::Column,
    };

    let mut chart = Chart::new(ctype);
    chart.title().set_name(summary_title);
    chart
        .add_series()
        .set_categories(cats.as_str())
        .set_values(vals.as_str())
        .set_name(summary_title);

    let chart_row = 1u32 + (chart_slot as u32) * 16;
    let chart_col = base_col + 3;
    worksheet
        .insert_chart(chart_row, chart_col, &chart)
        .map_err(|e| format!("ADD_CHART insert: {e}"))?;

    Ok(())
}

fn column_index(headers: &[String], name: &str) -> Option<usize> {
    let target = name.trim().to_lowercase();
    headers
        .iter()
        .position(|h| h.trim().to_lowercase() == target)
}

fn find_header_index(headers: &[String], name: &str) -> Option<usize> {
    let target = name.trim().to_ascii_lowercase();
    if target.is_empty() {
        return None;
    }
    headers
        .iter()
        .position(|h| h.trim().eq_ignore_ascii_case(&target))
}

fn cell_key(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() {
        "(blank)".into()
    } else {
        t.to_string()
    }
}

fn format_pivot_number(n: f64) -> String {
    let rounded = (n * 100.0).round() / 100.0;
    if (rounded - rounded.round()).abs() < f64::EPSILON {
        format!("{}", rounded as i64)
    } else {
        format!("{rounded:.2}")
    }
}

/// Pre-computed crosstab from the working table (sum aggregation).
/// Empty `col_col` → single-dimension [row_col, sum(value_col)].
pub fn compute_pivot_matrix(
    headers: &[String],
    rows: &[Vec<String>],
    row_col: &str,
    col_col: &str,
    value_col: &str,
) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let row_idx = find_header_index(headers, row_col)
        .ok_or_else(|| format!("PIVOT: row column '{row_col}' not found"))?;
    let value_idx = find_header_index(headers, value_col)
        .ok_or_else(|| format!("PIVOT: value column '{value_col}' not found"))?;
    let col_idx = if col_col.trim().is_empty() {
        None
    } else {
        Some(
            find_header_index(headers, col_col)
                .ok_or_else(|| format!("PIVOT: column dimension '{col_col}' not found"))?,
        )
    };

    let mut buckets: HashMap<String, HashMap<String, f64>> = HashMap::new();
    let mut row_order: Vec<String> = Vec::new();
    let mut col_order: Vec<String> = Vec::new();
    let mut col_seen: HashMap<String, ()> = HashMap::new();

    for row in rows {
        let rk = cell_key(row.get(row_idx).map(|s| s.as_str()).unwrap_or(""));
        let ck = match col_idx {
            Some(ci) => cell_key(row.get(ci).map(|s| s.as_str()).unwrap_or("")),
            None => "_".into(),
        };
        if !buckets.contains_key(&rk) {
            row_order.push(rk.clone());
            buckets.insert(rk.clone(), HashMap::new());
        }
        if col_idx.is_some() && !col_seen.contains_key(&ck) {
            col_seen.insert(ck.clone(), ());
            col_order.push(ck.clone());
        }
        let n = row
            .get(value_idx)
            .and_then(|s| parse_number(s))
            .unwrap_or(0.0);
        *buckets.get_mut(&rk).unwrap().entry(ck).or_default() += n;
    }

    if col_idx.is_none() {
        let headers_out = vec![row_col.trim().to_string(), format!("sum({value_col})")];
        let rows_out: Vec<Vec<String>> = row_order
            .into_iter()
            .map(|rk| {
                let sum = buckets
                    .get(&rk)
                    .and_then(|m| m.get("_"))
                    .copied()
                    .unwrap_or(0.0);
                vec![rk, format_pivot_number(sum)]
            })
            .collect();
        return Ok((headers_out, rows_out));
    }

    col_order.sort();
    let mut headers_out = vec![row_col.trim().to_string()];
    headers_out.extend(col_order.iter().cloned());
    headers_out.push("Total".into());

    let rows_out: Vec<Vec<String>> = row_order
        .into_iter()
        .map(|rk| {
            let map = buckets.get(&rk).cloned().unwrap_or_default();
            let mut total = 0.0;
            let mut cells = Vec::with_capacity(col_order.len() + 2);
            cells.push(rk);
            for ck in &col_order {
                let v = map.get(ck).copied().unwrap_or(0.0);
                total += v;
                cells.push(format_pivot_number(v));
            }
            cells.push(format_pivot_number(total));
            cells
        })
        .collect();
    Ok((headers_out, rows_out))
}

fn parse_number(s: &str) -> Option<f64> {
    let cleaned = s.trim().replace(',', "");
    cleaned.parse::<f64>().ok()
}

fn aggregate_count(rows: &[Vec<String>], cat_idx: usize) -> Vec<(String, f64)> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for row in rows {
        let label = row.get(cat_idx).cloned().unwrap_or_default();
        if label.trim().is_empty() {
            continue;
        }
        *counts.entry(label).or_default() += 1;
    }
    let mut points: Vec<(String, f64)> = counts
        .into_iter()
        .map(|(k, v)| (k, v as f64))
        .collect();
    points.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    points.truncate(24);
    points
}

fn aggregate_sum(rows: &[Vec<String>], cat_idx: usize, val_idx: usize) -> Vec<(String, f64)> {
    let mut sums: HashMap<String, f64> = HashMap::new();
    for row in rows {
        let label = row.get(cat_idx).cloned().unwrap_or_default();
        if label.trim().is_empty() {
            continue;
        }
        let val = row
            .get(val_idx)
            .and_then(|s| parse_number(s))
            .unwrap_or(0.0);
        *sums.entry(label).or_default() += val;
    }
    let mut points: Vec<(String, f64)> = sums.into_iter().collect();
    points.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    points.truncate(24);
    points
}

fn excel_col_letter(idx: Option<usize>) -> String {
    let mut n = idx.unwrap_or(0) + 1; // 1-based
    let mut result = String::new();
    while n > 0 {
        n -= 1;
        result.insert(0, (b'A' + (n % 26) as u8) as char);
        n /= 26;
    }
    result
}

fn extract_http_url(text: &str) -> Option<&str> {
    let lower = text.to_ascii_lowercase();
    let start = lower.find("https://").or_else(|| lower.find("http://"))?;
    let rest = &text[start..];
    let end = rest
        .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | ')' | ']' | '>' | ',' | ';'))
        .unwrap_or(rest.len());
    Some(&rest[..end])
}

fn normalize_fill_hex(raw: &str) -> Option<String> {
    let t = raw.trim();
    // rgb(r,g,b) / rgba(r,g,b,a)
    if let Some(rest) = t
        .strip_prefix("rgb(")
        .or_else(|| t.strip_prefix("RGB("))
        .or_else(|| t.strip_prefix("rgba("))
        .or_else(|| t.strip_prefix("RGBA("))
    {
        let inner = rest.trim_end_matches(')');
        let parts: Vec<&str> = inner.split(',').map(str::trim).collect();
        if parts.len() >= 3 {
            let r: u32 = parts[0].parse().ok()?;
            let g: u32 = parts[1].parse().ok()?;
            let b: u32 = parts[2].parse().ok()?;
            if r <= 255 && g <= 255 && b <= 255 {
                return Some(format!("#{:02X}{:02X}{:02X}", r, g, b));
            }
        }
        return None;
    }
    let s = t.trim_start_matches('#').to_ascii_uppercase();
    let rgb = match s.len() {
        8 => s[2..].to_string(), // AARRGGBB → RRGGBB
        6 => s,
        3 => s
            .chars()
            .flat_map(|c| [c, c])
            .collect::<String>(),
        _ => return None,
    };
    if !rgb.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("#{rgb}"))
}

fn write_smart_cell(
    worksheet: &mut Worksheet,
    row: u32,
    col: u16,
    cell: &str,
    fmt: &Format,
) -> Result<(), String> {
    let trimmed = cell.trim();
    // Excel formulas — write as formula so workbooks recalculate.
    if trimmed.starts_with('=') && trimmed.len() > 1 {
        worksheet
            .write_formula_with_format(row, col, trimmed, fmt)
            .map_err(|e| format!("Write formula: {e}"))?;
        return Ok(());
    }
    if let Some(url) = extract_http_url(cell) {
        if url.len() == trimmed.len() {
            worksheet
                .write_url_with_format(row, col, Url::new(url), fmt)
                .map_err(|e| format!("Write URL: {e}"))?;
            return Ok(());
        }
    }
    if let Some(n) = parse_number(cell) {
        if !trimmed.starts_with('0') || trimmed == "0" || cell.contains('.') {
            worksheet
                .write_number_with_format(row, col, n, fmt)
                .map_err(|e| format!("Write number: {e}"))?;
            return Ok(());
        }
    }
    worksheet
        .write_with_format(row, col, cell, fmt)
        .map_err(|e| format!("Write cell: {e}"))?;
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::compute_pivot_matrix;

    #[test]
    fn pivot_two_dim_sums_party_by_month() {
        let headers = vec![
            "party".into(),
            "month".into(),
            "amount".into(),
        ];
        let rows = vec![
            vec!["Acme".into(), "2024-01".into(), "100".into()],
            vec!["Acme".into(), "2024-01".into(), "50".into()],
            vec!["Acme".into(), "2024-02".into(), "25".into()],
            vec!["Beta".into(), "2024-01".into(), "10".into()],
        ];
        let (hout, rout) =
            compute_pivot_matrix(&headers, &rows, "party", "month", "amount").unwrap();
        assert_eq!(hout, vec!["party", "2024-01", "2024-02", "Total"]);
        assert_eq!(rout.len(), 2);
        assert_eq!(rout[0], vec!["Acme", "150", "25", "175"]);
        assert_eq!(rout[1], vec!["Beta", "10", "0", "10"]);
    }

    #[test]
    fn pivot_single_dim_when_col_empty() {
        let headers = vec!["name".into(), "net".into()];
        let rows = vec![
            vec!["Cash".into(), "100".into()],
            vec!["Cash".into(), "40".into()],
            vec!["Bank".into(), "-10".into()],
        ];
        let (hout, rout) = compute_pivot_matrix(&headers, &rows, "name", "", "net").unwrap();
        assert_eq!(hout[0], "name");
        assert!(hout[1].contains("sum"));
        assert_eq!(rout[0], vec!["Cash", "140"]);
        assert_eq!(rout[1], vec!["Bank", "-10"]);
    }

    #[test]
    fn pivot_errors_on_missing_column() {
        let headers = vec!["a".into(), "b".into()];
        let rows = vec![vec!["1".into(), "2".into()]];
        let err = compute_pivot_matrix(&headers, &rows, "missing", "", "b").unwrap_err();
        assert!(err.contains("row column"));
    }
}
