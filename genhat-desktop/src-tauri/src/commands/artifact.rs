//! Tauri commands for MCP artifact generation.
//!
//! Exposes the MCP coordinator and intent resolver to the frontend.

use crate::intent::{IntentDecision, IntentResolverState};
use crate::mcp::types::PipelineStage;
use crate::grammar::schema::HtmlPlan;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager, State};

// ─────────────────────────────────────────────────────────────────────────────
// DTOs
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveIntentRequest {
    pub prompt: String,
    #[serde(default)]
    pub extra: HashMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactResult {
    pub path: String,
    pub kind: String,
    pub warning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula_errors: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recalculated: Option<bool>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

/// Resolve the macro-intent of a prompt without executing anything.
///
/// Used by the frontend to show the appropriate mode UI before invoking
/// any model or tool.
#[tauri::command]
pub async fn resolve_intent(
    request: ResolveIntentRequest,
    resolver: State<'_, IntentResolverState>,
) -> Result<IntentDecision, String> {
    Ok(resolver
        .0
        .resolve(&request.prompt, &request.extra)
        .await)
}

/// Generate a spreadsheet artifact from a plan object (tolerant of minor schema drift).
#[tauri::command]
pub async fn generate_spreadsheet(
    plan: serde_json::Value,
    app: AppHandle,
) -> Result<ArtifactResult, String> {
    emit_stage(&app, PipelineStage::WritingCode);

    let plan = crate::grammar::plan_normalize::parse_spreadsheet_plan(plan)?;
    let (path, warning) = tauri::async_runtime::spawn_blocking(move || {
        crate::spreadsheet::write_spreadsheet_plan(plan)
    })
    .await
    .map_err(|e| format!("Spreadsheet write task failed: {e}"))??;

    emit_stage(
        &app,
        PipelineStage::LivePreview {
            path: path.to_string_lossy().to_string(),
        },
    );

    Ok(ArtifactResult {
        path: path.to_string_lossy().to_string(),
        kind: "xlsx".to_string(),
        warning,
        formula_errors: None,
        recalculated: None,
    })
}

/// Run constrained openpyxl Python to create a rich .xlsx.
/// Prefers NELA Cloud (`/v1/xlsx/python`: openpyxl + LibreOffice recalc + formula scan);
/// falls back to local Python (+ optional local soffice) when cloud is unavailable.
#[tauri::command]
pub async fn run_xlsx_python(
    code: String,
    output_name: Option<String>,
    app: AppHandle,
) -> Result<ArtifactResult, String> {
    emit_stage(&app, PipelineStage::WritingCode);

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;

    // Prefer backend pipeline (generation + LibreOffice verify gate).
    let cloud_body = serde_json::json!({
        "code": code,
        "outputName": output_name,
    });
    let cloud_result = crate::cloud::client::run_xlsx_python(&app_data_dir, cloud_body).await;

    let result = match cloud_result {
        Ok(value) => {
            let b64 = value
                .get("xlsxBase64")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Cloud Excel reply missing xlsxBase64".to_string())?;
            use base64::Engine;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| format!("decode workbook: {e}"))?;
            let formula_errors: Vec<String> = value
                .get("formulaErrors")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let recalculated = value
                .get("recalculated")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let warnings: Vec<String> = value
                .get("warnings")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let stem = value
                .get("outputName")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or(output_name.clone());
            tauri::async_runtime::spawn_blocking(move || {
                crate::spreadsheet::save_xlsx_bytes(
                    &bytes,
                    stem.as_deref(),
                    formula_errors,
                    recalculated,
                    &warnings,
                )
            })
            .await
            .map_err(|e| format!("xlsx save task failed: {e}"))??
        }
        Err(cloud_err) => {
            // Only fall back when Cloud is unreachable / unsigned / endpoint missing.
            // Surface script validation and formula-pipeline errors to the model.
            let lower = cloud_err.to_lowercase();
            let use_local = lower.contains("couldn't reach")
                || lower.contains("sign in")
                || lower.contains("session expired")
                || lower.contains("busy right now")
                || lower.contains("couldn't find")
                || lower.contains("unexpected reply");
            if !use_local {
                return Err(cloud_err);
            }
            let code_local = code.clone();
            let name_local = output_name.clone();
            let mut local = tauri::async_runtime::spawn_blocking(move || {
                crate::spreadsheet::run_xlsx_python_script(&code_local, name_local.as_deref())
            })
            .await
            .map_err(|e| format!("xlsx python task failed: {e}"))??;
            let note = format!("Cloud Excel unavailable ({cloud_err}); used local sandbox.");
            local.warning = Some(match local.warning.take() {
                Some(w) => format!("{note}\n{w}"),
                None => note,
            });
            local
        }
    };

    emit_stage(
        &app,
        PipelineStage::LivePreview {
            path: result.path.to_string_lossy().to_string(),
        },
    );

    Ok(ArtifactResult {
        path: result.path.to_string_lossy().to_string(),
        kind: "xlsx".to_string(),
        warning: result.warning,
        formula_errors: if result.formula_errors.is_empty() {
            None
        } else {
            Some(result.formula_errors)
        },
        recalculated: Some(result.recalculated),
    })
}

/// Generate a presentation artifact from a plan object (tolerant of minor schema drift).
#[tauri::command]
pub async fn generate_presentation(
    plan: serde_json::Value,
    app: AppHandle,
) -> Result<ArtifactResult, String> {
    emit_stage(&app, PipelineStage::WritingCode);

    let prompt = plan
        .get("_prompt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mut plan_value = plan;
    if let Some(obj) = plan_value.as_object_mut() {
        obj.remove("_prompt");
        obj.remove("_target_slides");
    }
    let plan = crate::grammar::plan_normalize::parse_presentation_plan(plan_value, &prompt)?;
    let path = crate::presentation::write_presentation_plan(plan)?;

    emit_stage(
        &app,
        PipelineStage::LivePreview {
            path: path.to_string_lossy().to_string(),
        },
    );

    Ok(ArtifactResult {
        path: path.to_string_lossy().to_string(),
        kind: "html".to_string(),
        warning: None,
        formula_errors: None,
        recalculated: None,
    })
}

/// Generate an HTML page artifact from a `HtmlPlan`.
///
/// Renders in-process (no MCP sidecar) so structured section plans always use
/// the current renderer — avoids stale sidecar binaries expecting legacy `html`.
#[tauri::command]
pub async fn generate_html(
    plan: HtmlPlan,
    app: AppHandle,
) -> Result<ArtifactResult, String> {
    emit_stage(&app, PipelineStage::WritingCode);

    let path = crate::html::write_html_plan(plan)?;

    emit_stage(
        &app,
        PipelineStage::LivePreview {
            path: path.to_string_lossy().to_string(),
        },
    );

    Ok(ArtifactResult {
        path: path.to_string_lossy().to_string(),
        kind: "html".to_string(),
        warning: None,
        formula_errors: None,
        recalculated: None,
    })
}

/// Write raw bytes (base64-encoded by the frontend) to an absolute path.
///
/// Used by the presentation exporter to persist generated PDF/PPTX files the
/// frontend builds in-memory (via jsPDF / pptxgenjs) to a user-chosen path.
#[tauri::command]
pub fn save_binary_file(path: String, contents_base64: String) -> Result<(), String> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    let bytes = STANDARD
        .decode(contents_base64.as_bytes())
        .map_err(|e| format!("Failed to decode base64 payload: {e}"))?;

    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory '{}': {e}", parent.display()))?;
        }
    }

    std::fs::write(&path, &bytes).map_err(|e| format!("Failed to write file '{path}': {e}"))?;
    Ok(())
}

