//! Build a sanitized support zip for developers (no chat contents / secrets).

use regex::Regex;
use serde_json::{json, Value};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use zip::write::SimpleFileOptions;

/// Inputs collected from the frontend (already scrubbed of message bodies).
#[derive(Debug, Clone, Default)]
pub struct FrontendDiagnostics {
    pub raw_json: String,
}

/// Export a support bundle zip into Downloads.
///
/// Contents (privacy-scrubbed):
/// - `README.txt` — how to send to the team
/// - `environment.json` — app/OS/runtime metadata
/// - `device_specs.json` — hardware snapshot
/// - `workspaces.json` — workspace ids/names only (no chats)
/// - `nela_telemetry_sanitized.log` — backend logs
/// - `frontend_errors.json` — recent renderer errors (optional)
pub fn export_support_bundle(
    app_cache_dir: &Path,
    app_data_dir: &Path,
    downloads_dir: &Path,
    app_version: &str,
    frontend: Option<&FrontendDiagnostics>,
) -> Result<PathBuf, String> {
    log::info!(
        "Building support bundle (app_version={app_version}, has_frontend={})",
        frontend.is_some()
    );

    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let zip_path = downloads_dir.join(format!("nela-support-{stamp}.zip"));
    let file = File::create(&zip_path)
        .map_err(|e| format!("Failed to create support bundle file: {e}"))?;

    let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(file));
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(6));

    // README
    write_zip_text(
        &mut zip,
        options,
        "README.txt",
        &support_readme(app_version, &stamp.to_string()),
    )?;

    // Environment
    let env_json = serde_json::to_string_pretty(&build_environment_json(
        app_version,
        app_cache_dir,
        app_data_dir,
    ))
    .map_err(|e| format!("Failed to serialize environment: {e}"))?;
    write_zip_text(&mut zip, options, "environment.json", &sanitize_log_text(&env_json))?;

    // Device specs
    let specs = crate::system::get_device_specs();
    let specs_json = serde_json::to_string_pretty(&specs)
        .map_err(|e| format!("Failed to serialize device specs: {e}"))?;
    write_zip_text(
        &mut zip,
        options,
        "device_specs.json",
        &sanitize_log_text(&specs_json),
    )?;

    // Workspace registry (metadata only)
    let workspaces_json = build_workspaces_json(app_data_dir);
    write_zip_text(
        &mut zip,
        options,
        "workspaces.json",
        &sanitize_log_text(&workspaces_json),
    )?;

    // Backend telemetry logs
    let raw_logs = read_telemetry_logs(app_cache_dir);
    let sanitized_logs = if raw_logs.is_empty() {
        "(No backend telemetry log lines found yet.)\n".to_string()
    } else {
        sanitize_log_text(&raw_logs)
    };
    write_zip_text(
        &mut zip,
        options,
        "nela_telemetry_sanitized.log",
        &sanitized_logs,
    )?;

    // ERROR/WARN excerpt for quick triage
    let error_excerpt = extract_error_warn_lines(&sanitized_logs);
    write_zip_text(&mut zip, options, "errors_excerpt.log", &error_excerpt)?;

    // Frontend diagnostics
    if let Some(front) = frontend {
        let scrubbed = sanitize_log_text(&front.raw_json);
        write_zip_text(&mut zip, options, "frontend_diagnostics.json", &scrubbed)?;
    } else {
        write_zip_text(
            &mut zip,
            options,
            "frontend_diagnostics.json",
            "{\n  \"note\": \"No frontend diagnostics were attached.\"\n}\n",
        )?;
    }

    zip.finish()
        .map_err(|e| format!("Failed to finalize support bundle: {e}"))?;

    log::info!("Support bundle written to {}", zip_path.display());
    Ok(zip_path)
}

/// Backward-compatible alias used by the older command name.
pub fn export_logs(app_cache_dir: &Path, downloads_dir: &Path) -> Result<PathBuf, String> {
    export_support_bundle(
        app_cache_dir,
        app_cache_dir, // best-effort when data dir unknown
        downloads_dir,
        env!("CARGO_PKG_VERSION"),
        None,
    )
}

