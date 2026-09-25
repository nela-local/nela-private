//! Computer Use host — long-lived jev-agent stdio sidecar.
//!
//! Spawns `python -m src.sidecar` under `jev-agent/`, forwards NDJSON events
//! to the frontend (`computer-use-event`), and exposes run / respond / cancel.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

const EVENT_NAME: &str = "computer-use-event";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseRunRequest {
    pub goal: String,
    pub run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseRespondRequest {
    pub run_id: String,
    pub answer: String,
    /// "confirm" | "clarify"
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseRunResult {
    pub run_id: String,
    pub status: String,
    pub summary: String,
    pub nela_calls: u64,
}

struct PendingDone {
    run_id: String,
    tx: oneshot::Sender<ComputerUseRunResult>,
}

struct ComputerUseInner {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    ready: bool,
    pending_done: Option<PendingDone>,
    /// Recent event lines for status UI
    recent: VecDeque<Value>,
    last_status: Option<Value>,
}

pub struct ComputerUseState {
    inner: Arc<Mutex<ComputerUseInner>>,
}

impl Default for ComputerUseState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(ComputerUseInner {
                child: None,
                stdin: None,
                ready: false,
                pending_done: None,
                recent: VecDeque::with_capacity(64),
                last_status: None,
            })),
        }
    }
}

fn resolve_jev_root() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("JEV_AGENT_ROOT") {
        let path = PathBuf::from(p);
        if path.is_dir() {
            return Ok(path);
        }
        return Err(format!("JEV_AGENT_ROOT is not a directory: {}", path.display()));
    }

    // Dev: nela/genhat-desktop/src-tauri → ../../../jev-agent
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest.join("../../../jev-agent"),
        manifest.join("../../../../jev-agent"),
        PathBuf::from("/home/amogh/Documents/8thsem/major-project/jev-agent"),
    ];
    for c in candidates {
        if let Ok(canon) = c.canonicalize() {
            if canon.is_dir() && canon.join("src/sidecar.py").is_file() {
                return Ok(canon);
            }
        }
    }
    Err(
        "Could not find jev-agent. Set JEV_AGENT_ROOT or keep the repo at major-project/jev-agent."
            .into(),
    )
}

fn resolve_python(jev_root: &Path) -> PathBuf {
    let venv_unix = jev_root.join(".venv/bin/python");
    if venv_unix.is_file() {
        return venv_unix;
    }
    let venv_win = jev_root.join(".venv/Scripts/python.exe");
    if venv_win.is_file() {
        return venv_win;
    }
    PathBuf::from("python3")
}

async fn ensure_sidecar(
    state: &Arc<Mutex<ComputerUseInner>>,
    app: &AppHandle,
) -> Result<(), String> {
    {
        let guard = state.lock().await;
        if guard.child.is_some() && guard.stdin.is_some() {
            return Ok(());
        }
    }

    let jev_root = resolve_jev_root()?;
    let python = resolve_python(&jev_root);
    log::info!(
        "Starting jev-agent sidecar: {} -m src.sidecar (cwd={})",
        python.display(),
        jev_root.display()
    );

    let mut cmd = Command::new(&python);
    cmd.arg("-m")
        .arg("src.sidecar")
        .current_dir(&jev_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // Load .env from jev-agent via python-dotenv inside process; also inherit env
    cmd.env("PYTHONUNBUFFERED", "1");

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn jev-agent sidecar ({}): {e}", python.display()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "sidecar stdout missing".to_string())?;
    let stderr = child.stderr.take();
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "sidecar stdin missing".to_string())?;

    {
        let mut guard = state.lock().await;
        guard.child = Some(child);
        guard.stdin = Some(stdin);
        guard.ready = false;
    }

    // stderr → log
    if let Some(err) = stderr {
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                log::info!("[jev-sidecar] {line}");
            }
        });
    }

    // stdout reader
    let state_r = state.clone();
    let app_r = app.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(val) = serde_json::from_str::<Value>(&line) else {
                log::warn!("jev-sidecar non-json: {line}");
                continue;
            };
            handle_sidecar_event(&state_r, &app_r, val).await;
        }
        log::warn!("jev-sidecar stdout closed");
        let mut guard = state_r.lock().await;
        guard.child = None;
        guard.stdin = None;
        guard.ready = false;
        if let Some(pending) = guard.pending_done.take() {
            let _ = pending.tx.send(ComputerUseRunResult {
                run_id: pending.run_id,
                status: "error".into(),
                summary: "Computer-use sidecar exited unexpectedly".into(),
                nela_calls: 0,
            });
        }
    });

    // Wait briefly for ready
    for _ in 0..50 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let guard = state.lock().await;
        if guard.ready {
            return Ok(());
        }
        if guard.child.is_none() {
            return Err("jev-agent sidecar exited before ready".into());
        }
    }
    // Proceed even if ready was missed (event race)
    Ok(())
}