/// Get the current governor state (battery, thread count, thermal pressure).
#[tauri::command]
pub fn get_governor_state(
    governor: State<'_, crate::governor::GovernorState>,
) -> serde_json::Value {
    serde_json::json!({
        "on_battery": governor.0.on_battery(),
        "thermal_pressure": governor.0.thermal_pressure(),
        "inference_threads": governor.0.inference_threads(),
    })
}

/// Get the GBNF grammar for a specific schema/manifest ID.
#[tauri::command]
pub fn get_schema_grammar(schema_id: String) -> Result<String, String> {
    match schema_id.as_str() {
        "spreadsheet_synthesis" => Ok(crate::grammar::SPREADSHEET_PLAN_GBNF.to_string()),
        "presentation_synthesis" => Ok(crate::grammar::PRESENTATION_PLAN_GBNF.to_string()),
        "html_synthesis" => Ok(crate::grammar::HTML_PAGE_PLAN_GBNF.to_string()),
        other => Err(format!("Unknown schema_id: {other}")),
    }
}

/// Parse spreadsheet file cells/rows using calamine or csv parsing library.
///
/// When `max_rows` is set, only the header plus that many data rows are returned
/// (keeps memory bounded for large workbooks during edit flows).
#[tauri::command]
pub async fn parse_spreadsheet_data(
    path: String,
    max_rows: Option<usize>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || parse_spreadsheet_data_inner(path, max_rows))
        .await
        .map_err(|e| format!("Spreadsheet parse task failed: {e}"))?
}

