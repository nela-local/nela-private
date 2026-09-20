//! Tally adapter for the connector registry (chat tools; no folder mirror).

use crate::connectors::backend::ConnectorBackend;
use crate::connectors::error::ConnectorError;
use crate::connectors::tally::{self, TallyStatus};
use crate::connectors::types::{
    ConnectionId, ConnectionInfo, ConnectionStatus, RemoteEntry, RemoteId, SyncReport,
};
use async_trait::async_trait;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub struct TallyBackend;

fn bind_app_data(app: &AppHandle) -> Result<(), ConnectorError> {
    if let Some(ws) = app.try_state::<crate::commands::workspace::WorkspaceState>() {
        if let Ok(dir) = ws.0.active_connectors_root() {
            tally::set_app_data_dir(dir);
            return Ok(());
        }
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| ConnectorError::io(e.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|e| ConnectorError::io(e.to_string()))?;
    tally::set_app_data_dir(dir);
    Ok(())
}

fn status_to_connection(status: TallyStatus) -> Option<ConnectionInfo> {
    if !status.connected {
        return None;
    }
    let label = status
        .company
        .clone()
        .or_else(|| {
            status
                .host
                .as_ref()
                .zip(status.port)
                .map(|(h, p)| format!("{h}:{p}"))
        })
        .unwrap_or_else(|| "Tally".into());
    // Prefer company as the account label; append host:port when company is set
    // so Settings shows "Tally · Quadragen" without a fake "Folder:" line.
    let account = match (
        status.company.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()),
        status.host.as_ref().zip(status.port),
    ) {
        (Some(company), Some((h, p))) => Some(format!("{company} ({h}:{p})")),
        (Some(company), None) => Some(company.to_string()),
        (None, Some((h, p))) => Some(format!("{h}:{p}")),
        (None, None) => Some(label),
    };
    Some(ConnectionInfo {
        id: ConnectionId("tally".into()),
        provider_id: "tally".into(),
        display_name: "Tally".into(),
        account_email: account,
        remote_folder_id: None,
        // Not a storage connector — never set remote_folder_* (UI would show Browse / Folder).
        remote_folder_name: None,
        mirror_root: None,
        last_sync_at: None,
        status: ConnectionStatus::Connected,
    })
}

#[async_trait]
impl ConnectorBackend for TallyBackend {
    fn id(&self) -> &'static str {
        "tally"
    }

    async fn connect_account(&self, _app: &AppHandle) -> Result<ConnectionInfo, ConnectorError> {
        Err(ConnectorError::invalid(
            "Connect Tally from Settings with host, port, and company.",
        ))
    }

    fn account_status(&self, app: &AppHandle) -> Result<Option<ConnectionInfo>, ConnectorError> {
        bind_app_data(app)?;
        let status = tally::status().map_err(ConnectorError::io)?;
        Ok(status_to_connection(status))
    }

    async fn disconnect_account(&self, app: &AppHandle) -> Result<(), ConnectorError> {
        bind_app_data(app)?;
        let _ = tally::disconnect().map_err(ConnectorError::io)?;
        Ok(())
    }

    async fn list_children(
        &self,
        _app_data: &Path,
        _conn: &ConnectionId,
        _parent: Option<&RemoteId>,
    ) -> Result<Vec<RemoteEntry>, ConnectorError> {
        Err(ConnectorError::invalid(
            "Tally does not browse folders. Use chat tools for read-only reports.",
        ))
    }

    async fn sync_folder(
        &self,
        _app_data: &Path,
        _conn: &ConnectionId,
        _remote_folder: Option<&RemoteId>,
    ) -> Result<SyncReport, ConnectorError> {
        Err(ConnectorError::invalid(
            "Tally does not sync into File Indexer.",
        ))
    }

    async fn fetch_file(
        &self,
        _app_data: &Path,
        _conn: &ConnectionId,
        _id: &RemoteId,
    ) -> Result<PathBuf, ConnectorError> {
        Err(ConnectorError::invalid("Tally does not fetch files."))
    }

    async fn create_file(
        &self,
        _app_data: &Path,
        _conn: &ConnectionId,
        _parent: Option<&RemoteId>,
        _name: &str,
        _bytes: &[u8],
        _mime: Option<&str>,
    ) -> Result<RemoteEntry, ConnectorError> {
        Err(ConnectorError::invalid("Tally connector is read-only."))
    }

    async fn update_file(
        &self,
        _app_data: &Path,
        _conn: &ConnectionId,
        _id: &RemoteId,
        _bytes: &[u8],
    ) -> Result<RemoteEntry, ConnectorError> {
        Err(ConnectorError::invalid("Tally connector is read-only."))
    }
}
