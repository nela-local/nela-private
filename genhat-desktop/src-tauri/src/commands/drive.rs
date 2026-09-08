//! Google Drive chat tools — search / recent / get with links + text.

use crate::connectors::providers::gdrive::{
    self, DriveGetResult, DriveListResult,
};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not open app data on this device.".to_string())?;
    std::fs::create_dir_all(&dir)
        .map_err(|_| "Could not open app data on this device.".to_string())?;
    Ok(dir)
}

#[tauri::command]
pub async fn drive_search(
    app: AppHandle,
    query: String,
    max_results: Option<u32>,
) -> Result<DriveListResult, String> {
    let dir = app_data(&app)?;
    Ok(gdrive::search_files(&dir, &query, max_results).await)
}

#[tauri::command]
pub async fn drive_list_recent(
    app: AppHandle,
    max_results: Option<u32>,
) -> Result<DriveListResult, String> {
    let dir = app_data(&app)?;
    Ok(gdrive::list_recent(&dir, max_results).await)
}

#[tauri::command]
pub async fn drive_get(
    app: AppHandle,
    file_id: String,
) -> Result<DriveGetResult, String> {
    let dir = app_data(&app)?;
    Ok(gdrive::get_file_for_chat(&dir, &file_id).await)
}

#[tauri::command]
pub fn drive_status(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = app_data(&app)?;
    match gdrive::resolve_gdrive_connection(&dir) {
        Ok(id) => {
            let email = crate::connectors::connections::get(&dir, &id)
                .ok()
                .flatten()
                .and_then(|c| c.account_email);
            Ok(serde_json::json!({
                "connected": true,
                "connectionId": id.0,
                "email": email,
            }))
        }
        Err(_) => Ok(serde_json::json!({
            "connected": false,
            "connectionId": null,
            "email": null,
        })),
    }
}
