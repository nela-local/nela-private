//! Stable device identity for HLC / G-Counter provenance.

use std::fs;
use std::path::Path;
use uuid::Uuid;

/// Load or create a stable device UUID at `{memory_dir}/device_id`.
pub fn load_or_create_device_id(memory_dir: &Path) -> Result<String, String> {
    fs::create_dir_all(memory_dir).map_err(|e| format!("create memory dir: {e}"))?;
    let path = memory_dir.join("device_id");
    if path.exists() {
        let id = fs::read_to_string(&path)
            .map_err(|e| format!("read device_id: {e}"))?
            .trim()
            .to_string();
        if !id.is_empty() {
            return Ok(id);
        }
    }
    let id = Uuid::new_v4().to_string();
    fs::write(&path, &id).map_err(|e| format!("write device_id: {e}"))?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn device_id_is_stable_across_loads() {
        let dir = tempdir().unwrap();
        let a = load_or_create_device_id(dir.path()).unwrap();
        let b = load_or_create_device_id(dir.path()).unwrap();
        assert_eq!(a, b);
    }
}
