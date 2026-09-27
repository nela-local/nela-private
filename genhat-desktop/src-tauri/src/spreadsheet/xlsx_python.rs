//! Constrained Python/openpyxl runner for rich Excel creation.
//!
//! Model-supplied scripts run in a scratch dir with `NELA_XLSX_OUT` pointing at
//! the final artifact path. Imports and dangerous APIs are preflight-banned.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_CODE_BYTES: usize = 200_000;

/// Packages / modules the script may import.
const ALLOWED_IMPORT_ROOTS: &[&str] = &[
    "openpyxl",
    "pandas",
    "pd",
    "json",
    "math",
    "datetime",
    "copy",
    "re",
    "collections",
    "pathlib",
    "os",
    "typing",
    "decimal",
    "string",
    "itertools",
    "functools",
    "operator",
    "statistics",
    "warnings",
    "io",
    "sys",
    "traceback",
];

const BANNED_PATTERNS: &[&str] = &[
    "subprocess",
    "socket",
    "urllib",
    "requests",
    "http.client",
    "httpx",
    "aiohttp",
    "ftplib",
    "smtplib",
    "ctypes",
    "multiprocessing",
    "pickle",
    "marshal",
    "importlib",
    "pty",
    "pdb",
    "codeop",
    "builtins.exec",
    "builtins.eval",
    "__import__",
    "os.system",
    "os.popen",
    "os.spawn",
    "os.exec",
    "os.remove",
    "os.unlink",
    "os.rmdir",
    "shutil",
    "pathlib.Path.unlink",
    "pathlib.Path.rmdir",
    "webbrowser",
    "tempfile.NamedTemporaryFile",
];

#[derive(Debug)]
pub struct XlsxPythonResult {
    pub path: PathBuf,
    pub warning: Option<String>,
    pub formula_errors: Vec<String>,
    pub recalculated: bool,
}

/// Reject obviously dangerous source before spawning Python.
pub fn preflight_xlsx_python_code(code: &str) -> Result<(), String> {
    if code.trim().is_empty() {
        return Err("run_xlsx_python requires non-empty code".into());
    }
    if code.len() > MAX_CODE_BYTES {
        return Err(format!(
            "code too large ({} bytes; max {MAX_CODE_BYTES})",
            code.len()
        ));
    }

    let lower = code.to_ascii_lowercase();
    for pat in BANNED_PATTERNS {
        if lower.contains(&pat.to_ascii_lowercase()) {
            return Err(format!(
                "code contains banned pattern `{pat}`. Use openpyxl/pandas only; no network or shell."
            ));
        }
    }

    // Soft-check imports: flag clearly disallowed top-level import names.
    for line in code.lines() {
        let t = line.trim();
        if t.starts_with('#') {
            continue;
        }
        if let Some(rest) = t.strip_prefix("import ") {
            for part in rest.split(',') {
                let name = part
                    .trim()
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .split('.')
                    .next()
                    .unwrap_or("");
                if name.is_empty() {
                    continue;
                }
                if !is_allowed_import_root(name) {
                    return Err(format!(
                        "import `{name}` is not allowed. Allowed: {}",
                        ALLOWED_IMPORT_ROOTS.join(", ")
                    ));
                }
            }
        }
        if let Some(rest) = t.strip_prefix("from ") {
            let name = rest
                .split_whitespace()
                .next()
                .unwrap_or("")
                .split('.')
                .next()
                .unwrap_or("");
            if !name.is_empty() && name != "." && !is_allowed_import_root(name) {
                return Err(format!(
                    "from `{name}` import … is not allowed. Allowed: {}",
                    ALLOWED_IMPORT_ROOTS.join(", ")
                ));
            }
        }
    }

    Ok(())
}

fn is_allowed_import_root(name: &str) -> bool {
    ALLOWED_IMPORT_ROOTS
        .iter()
        .any(|a| a.eq_ignore_ascii_case(name))
}

