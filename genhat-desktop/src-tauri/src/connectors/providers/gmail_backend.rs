//! Gmail adapter for the connector registry.
//!
//! OAuth is brokered by nela-backend (`cloud_broker`). Tokens stay on-device.
//! File-mirror ops are N/A; chat send/read go through `gmail_send` / `gmail_read`.

use crate::connectors::backend::ConnectorBackend;
use crate::connectors::error::ConnectorError;
use crate::connectors::gmail::{self, GmailStatus};
use crate::connectors::types::{
    ConnectionId, ConnectionInfo, ConnectionStatus, RemoteEntry, RemoteId, SyncReport,
};
use async_trait::async_trait;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub struct GmailBackend;

fn bind_app_data(app: &AppHandle) -> Result<(), ConnectorError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| ConnectorError::io(e.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|e| ConnectorError::io(e.to_string()))?;
    gmail::set_app_data_dir(dir);
    Ok(())
}

fn status_to_connection(status: GmailStatus) -> Option<ConnectionInfo> {
    if !status.connected {
        return None;
    }
    Some(ConnectionInfo {
        id: ConnectionId("gmail".into()),
        provider_id: "gmail".into(),
        display_name: "Gmail".into(),
        account_email: status.email,
        remote_folder_id: None,
        remote_folder_name: None,
        mirror_root: None,
        last_sync_at: None,
        status: ConnectionStatus::Connected,
    })
}

#[async_trait]
impl ConnectorBackend for GmailBackend {
    fn id(&self) -> &'static str {
        "gmail"
    }

    async fn connect_account(&self, _app: &AppHandle) -> Result<ConnectionInfo, ConnectorError> {
        Err(ConnectorError::invalid(
            crate::connectors::google_oauth::CREDENTIALS_ON_BACKEND.to_string(),
        ))
    }

    fn account_status(&self, app: &AppHandle) -> Result<Option<ConnectionInfo>, ConnectorError> {
        bind_app_data(app)?;
        let status = gmail::status().map_err(ConnectorError::io)?;
        Ok(status_to_connection(status))
    }

    async fn disconnect_account(&self, app: &AppHandle) -> Result<(), ConnectorError> {
        bind_app_data(app)?;
        gmail::disconnect()
            .await
            .map_err(ConnectorError::io)?;
        Ok(())
    }

    async fn list_children(
        &self,
        _app_data: &Path,
        _conn: &ConnectionId,
        _parent: Option<&RemoteId>,
    ) -> Result<Vec<RemoteEntry>, ConnectorError> {
        Err(ConnectorError::invalid(
            "Gmail does not browse folders. Use Connect to authorize send.",
        ))
    }

    async fn sync_folder(
        &self,
        _app_data: &Path,
        _conn: &ConnectionId,
        _remote_folder: Option<&RemoteId>,
    ) -> Result<SyncReport, ConnectorError> {
        Err(ConnectorError::invalid(
            "Gmail does not sync folders into File Indexer.",
        ))
    }

    async fn fetch_file(
        &self,
        _app_data: &Path,
        _conn: &ConnectionId,
        _id: &RemoteId,
    ) -> Result<PathBuf, ConnectorError> {
        Err(ConnectorError::invalid("Gmail does not fetch files."))
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
        Err(ConnectorError::invalid(
            "Gmail creates mail via send, not file upload.",
        ))
    }

    async fn update_file(
        &self,
        _app_data: &Path,
        _conn: &ConnectionId,
        _id: &RemoteId,
        _bytes: &[u8],
    ) -> Result<RemoteEntry, ConnectorError> {
        Err(ConnectorError::invalid("Gmail does not update files."))
    }
}
