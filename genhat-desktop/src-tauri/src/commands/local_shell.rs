//! Allowlisted local shell for LLM deep-read after Doc Graph search.
//!
//! Executes argv only (never `/bin/sh -c`). No path jail — any readable path
//! is allowed. Binary allowlist + find-flag denylist are the safety controls.

use serde::Serialize;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::timeout;

const MAX_OUTPUT_BYTES: usize = 128 * 1024;
const MAX_CAT_PATHS: usize = 20;
const DEFAULT_TIMEOUT_SECS: u64 = 5;

const ALLOWED_BINARIES: &[&str] = &[
    "ls", "cat", "head", "tail", "wc", "grep", "rg", "find",
];

/// `find` flags that enable write/exec side effects — always rejected.
const FIND_DENIED_FLAGS: &[&str] = &[
    "-exec",
    "-execdir",
    "-ok",
    "-okdir",
    "-delete",
    "-fprint",
    "-fprint0",
    "-fls",
    "-fprintf",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalShellResult {
    pub ok: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn basename_program(argv0: &str) -> Option<String> {
    let p = Path::new(argv0);
    // Reject path-qualified binaries (./evil, /usr/bin/python).
    if argv0.contains('/') || argv0.contains('\\') {
        return None;
    }
    let name = p.file_name()?.to_str()?.to_lowercase();
    // Strip .exe on Windows-style names.
    let name = name.strip_suffix(".exe").unwrap_or(&name).to_string();
    Some(name)
}

fn is_allowed_program(name: &str) -> bool {
    ALLOWED_BINARIES.iter().any(|b| *b == name)
}

/// Validate argv before spawn. Returns Ok(program_basename) or Err(message).
pub fn validate_local_shell_argv(argv: &[String]) -> Result<String, String> {
    if argv.is_empty() {
        return Err("local_shell requires a non-empty argv".into());
    }
    let prog = basename_program(&argv[0])
        .ok_or_else(|| "program must be an allowlisted name (not a path)".to_string())?;
    if !is_allowed_program(&prog) {
        return Err(format!(
            "program `{prog}` is not allowed. Allowed: {}",
            ALLOWED_BINARIES.join(", ")
        ));
    }

    if prog == "find" {
        for arg in &argv[1..] {
            let lower = arg.to_lowercase();
            if FIND_DENIED_FLAGS.iter().any(|f| lower == *f) {
                return Err(format!("find flag `{arg}` is not allowed"));
            }
        }
    }

    if prog == "cat" {
        let paths: Vec<_> = argv[1..]
            .iter()
            .filter(|a| !a.starts_with('-'))
            .collect();
        if paths.len() > MAX_CAT_PATHS {
            return Err(format!(
                "cat is limited to {MAX_CAT_PATHS} files per call"
            ));
        }
    }

    // Soft guard: reject nul bytes in arguments.
    for (i, arg) in argv.iter().enumerate() {
        if i == 0 {
            continue;
        }
        if arg.contains('\0') {
            return Err("nul byte in argument is not allowed".into());
        }
    }

    Ok(prog)
}

fn truncate_bytes(mut buf: Vec<u8>, cap: usize) -> (String, bool) {
    let truncated = buf.len() > cap;
    if truncated {
        buf.truncate(cap);
    }
    let lossy = String::from_utf8_lossy(&buf).into_owned();
    (lossy, truncated)
}

#[tauri::command]
pub async fn local_shell_run(
    argv: Vec<String>,
    cwd: Option<String>,
) -> Result<LocalShellResult, String> {
    let prog = match validate_local_shell_argv(&argv) {
        Ok(p) => p,
        Err(e) => {
            return Ok(LocalShellResult {
                ok: false,
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                truncated: false,
                command: argv.join(" "),
                error: Some(e),
            });
        }
    };

    let command_display = argv.join(" ");
    let mut cmd = Command::new(&prog);
    if argv.len() > 1 {
        cmd.args(&argv[1..]);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    if let Some(dir) = cwd.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        cmd.current_dir(dir);
    }

    // Clear a few sensitive env vars from the child (best-effort).
    cmd.env_remove("AWS_SECRET_ACCESS_KEY");
    cmd.env_remove("OPENAI_API_KEY");
    cmd.env_remove("ANTHROPIC_API_KEY");

    let child_result = timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS), async {
        let mut child = cmd.spawn().map_err(|e| format!("failed to spawn `{prog}`: {e}"))?;
        let stdout_pipe = child.stdout.take();
        let stderr_pipe = child.stderr.take();
        let (stdout, stderr) = tokio::join!(
            async {
                let mut buf = Vec::new();
                if let Some(mut out) = stdout_pipe {
                    let _ = out.read_to_end(&mut buf).await;
                }
                buf
            },
            async {
                let mut buf = Vec::new();
                if let Some(mut err) = stderr_pipe {
                    let _ = err.read_to_end(&mut buf).await;
                }
                buf
            }
        );
        let status = child
            .wait()
            .await
            .map_err(|e| format!("wait failed: {e}"))?;
        Ok::<_, String>((status, stdout, stderr))
    })
    .await;

    match child_result {
        Err(_) => Ok(LocalShellResult {
            ok: false,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            truncated: false,
            command: command_display,
            error: Some(format!(
                "command timed out after {DEFAULT_TIMEOUT_SECS}s"
            )),
        }),
        Ok(Err(e)) => Ok(LocalShellResult {
            ok: false,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            truncated: false,
            command: command_display,
            error: Some(e),
        }),
        Ok(Ok((status, stdout_raw, stderr_raw))) => {
            let (stdout, t1) = truncate_bytes(stdout_raw, MAX_OUTPUT_BYTES);
            let (stderr, t2) = truncate_bytes(stderr_raw, MAX_OUTPUT_BYTES / 4);
            let code = status.code();
            let ok = status.success();
            Ok(LocalShellResult {
                ok,
                exit_code: code,
                stdout,
                stderr,
                truncated: t1 || t2,
                command: command_display,
                error: if ok {
                    None
                } else {
                    Some(format!(
                        "exit code {}",
                        code.map(|c| c.to_string()).unwrap_or_else(|| "?".into())
                    ))
                },
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn allows_cat_ls_grep() {
        assert!(validate_local_shell_argv(&argv(&["cat", "/tmp/a.txt"])).is_ok());
        assert!(validate_local_shell_argv(&argv(&["ls", "-la", "/home"])).is_ok());
        assert!(validate_local_shell_argv(&argv(&["grep", "-n", "foo", "a.txt"])).is_ok());
        assert!(validate_local_shell_argv(&argv(&["rg", "pattern", "."])).is_ok());
        assert!(validate_local_shell_argv(&argv(&["head", "-n", "20", "f"])).is_ok());
        assert!(validate_local_shell_argv(&argv(&["wc", "-l", "f"])).is_ok());
    }

    #[test]
    fn denies_rm_curl_bash() {
        assert!(validate_local_shell_argv(&argv(&["rm", "-rf", "/"])).is_err());
        assert!(validate_local_shell_argv(&argv(&["curl", "https://x"])).is_err());
        assert!(validate_local_shell_argv(&argv(&["bash", "-c", "ls"])).is_err());
        assert!(validate_local_shell_argv(&argv(&["sh", "-c", "ls"])).is_err());
        assert!(validate_local_shell_argv(&argv(&["python", "x.py"])).is_err());
    }

    #[test]
    fn denies_path_qualified_binary() {
        assert!(validate_local_shell_argv(&argv(&["/bin/cat", "a"])).is_err());
        assert!(validate_local_shell_argv(&argv(&["./cat", "a"])).is_err());
    }

    #[test]
    fn denies_find_exec_delete() {
        assert!(validate_local_shell_argv(&argv(&["find", ".", "-exec", "rm", "{}", ";"])).is_err());
        assert!(validate_local_shell_argv(&argv(&["find", ".", "-delete"])).is_err());
        assert!(validate_local_shell_argv(&argv(&["find", ".", "-name", "*.txt"])).is_ok());
    }

    #[test]
    fn denies_too_many_cat_files() {
        let mut parts = vec!["cat".to_string()];
        for i in 0..25 {
            parts.push(format!("f{i}.txt"));
        }
        assert!(validate_local_shell_argv(&parts).is_err());
    }

    #[test]
    fn empty_argv_fails() {
        assert!(validate_local_shell_argv(&[]).is_err());
    }
}
