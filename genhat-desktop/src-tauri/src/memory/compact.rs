//! Weekly-style compaction: prune old episodes and vacuum.

use crate::memory::MemoryEngine;

pub async fn run_maintenance(engine: &MemoryEngine) -> Result<MaintenanceReport, String> {
    let pruned = engine.writer.prune_episodes().await?;
    // Process a batch of pending signals while we're here
    let processed = crate::memory::extract::process_pending_signals(engine, 50).await?;
    Ok(MaintenanceReport {
        episodes_pruned: pruned,
        signals_processed: processed,
    })
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceReport {
    pub episodes_pruned: usize,
    pub signals_processed: usize,
}