async fn handle_sidecar_event(
    state: &Arc<Mutex<ComputerUseInner>>,
    app: &AppHandle,
    val: Value,
) {
    let event = val.get("event").and_then(|v| v.as_str()).unwrap_or("");
    {
        let mut guard = state.lock().await;
        if event == "ready" {
            guard.ready = true;
        }
        guard.last_status = Some(val.clone());
        if guard.recent.len() >= 64 {
            guard.recent.pop_front();
        }
        guard.recent.push_back(val.clone());

        if event == "done" {
            let run_id = val
                .get("run_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let status = val
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("ok")
                .to_string();
            let summary = val
                .get("summary")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let nela_calls = val
                .get("nela_calls")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            if let Some(pending) = guard.pending_done.take() {
                if pending.run_id == run_id || run_id.is_empty() {
                    let _ = pending.tx.send(ComputerUseRunResult {
                        run_id: pending.run_id,
                        status,
                        summary,
                        nela_calls,
                    });
                } else {
                    // put back if mismatched
                    guard.pending_done = Some(pending);
                }
            }
        }
    }

    let _ = app.emit(EVENT_NAME, &val);
}

async fn write_line(state: &Arc<Mutex<ComputerUseInner>>, obj: Value) -> Result<(), String> {
    let mut guard = state.lock().await;
    let stdin = guard
        .stdin
        .as_mut()
        .ok_or_else(|| "computer-use sidecar is not running".to_string())?;
    let line = serde_json::to_string(&obj).map_err(|e| e.to_string())? + "\n";
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("write sidecar stdin: {e}"))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("flush sidecar stdin: {e}"))?;
    Ok(())
}

pub async fn run_goal(
    state: &ComputerUseState,
    app: AppHandle,
    req: ComputerUseRunRequest,
) -> Result<ComputerUseRunResult, String> {
    let goal = req.goal.trim().to_string();
    if goal.is_empty() {
        return Err("goal is required".into());
    }
    let run_id = req
        .run_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("run-{}", uuid::Uuid::new_v4()));

    ensure_sidecar(&state.inner, &app).await?;

    {
        let guard = state.inner.lock().await;
        if guard.pending_done.is_some() {
            return Err("a computer-use run is already in progress".into());
        }
    }

    let (tx, rx) = oneshot::channel();
    {
        let mut guard = state.inner.lock().await;
        guard.pending_done = Some(PendingDone {
            run_id: run_id.clone(),
            tx,
        });
    }

    write_line(
        &state.inner,
        serde_json::json!({
            "op": "run",
            "goal": goal,
            "run_id": run_id,
        }),
    )
    .await?;

    // Bound wait so the chat tool loop cannot hang forever on a stuck Jev/NELA call.
    const RUN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);
    match tokio::time::timeout(RUN_TIMEOUT, rx).await {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(_)) => Err("computer-use run cancelled or sidecar died".into()),
        Err(_) => {
            log::warn!("computer-use run {run_id} timed out after {RUN_TIMEOUT:?}");
            let _ = write_line(
                &state.inner,
                serde_json::json!({
                    "op": "cancel",
                    "run_id": run_id,
                }),
            )
            .await;
            // Hard-reset sidecar — in-flight Jev HTTP cannot be interrupted otherwise.
            {
                let mut guard = state.inner.lock().await;
                if let Some(mut child) = guard.child.take() {
                    let _ = child.start_kill();
                }
                guard.stdin = None;
                guard.ready = false;
                guard.pending_done = None;
            }
            Err(
                "Computer Use timed out (180s). The sidecar was reset — try again."
                    .into(),
            )
        }
    }
}

pub async fn respond(
    state: &ComputerUseState,
    req: ComputerUseRespondRequest,
) -> Result<(), String> {
    let kind = req.kind.unwrap_or_else(|| "confirm".into());
    let op = if kind == "clarify" { "clarify" } else { "confirm" };
    write_line(
        &state.inner,
        serde_json::json!({
            "op": op,
            "run_id": req.run_id,
            "answer": req.answer,
        }),
    )
    .await
}

pub async fn cancel(state: &ComputerUseState, run_id: Option<String>) -> Result<(), String> {
    write_line(
        &state.inner,
        serde_json::json!({
            "op": "cancel",
            "run_id": run_id.unwrap_or_default(),
        }),
    )
    .await
}

pub async fn status(state: &ComputerUseState) -> Result<Value, String> {
    let guard = state.inner.lock().await;
    Ok(serde_json::json!({
        "running": guard.pending_done.is_some(),
        "sidecarAlive": guard.child.is_some(),
        "ready": guard.ready,
        "lastEvent": guard.last_status,
        "recent": guard.recent.iter().cloned().collect::<Vec<_>>(),
    }))
}