/// Resolve `.venv-xlsx` python for genhat-desktop (dev) or fall back to `python3`.
pub fn resolve_xlsx_python() -> PathBuf {
    if let Ok(override_py) = std::env::var("NELA_XLSX_PYTHON") {
        let p = PathBuf::from(override_py);
        if p.exists() {
            return p;
        }
    }

    // Walk from CWD and from this crate's expected locations.
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        for anc in cwd.ancestors().take(8) {
            candidates.push(anc.join(".venv-xlsx/bin/python"));
            candidates.push(anc.join(".venv-xlsx/Scripts/python.exe"));
            candidates.push(anc.join("genhat-desktop/.venv-xlsx/bin/python"));
            candidates.push(anc.join("nela/genhat-desktop/.venv-xlsx/bin/python"));
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        for anc in exe.ancestors().take(10) {
            candidates.push(anc.join(".venv-xlsx/bin/python"));
            candidates.push(anc.join("../.venv-xlsx/bin/python"));
            candidates.push(anc.join("../../.venv-xlsx/bin/python"));
            candidates.push(anc.join("../../../.venv-xlsx/bin/python"));
        }
    }

    for c in candidates {
        if c.is_file() {
            return c;
        }
    }

    PathBuf::from(if cfg!(windows) { "python" } else { "python3" })
}

/// Persist workbook bytes from the backend sandbox into the local artifacts dir.
pub fn save_xlsx_bytes(
    bytes: &[u8],
    output_name: Option<&str>,
    formula_errors: Vec<String>,
    recalculated: bool,
    warnings: &[String],
) -> Result<XlsxPythonResult, String> {
    if bytes.is_empty() {
        return Err("backend returned empty workbook".into());
    }
    let out_dir = crate::paths::artifacts_dir();
    fs::create_dir_all(&out_dir).map_err(|e| format!("Create artifacts dir: {e}"))?;
    let stem = sanitize_stem(output_name.unwrap_or("workbook"));
    let out_path = crate::paths::unique_artifact_path(&out_dir, &stem, "xlsx");
    fs::write(&out_path, bytes).map_err(|e| format!("Write xlsx: {e}"))?;

    let mut warning = None;
    let joined: String = warnings
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if !joined.is_empty() {
        warning = Some(joined.chars().take(2000).collect());
    }

    Ok(XlsxPythonResult {
        path: out_path,
        warning,
        formula_errors,
        recalculated,
    })
}

/// Run model openpyxl code; write workbook to artifacts dir.
/// Local fallback path — prefer backend `/v1/xlsx/python` when signed in.
pub fn run_xlsx_python_script(
    code: &str,
    output_name: Option<&str>,
) -> Result<XlsxPythonResult, String> {
    preflight_xlsx_python_code(code)?;

    let out_dir = crate::paths::artifacts_dir();
    fs::create_dir_all(&out_dir).map_err(|e| format!("Create artifacts dir: {e}"))?;
    let stem = sanitize_stem(output_name.unwrap_or("workbook"));
    let out_path = crate::paths::unique_artifact_path(&out_dir, &stem, "xlsx");

    let scratch = out_dir.join(format!(
        ".xlsx_py_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    fs::create_dir_all(&scratch).map_err(|e| format!("Create scratch: {e}"))?;

    let script_path = scratch.join("script.py");
    let wrapper = wrap_user_code(code);
    fs::write(&script_path, wrapper).map_err(|e| format!("Write script: {e}"))?;

    let python = resolve_xlsx_python();
    let started = Instant::now();
    let mut child = Command::new(&python)
        .arg(&script_path)
        .current_dir(&scratch)
        .env("NELA_XLSX_OUT", &out_path)
        .env("PYTHONNOUSERSITE", "1")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to spawn Python ({python}): {e}. Run scripts/setup-xlsx-venv.sh first.",
                python = python.display()
            )
        })?;

    let timeout = Duration::from_secs(DEFAULT_TIMEOUT_SECS);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if started.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = fs::remove_dir_all(&scratch);
                    return Err(format!(
                        "xlsx python timed out after {DEFAULT_TIMEOUT_SECS}s"
                    ));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                let _ = fs::remove_dir_all(&scratch);
                return Err(format!("wait failed: {e}"));
            }
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("collect output: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    let cleanup = || {
        let _ = fs::remove_dir_all(&scratch);
    };

    if !output.status.success() {
        cleanup();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("exit {}", output.status)
        };
        return Err(format!("xlsx python failed:\n{detail}"));
    }

    if !out_path.is_file() {
        // Fallback: pick newest xlsx in scratch
        if let Some(found) = newest_xlsx_in(&scratch) {
            fs::copy(&found, &out_path).map_err(|e| format!("copy xlsx: {e}"))?;
        }
    }

    if !out_path.is_file() {
        cleanup();
        return Err(
            "Script finished but no workbook was written. Save with: wb.save(os.environ[\"NELA_XLSX_OUT\"])"
                .into(),
        );
    }

    let mut warning_parts: Vec<String> = Vec::new();
    if !stderr.is_empty() {
        warning_parts.push(stderr.chars().take(2000).collect());
    }

    // Best-effort local LibreOffice recalc when backend is unavailable.
    let mut recalculated = false;
    let mut formula_errors = Vec::new();
    match try_local_soffice_recalc(&out_path, &scratch) {
        Ok(true) => {
            recalculated = true;
            if let Ok(errs) = scan_formula_errors_local(&python, &out_path, &scratch, true) {
                formula_errors = errs;
            }
        }
        Ok(false) => {
            warning_parts.push(
                "Local LibreOffice not found — formulas not recalculated (prefer NELA Cloud for verify gate)."
                    .into(),
            );
        }
        Err(e) => warning_parts.push(format!("Local LibreOffice recalc skipped: {e}")),
    }

    cleanup();

    Ok(XlsxPythonResult {
        path: out_path,
        warning: if warning_parts.is_empty() {
            None
        } else {
            Some(warning_parts.join("\n").chars().take(2000).collect())
        },
        formula_errors,
        recalculated,
    })
}

