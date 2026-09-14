//! Persisted Tally connection config (host/port/company — not OAuth secrets).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::RwLock;

static APP_DATA: RwLock<Option<PathBuf>> = RwLock::new(None);

const CONFIG_FILE: &str = "tally.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TallyConfig {
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub company: Option<String>,
    #[serde(default)]
    pub connected: bool,
}

impl Default for TallyConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 9000,
            company: None,
            connected: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TallyStatus {
    pub connected: bool,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub company: Option<String>,
    pub last_error: Option<String>,
}

pub fn set_app_data_dir(dir: PathBuf) {
    if let Ok(mut g) = APP_DATA.write() {
        *g = Some(dir);
    }
}

fn app_data() -> Result<PathBuf, String> {
    APP_DATA
        .read()
        .ok()
        .and_then(|g| g.clone())
        .ok_or_else(|| "Tally connector app data not initialized.".into())
}

fn config_path(dir: &Path) -> PathBuf {
    dir.join("connectors").join(CONFIG_FILE)
}

pub fn load_config() -> Result<TallyConfig, String> {
    let dir = app_data()?;
    let path = config_path(&dir);
    if !path.exists() {
        return Ok(TallyConfig::default());
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Couldn't read Tally config: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Couldn't parse Tally config: {e}"))
}

pub fn save_config(cfg: &TallyConfig) -> Result<(), String> {
    let dir = app_data()?;
    let folder = dir.join("connectors");
    std::fs::create_dir_all(&folder).map_err(|e| format!("Couldn't save Tally config: {e}"))?;
    let raw = serde_json::to_string_pretty(cfg)
        .map_err(|e| format!("Couldn't serialize Tally config: {e}"))?;
    let path = config_path(&dir);
    std::fs::write(&path, raw).map_err(|e| format!("Couldn't save Tally config: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn disconnect() -> Result<TallyStatus, String> {
    let mut cfg = load_config().unwrap_or_default();
    cfg.connected = false;
    save_config(&cfg)?;
    Ok(TallyStatus {
        connected: false,
        host: Some(cfg.host),
        port: Some(cfg.port),
        company: cfg.company,
        last_error: None,
    })
}
