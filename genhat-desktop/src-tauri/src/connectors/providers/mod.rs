//! Connector provider backends.
//!
//! Register implementations in [`register_all`]. Catalog entries in
//! `config/connectors.toml` control UI visibility; backends enable ops.
//!
//! ## Adding a connector
//! 1. Add `[[connector]]` in `src-tauri/src/config/connectors.toml`
//! 2. For `status = "available"`: add `providers/<id>.rs` + register below
//! 3. For `status = "coming_soon"`: TOML only — no Rust needed

pub mod dropbox;
pub mod gdrive;
pub mod gmail_backend;
pub mod local;
pub mod onedrive;
pub mod telegram;

use crate::connectors::backend::{register_backend, ConnectorBackend};
use crate::connectors::error::ConnectorError;
use crate::connectors::types::{ConnectionId, RemoteEntry, RemoteId, SyncReport};
use async_trait::async_trait;
use std::path::{Path, PathBuf};
use std::sync::Arc;

struct GDriveBackend;

#[async_trait]
impl ConnectorBackend for GDriveBackend {
    fn id(&self) -> &'static str {
        "gdrive"
    }

    fn account_status(
        &self,
        app: &tauri::AppHandle,
    ) -> Result<Option<crate::connectors::types::ConnectionInfo>, ConnectorError> {
        use tauri::Manager;
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| ConnectorError::io(e.to_string()))?;
        let Ok(conn) = gdrive::resolve_gdrive_connection(&dir) else {
            return Ok(None);
        };
        Ok(crate::connectors::connections::get(&dir, &conn).map_err(ConnectorError::io)?)
    }

    async fn disconnect_account(
        &self,
        app: &tauri::AppHandle,
    ) -> Result<(), ConnectorError> {
        use tauri::Manager;
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| ConnectorError::io(e.to_string()))?;
        let list = crate::connectors::connections::list(&dir).map_err(ConnectorError::io)?;
        for c in list.into_iter().filter(|c| c.provider_id == "gdrive") {
            let _ = crate::connectors::credentials::remove(&dir, &c.id.0);
            let _ = crate::connectors::connections::remove(&dir, &c.id);
        }
        Ok(())
    }

    async fn list_children(
        &self,
        app_data: &Path,
        conn: &ConnectionId,
        parent: Option<&RemoteId>,
    ) -> Result<Vec<RemoteEntry>, ConnectorError> {
        gdrive::list_children(app_data, conn, parent).await
    }

    async fn sync_folder(
        &self,
        app_data: &Path,
        conn: &ConnectionId,
        remote_folder: Option<&RemoteId>,
    ) -> Result<SyncReport, ConnectorError> {
        gdrive::sync_folder(app_data, conn, remote_folder).await
    }

    async fn fetch_file(
        &self,
        app_data: &Path,
        conn: &ConnectionId,
        id: &RemoteId,
    ) -> Result<PathBuf, ConnectorError> {
        gdrive::fetch_file(app_data, conn, id).await
    }

    async fn create_file(
        &self,
        app_data: &Path,
        conn: &ConnectionId,
        parent: Option<&RemoteId>,
        name: &str,
        bytes: &[u8],
        mime: Option<&str>,
    ) -> Result<RemoteEntry, ConnectorError> {
        gdrive::create_file(app_data, conn, parent, name, bytes, mime).await
    }

    async fn update_file(
        &self,
        app_data: &Path,
        conn: &ConnectionId,
        id: &RemoteId,
        bytes: &[u8],
    ) -> Result<RemoteEntry, ConnectorError> {
        gdrive::update_file(app_data, conn, id, bytes).await
    }
}

/// Wire every implemented backend. Coming-soon catalog entries need no registration.
pub fn register_all() {
    register_backend(Arc::new(GDriveBackend));
    register_backend(Arc::new(gmail_backend::GmailBackend));
    register_backend(Arc::new(telegram::TelegramBackend));
    let _ = (
        dropbox::PROVIDER_ID,
        onedrive::PROVIDER_ID,
        local::PROVIDER_ID,
    );
}