fn parse_spreadsheet_data_inner(
    path: String,
    max_rows: Option<usize>,
) -> Result<serde_json::Value, String> {
    let row_cap = max_rows.filter(|n| *n > 0);

    if path.ends_with(".csv") {
        let mut reader = csv::Reader::from_path(&path)
            .map_err(|e| format!("Failed to open CSV: {e}"))?;
        let mut rows = Vec::new();
        let mut data_rows = 0usize;

        if let Ok(headers) = reader.headers() {
            let header_row: Vec<String> = headers.iter().map(|s| s.to_string()).collect();
            if !header_row.is_empty() {
                rows.push(header_row);
            }
        }

        for result in reader.records() {
            if let Some(cap) = row_cap {
                if data_rows >= cap {
                    break;
                }
            }
            let record = result.map_err(|e| format!("Failed to read CSV record: {e}"))?;
            let row_data: Vec<String> = record.iter().map(|s| s.to_string()).collect();
            rows.push(row_data);
            data_rows += 1;
        }
        return Ok(serde_json::json!({
            "sheet_name": "CSV",
            "rows": rows,
            "cell_fills": serde_json::Map::new(),
            "truncated": row_cap.is_some_and(|cap| data_rows >= cap),
            "sheets": [{
                "sheet_name": "CSV",
                "rows": rows,
                "cell_fills": serde_json::Map::new(),
                "truncated": row_cap.is_some_and(|cap| data_rows >= cap),
            }],
        }));
    }

    use calamine::{Reader, open_workbook_auto};
    let mut workbook = open_workbook_auto(&path)
        .map_err(|e| format!("Failed to open spreadsheet: {e}"))?;

    let sheet_names = workbook.sheet_names().to_vec();
    if sheet_names.is_empty() {
        return Err("No sheets found in workbook".to_string());
    }

    let fills_by_sheet = extract_xlsx_cell_fills(&path, row_cap);

    let mut sheets_out = Vec::new();
    for sheet_name in &sheet_names {
        let range = match workbook.worksheet_range(sheet_name) {
            Ok(r) => r,
            Err(e) => {
                log::warn!("Failed to read sheet '{sheet_name}': {e}");
                continue;
            }
        };

        let mut rows = Vec::new();
        let mut data_rows = 0usize;
        for row in range.rows() {
            if rows.is_empty() {
                let mut row_data = Vec::new();
                for cell in row {
                    row_data.push(cell_to_string(cell));
                }
                rows.push(row_data);
                continue;
            }
            if let Some(cap) = row_cap {
                if data_rows >= cap {
                    break;
                }
            }
            let mut row_data = Vec::new();
            for cell in row {
                row_data.push(cell_to_string(cell));
            }
            rows.push(row_data);
            data_rows += 1;
        }

        let cell_fills = fills_by_sheet
            .get(sheet_name)
            .cloned()
            .unwrap_or_default();

        sheets_out.push(serde_json::json!({
            "sheet_name": sheet_name,
            "rows": rows,
            "cell_fills": cell_fills,
            "truncated": row_cap.is_some_and(|cap| data_rows >= cap),
        }));
    }

    if sheets_out.is_empty() {
        return Err("No readable sheets found in workbook".to_string());
    }

    let first = &sheets_out[0];
    Ok(serde_json::json!({
        "sheet_name": first.get("sheet_name").cloned().unwrap_or(serde_json::Value::String("Sheet1".into())),
        "rows": first.get("rows").cloned().unwrap_or(serde_json::Value::Array(vec![])),
        "cell_fills": first.get("cell_fills").cloned().unwrap_or(serde_json::json!({})),
        "truncated": first.get("truncated").cloned().unwrap_or(serde_json::Value::Bool(false)),
        "sheets": sheets_out,
    }))
}

