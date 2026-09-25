//! Tauri IPC for Computer Use (jev-agent sidecar).

use crate::computer_use::{
    self, ComputerUseRespondRequest, ComputerUseRunRequest, ComputerUseRunResult, ComputerUseState,
};
use serde_json::Value;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn computer_use_run(
    app: AppHandle,
    state: State<'_, ComputerUseState>,
    request: ComputerUseRunRequest,
) -> Result<ComputerUseRunResult, String> {
    computer_use::run_goal(&*state, app, request).await
}

#[tauri::command]
pub async fn computer_use_respond(
    state: State<'_, ComputerUseState>,
    request: ComputerUseRespondRequest,
) -> Result<(), String> {
    computer_use::respond(&*state, request).await
}

#[tauri::command]
pub async fn computer_use_cancel(
    state: State<'_, ComputerUseState>,
    run_id: Option<String>,
) -> Result<(), String> {
    computer_use::cancel(&*state, run_id).await
}

#[tauri::command]
pub async fn computer_use_status(
    state: State<'_, ComputerUseState>,
) -> Result<Value, String> {
    computer_use::status(&*state).await
}
