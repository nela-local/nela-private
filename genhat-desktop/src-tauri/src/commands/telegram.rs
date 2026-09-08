//! Telegram connector Tauri commands (on-device MTProto).

use crate::connectors::telegram::{
    self, TelegramConnectNext, TelegramReadResult, TelegramSendResult, TelegramStatus,
};
use tauri::{AppHandle, Manager};

fn bind_app_data(app: &AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not open app data on this device.".to_string())?;
    std::fs::create_dir_all(&dir)
        .map_err(|_| "Could not open app data on this device.".to_string())?;
    telegram::set_app_data_dir(dir);
    Ok(())
}

#[tauri::command]
pub fn telegram_status(app: AppHandle) -> Result<TelegramStatus, String> {
    bind_app_data(&app)?;
    telegram::status()
}

#[tauri::command]
pub async fn telegram_connect_start(app: AppHandle, phone: String) -> Result<TelegramConnectNext, String> {
    bind_app_data(&app)?;
    telegram::connect_start(&phone).await
}

#[tauri::command]
pub async fn telegram_connect_code(app: AppHandle, code: String) -> Result<TelegramConnectNext, String> {
    bind_app_data(&app)?;
    telegram::connect_code(&code).await
}

#[tauri::command]
pub async fn telegram_connect_password(
    app: AppHandle,
    password: String,
) -> Result<TelegramConnectNext, String> {
    bind_app_data(&app)?;
    telegram::connect_password(&password).await
}

#[tauri::command]
pub async fn telegram_disconnect(app: AppHandle) -> Result<TelegramStatus, String> {
    bind_app_data(&app)?;
    telegram::disconnect().await
}

#[tauri::command]
pub async fn telegram_send(
    app: AppHandle,
    to: String,
    body: String,
) -> Result<TelegramSendResult, String> {
    bind_app_data(&app)?;
    telegram::send_message(&to, &body).await
}

#[tauri::command]
pub async fn telegram_read(
    app: AppHandle,
    max_results: Option<u32>,
) -> Result<TelegramReadResult, String> {
    bind_app_data(&app)?;
    telegram::read_messages(max_results).await
}