/// Best-effort fill extraction via umya-spreadsheet. Failures yield empty maps
/// so value parsing still succeeds.
fn extract_xlsx_cell_fills(
    path: &str,
    row_cap: Option<usize>,
) -> std::collections::HashMap<String, serde_json::Map<String, serde_json::Value>> {
    let mut out: std::collections::HashMap<String, serde_json::Map<String, serde_json::Value>> =
        std::collections::HashMap::new();
    let lower = path.to_ascii_lowercase();
    if !(lower.ends_with(".xlsx") || lower.ends_with(".xlsm")) {
        return out;
    }

    let book = match umya_spreadsheet::reader::xlsx::read(path) {
        Ok(b) => b,
        Err(e) => {
            log::debug!("umya fill extract skipped for {path}: {e}");
            return out;
        }
    };

    for sheet in book.get_sheet_collection() {
        let name = sheet.get_name().to_string();
        let mut fills = serde_json::Map::new();
        for ((row_1based, col_1based), cell) in sheet.get_collection_to_hashmap() {
            // Excel is 1-based; viewer keys are 0-based.
            if *row_1based == 0 || *col_1based == 0 {
                continue;
            }
            let r0 = (*row_1based as usize).saturating_sub(1);
            let c0 = (*col_1based as usize).saturating_sub(1);
            // Header (row 0) + up to row_cap data rows.
            if let Some(cap) = row_cap {
                if r0 > cap {
                    continue;
                }
            }
            let Some(hex) = style_fill_hex(cell.get_style()) else {
                continue;
            };
            fills.insert(format!("{r0}:{c0}"), serde_json::Value::String(hex));
        }
        out.insert(name, fills);
    }
    out
}

fn style_fill_hex(style: &umya_spreadsheet::Style) -> Option<String> {
    let color = style.background_color()?;
    let argb = color.argb_str();
    let rgb = argb_to_css_hex(&argb)?;
    if is_default_fill(&rgb) {
        return None;
    }
    Some(rgb)
}

fn argb_to_css_hex(argb: &str) -> Option<String> {
    let s = argb.trim().trim_start_matches('#').to_ascii_uppercase();
    let rgb = match s.len() {
        8 => &s[2..], // AARRGGBB → RRGGBB
        6 => s.as_str(),
        _ => return None,
    };
    if !rgb.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("#{rgb}"))
}

fn is_default_fill(hex: &str) -> bool {
    matches!(
        hex.to_ascii_uppercase().as_str(),
        "#FFFFFF" | "#000000" | "#00000000" | "#FFFFFFFF" | "#00FFFFFF"
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregateSpreadsheetChartRequest {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub label_column: String,
    pub value_column: Option<String>,
    pub aggregation: Option<String>,
    pub max_points: Option<usize>,
    pub sort: Option<String>,
}

/// Aggregate chart series from in-memory spreadsheet rows (file-backed dashboards).
#[tauri::command]
pub fn aggregate_spreadsheet_chart(
    request: AggregateSpreadsheetChartRequest,
) -> Result<Vec<crate::html::charts::ChartPoint>, String> {
    Ok(crate::html::charts::aggregate_chart(
        &request.headers,
        &request.rows,
        &request.label_column,
        request.value_column.as_deref(),
        request.aggregation.as_deref(),
        request.max_points.unwrap_or(48),
        request.sort.as_deref(),
    ))
}


// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn emit_stage(app: &AppHandle, stage: PipelineStage) {
    if let Err(e) = app.emit("pipeline-stage", &stage) {
        log::debug!("Failed to emit pipeline-stage event: {e}");
    }
}

/// Write full text contents as a **new** artifact copy next to the source naming.
/// Used for deterministic freeform HTML deck edits (no LLM / no diff).
#[tauri::command]
pub async fn write_artifact_copy(
    path: String,
    contents: String,
    output_name: Option<String>,
) -> Result<String, String> {
    let stem = output_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| crate::presentation::edited_output_name(&path));
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("html");
    let out_dir = crate::paths::artifacts_dir();
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("Create output dir: {e}"))?;
    let out_path = crate::paths::unique_artifact_path(&out_dir, &stem, ext);
    std::fs::write(&out_path, contents.as_bytes())
        .map_err(|e| format!("Failed to write artifact copy: {e}"))?;
    Ok(out_path.to_string_lossy().to_string())
}

fn cell_to_string(cell: &calamine::Data) -> String {
    use calamine::Data;
    match cell {
        Data::Int(n) => n.to_string(),
        Data::Float(f) => {
            if f.abs() < 1e15 && f.fract() == 0.0 {
                format!("{}", *f as i64)
            } else {
                format!("{f}")
            }
        }
        Data::String(s) => s.clone(),
        Data::Bool(b) => b.to_string(),
        Data::DateTime(dt) => format!("{dt}"),
        Data::DateTimeIso(s) => s.clone(),
        Data::DurationIso(s) => s.clone(),
        Data::Error(e) => format!("[Error: {e:?}]"),
        Data::Empty => String::new(),
    }
}