fn resolve_soffice() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("NELA_SOFFICE_PATH") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    for c in [
        "/usr/bin/soffice",
        "/usr/lib/libreoffice/program/soffice",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    ] {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Returns Ok(true) if recalc succeeded, Ok(false) if soffice missing.
fn try_local_soffice_recalc(xlsx: &Path, scratch: &Path) -> Result<bool, String> {
    let Some(soffice) = resolve_soffice() else {
        return Ok(false);
    };
    let out_dir = scratch.join("recalc");
    fs::create_dir_all(&out_dir).map_err(|e| format!("recalc dir: {e}"))?;
    let status = Command::new(&soffice)
        .args([
            "--headless",
            "--norestore",
            "--nolockcheck",
            "--nodefault",
            "--nofirststartwizard",
            "--convert-to",
            "xlsx",
            "--outdir",
        ])
        .arg(&out_dir)
        .arg(xlsx)
        .current_dir(scratch)
        .env("HOME", scratch)
        .env("SAL_USE_VCLPLUGIN", "svp")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .status()
        .map_err(|e| format!("spawn soffice: {e}"))?;
    if !status.success() {
        return Err(format!("soffice exit {status}"));
    }
    let name = xlsx
        .file_name()
        .map(|n| n.to_owned())
        .unwrap_or_else(|| std::ffi::OsString::from("workbook.xlsx"));
    let converted = out_dir.join(&name);
    let src = if converted.is_file() {
        converted
    } else {
        newest_xlsx_in(&out_dir).ok_or_else(|| "soffice produced no xlsx".to_string())?
    };
    fs::copy(&src, xlsx).map_err(|e| format!("copy recalc: {e}"))?;
    Ok(true)
}

fn scan_formula_errors_local(
    python: &Path,
    xlsx: &Path,
    scratch: &Path,
    recalculated: bool,
) -> Result<Vec<String>, String> {
    let script = scratch.join("scan_formulas.py");
    fs::write(
        &script,
        r##"
import json, sys
from openpyxl import load_workbook
path = sys.argv[1]
check_uncached = sys.argv[2] == "1"
ERROR_TOKENS = ("#REF!", "#DIV/0!", "#VALUE!", "#N/A", "#NAME?", "#NULL!", "#NUM!", "#GETTING_DATA", "#SPILL!")
errors = []
wb = load_workbook(path, data_only=True)
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for cell in row:
            if cell.value is None: continue
            text = str(cell.value).strip()
            if text.startswith("#") or any(t in text for t in ERROR_TOKENS):
                errors.append(f"{ws.title}!{cell.coordinate}: {text}")
if check_uncached:
    wb_f = load_workbook(path, data_only=False)
    wb_v = load_workbook(path, data_only=True)
    for ws_f, ws_v in zip(wb_f.worksheets, wb_v.worksheets):
        for row_f, row_v in zip(ws_f.iter_rows(), ws_v.iter_rows()):
            for cf, cv in zip(row_f, row_v):
                if isinstance(cf.value, str) and cf.value.startswith("=") and cv.value is None:
                    errors.append(f"{ws_f.title}!{cf.coordinate}: formula produced no cached value ({cf.value})")
print(json.dumps(errors[:80]))
"##,
    )
    .map_err(|e| format!("write scan: {e}"))?;

    let output = Command::new(python)
        .arg(&script)
        .arg(xlsx)
        .arg(if recalculated { "1" } else { "0" })
        .current_dir(scratch)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("scan spawn: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: Vec<String> = serde_json::from_str(stdout.trim()).unwrap_or_default();
    Ok(parsed)
}

fn wrap_user_code(code: &str) -> String {
    format!(
        r#"# NELA xlsx sandbox harness — auto-generated
import os
import sys

out = os.environ.get("NELA_XLSX_OUT")
if not out:
    sys.stderr.write("NELA_XLSX_OUT is not set\n")
    sys.exit(2)

# --- user code ---
{code}
# --- end user code ---
"#
    )
}

fn sanitize_stem(raw: &str) -> String {
    let s: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .chars()
        .take(48)
        .collect();
    if s.is_empty() {
        "workbook".into()
    } else {
        s
    }
}

fn newest_xlsx_in(dir: &Path) -> Option<PathBuf> {
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    let entries = fs::read_dir(dir).ok()?;
    for ent in entries.flatten() {
        let p = ent.path();
        if p.extension().and_then(|e| e.to_str()) != Some("xlsx") {
            continue;
        }
        let modified = ent.metadata().ok()?.modified().ok()?;
        match &best {
            None => best = Some((modified, p)),
            Some((t, _)) if modified > *t => best = Some((modified, p)),
            _ => {}
        }
    }
    best.map(|(_, p)| p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preflight_rejects_subprocess() {
        let err = preflight_xlsx_python_code("import subprocess\nsubprocess.call(['ls'])").unwrap_err();
        assert!(err.contains("banned") || err.contains("not allowed"));
    }

    #[test]
    fn preflight_rejects_socket_import() {
        let err = preflight_xlsx_python_code("import socket\n").unwrap_err();
        assert!(err.to_lowercase().contains("socket") || err.contains("not allowed"));
    }

    #[test]
    fn preflight_allows_openpyxl() {
        assert!(preflight_xlsx_python_code(
            r#"
from openpyxl import Workbook
import os
wb = Workbook()
wb.save(os.environ["NELA_XLSX_OUT"])
"#
        )
        .is_ok());
    }

    #[test]
    fn smoke_openpyxl_write_when_venv_present() {
        let py = resolve_xlsx_python();
        // Skip if only system python without openpyxl — venv path must exist.
        let py_s = py.to_string_lossy();
        if !py_s.contains("venv-xlsx") && std::env::var("NELA_XLSX_PYTHON").is_err() {
            eprintln!("skip smoke: no .venv-xlsx ({py_s})");
            return;
        }
        let code = r#"
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
import os
wb = Workbook()
ws = wb.active
ws.title = "Summary"
ws["A1"] = "Metric"
ws["A1"].font = Font(name="Arial", bold=True, color="FFFFFF")
ws["A1"].fill = PatternFill("solid", fgColor="1F3864")
ws["B1"] = "Value"
ws["B1"].font = Font(name="Arial", bold=True, color="FFFFFF")
ws["B1"].fill = PatternFill("solid", fgColor="1F3864")
ws["A2"] = "Net Revenues"
ws["B2"] = 21300
ws["B2"].font = Font(name="Arial", color="0000FF")
wb.save(os.environ["NELA_XLSX_OUT"])
"#;
        let result = run_xlsx_python_script(code, Some("smoke_xlsx")).expect("run");
        assert!(result.path.is_file(), "missing {}", result.path.display());
        let _ = std::fs::remove_file(&result.path);
    }
}