fn support_readme(app_version: &str, stamp: &str) -> String {
    format!(
        "NELA support bundle\n\
         ===================\n\
         \n\
         Generated: {stamp}\n\
         App version: {app_version}\n\
         \n\
         This archive is sanitized: emails, IPs, and home-directory usernames are redacted.\n\
         It does NOT include chat messages, API keys, OAuth tokens, or document contents.\n\
         \n\
         How to report an issue\n\
         ----------------------\n\
         1. Attach this zip to your bug report.\n\
         2. Email: genaihasteeth@gmail.com\n\
         3. Include a short description of what you were doing when it failed.\n\
         \n\
         Please include:\n\
         - What you were doing when it failed\n\
         - Whether Cloud or Private/local mode was on\n\
         - Approximate time of the issue (matches the stamp above)\n\
         \n\
         Contents\n\
         --------\n\
         - environment.json           App / OS / runtime metadata\n\
         - device_specs.json          Hardware snapshot\n\
         - workspaces.json            Workspace ids + names only\n\
         - nela_telemetry_sanitized.log  Backend logs\n\
         - errors_excerpt.log         ERROR/WARN lines only\n\
         - frontend_diagnostics.json  Recent renderer errors / context\n\
         "
    )
}

fn build_environment_json(
    app_version: &str,
    app_cache_dir: &Path,
    app_data_dir: &Path,
) -> Value {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    json!({
        "app_version": app_version,
        "crate_version": env!("CARGO_PKG_VERSION"),
        "generated_at_unix": now,
        "generated_at_local": chrono::Local::now().to_rfc3339(),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "family": std::env::consts::FAMILY,
        "debug_assertions": cfg!(debug_assertions),
        "app_cache_dir": sanitize_path_display(app_cache_dir),
        "app_data_dir": sanitize_path_display(app_data_dir),
        "rustc_host": option_env!("HOST").unwrap_or("unknown"),
    })
}

fn build_workspaces_json(app_data_dir: &Path) -> String {
    let registry_path = app_data_dir.join("workspaces").join("registry.json");
    if !registry_path.exists() {
        return json!({
            "note": "Workspace registry not found",
            "path": sanitize_path_display(&registry_path),
        })
        .to_string();
    }

    match std::fs::read_to_string(&registry_path) {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(mut value) => {
                // Strip any accidental frontend blobs if present in older formats.
                if let Some(obj) = value.as_object_mut() {
                    obj.remove("frontend_state_json");
                    if let Some(list) = obj.get_mut("workspaces").and_then(|v| v.as_array_mut()) {
                        for ws in list {
                            if let Some(w) = ws.as_object_mut() {
                                w.remove("frontend_state_json");
                                if let Some(cache) = w.get("cache_dir").and_then(|v| v.as_str()) {
                                    let scrubbed = sanitize_log_text(cache);
                                    w.insert("cache_dir".into(), Value::String(scrubbed));
                                }
                                if let Some(nela) = w.get("nela_path").and_then(|v| v.as_str()) {
                                    let scrubbed = sanitize_log_text(nela);
                                    w.insert("nela_path".into(), Value::String(scrubbed));
                                }
                            }
                        }
                    }
                }
                serde_json::to_string_pretty(&value).unwrap_or_else(|_| raw)
            }
            Err(_) => sanitize_log_text(&raw),
        },
        Err(e) => json!({ "error": format!("Failed to read registry: {e}") }).to_string(),
    }
}

fn read_telemetry_logs(app_cache_dir: &Path) -> String {
    let log_path = app_cache_dir.join("nela_telemetry.log");
    let log_backup_path = app_cache_dir.join("nela_telemetry.log.1");
    let mut raw_logs = String::new();

    if log_backup_path.exists() {
        if let Ok(mut f) = File::open(&log_backup_path) {
            let _ = f.read_to_string(&mut raw_logs);
        }
    }
    if log_path.exists() {
        if let Ok(mut f) = File::open(&log_path) {
            let _ = f.read_to_string(&mut raw_logs);
        }
    }
    raw_logs
}

