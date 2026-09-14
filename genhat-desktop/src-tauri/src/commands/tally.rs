//! Tally connector Tauri commands (read-only localhost XML HTTP).

use crate::connectors::tally::{
    self, TallyDaybookResult, TallyLedgersResult, TallyOutstandingResult, TallyScanResult,
    TallyStatus, TallyTrialBalanceResult,
};
use tauri::{AppHandle, Manager};

fn bind_app_data(app: &AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not open app data on this device.".to_string())?;
    std::fs::create_dir_all(&dir)
        .map_err(|_| "Could not open app data on this device.".to_string())?;
    tally::set_app_data_dir(dir);
    Ok(())
}

#[tauri::command]
pub fn tally_status(app: AppHandle) -> Result<TallyStatus, String> {
    bind_app_data(&app)?;
    tally::status()
}

#[tauri::command]
pub async fn tally_connect(
    app: AppHandle,
    host: String,
    port: u16,
    company: Option<String>,
) -> Result<TallyStatus, String> {
    bind_app_data(&app)?;
    tally::connect(host, port, company).await
}

#[tauri::command]
pub async fn tally_disconnect(app: AppHandle) -> Result<TallyStatus, String> {
    bind_app_data(&app)?;
    tally::disconnect()
}

#[tauri::command]
pub async fn tally_ping(app: AppHandle) -> Result<TallyStatus, String> {
    bind_app_data(&app)?;
    tally::ping().await
}

#[tauri::command]
pub async fn tally_scan_ports(
    app: AppHandle,
    host: Option<String>,
) -> Result<TallyScanResult, String> {
    bind_app_data(&app)?;
    tally::scan_ports(host).await
}

#[tauri::command]
pub async fn tally_list_ledgers(
    app: AppHandle,
    group: Option<String>,
    max_rows: Option<usize>,
) -> Result<TallyLedgersResult, String> {
    bind_app_data(&app)?;
    tally::list_ledgers(group, max_rows).await
}

#[tauri::command]
pub async fn tally_trial_balance(
    app: AppHandle,
    from_date: Option<String>,
    to_date: Option<String>,
    max_rows: Option<usize>,
) -> Result<TallyTrialBalanceResult, String> {
    bind_app_data(&app)?;
    tally::trial_balance(from_date, to_date, max_rows).await
}

#[tauri::command]
pub async fn tally_daybook(
    app: AppHandle,
    from_date: Option<String>,
    to_date: Option<String>,
    voucher_type: Option<String>,
    max_rows: Option<usize>,
) -> Result<TallyDaybookResult, String> {
    bind_app_data(&app)?;
    tally::daybook(from_date, to_date, voucher_type, max_rows).await
}

#[tauri::command]
pub async fn tally_outstanding(
    app: AppHandle,
    max_rows: Option<usize>,
) -> Result<TallyOutstandingResult, String> {
    bind_app_data(&app)?;
    tally::outstanding(max_rows).await
}