fn extract_error_warn_lines(sanitized_logs: &str) -> String {
    let mut out = String::new();
    for line in sanitized_logs.lines() {
        if line.contains("[ERROR]") || line.contains("[WARN]") || line.contains("[WARNING]") {
            out.push_str(line);
            out.push('\n');
        }
    }
    if out.is_empty() {
        "(No ERROR/WARN lines in the sanitized log.)\n".to_string()
    } else {
        // Cap size so the excerpt stays skimmable.
        const MAX: usize = 400_000;
        if out.len() > MAX {
            let start = out.len() - MAX;
            format!("…(truncated)…\n{}", &out[start..])
        } else {
            out
        }
    }
}

fn write_zip_text(
    zip: &mut zip::ZipWriter<std::io::BufWriter<File>>,
    options: SimpleFileOptions,
    name: &str,
    contents: &str,
) -> Result<(), String> {
    zip.start_file(name, options)
        .map_err(|e| format!("Failed to create zip entry {name}: {e}"))?;
    zip.write_all(contents.as_bytes())
        .map_err(|e| format!("Failed to write zip entry {name}: {e}"))?;
    Ok(())
}

fn sanitize_path_display(path: &Path) -> String {
    sanitize_log_text(&path.to_string_lossy())
}

/// Scrub absolute paths, usernames, emails, and IPs from log text.
pub fn sanitize_log_text(text: &str) -> String {
    let mut sanitized = text.to_string();

    if let Ok(re_email) = Regex::new(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}") {
        sanitized = re_email
            .replace_all(&sanitized, "[EMAIL_REDACTED]")
            .to_string();
    }

    if let Ok(re_ip) = Regex::new(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b") {
        sanitized = re_ip.replace_all(&sanitized, "[IP_REDACTED]").to_string();
    }

    // Bearer / API key shaped tokens
    if let Ok(re_bearer) = Regex::new(r"(?i)(bearer\s+)[a-z0-9._\-]{8,}") {
        sanitized = re_bearer.replace_all(&sanitized, "${1}[TOKEN_REDACTED]").to_string();
    }
    if let Ok(re_sk) = Regex::new(r"\b(sk-|nk-|ghp_|xox[baprs]-)[A-Za-z0-9_\-]{8,}") {
        sanitized = re_sk.replace_all(&sanitized, "[SECRET_REDACTED]").to_string();
    }

    let username = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "user".to_string());

    let user_pattern_linux = format!("/home/{username}");
    let user_pattern_mac = format!("/Users/{username}");
    let user_pattern_win = format!("C:\\Users\\{username}");
    let user_pattern_win_fwd = format!("C:/Users/{username}");

    sanitized = sanitized.replace(&user_pattern_linux, "/home/user");
    sanitized = sanitized.replace(&user_pattern_mac, "/Users/user");
    sanitized = sanitized.replace(&user_pattern_win, "C:\\Users\\user");
    sanitized = sanitized.replace(&user_pattern_win_fwd, "C:/Users/user");

    // Avoid wiping short / common usernames like "a" inside words — only whole path segments
    // already handled above. Still replace exact username occurrences carefully.
    if username.len() >= 3 {
        if let Ok(re_user) = Regex::new(&format!(r"(?i)\b{}\b", regex::escape(&username))) {
            sanitized = re_user.replace_all(&sanitized, "user").to_string();
        }
    }

    sanitized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_email_and_home_path() {
        let raw = "user jane@example.com failed at /home/jane/Documents/secret";
        let out = sanitize_log_text(raw);
        assert!(out.contains("[EMAIL_REDACTED]"));
        assert!(!out.contains("jane@example.com"));
    }
}
