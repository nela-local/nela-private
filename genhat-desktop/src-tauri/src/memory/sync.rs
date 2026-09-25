//! Export / import with G-Counter merge and model-version invalidation.

use crate::memory::embeddings::reindex_all_predicates;
use crate::memory::types::{ExportBundle, ExportManifest, SCHEMA_VERSION};
use crate::memory::MemoryEngine;

pub async fn export_bundle(
    engine: &MemoryEngine,
    model_id: &str,
    dimensions: u32,
) -> Result<ExportBundle, String> {
    let facts = engine.db.list_all_facts()?;
    let hlc = engine.clock.tick().format();
    Ok(ExportBundle {
        manifest: ExportManifest {
            model_id: model_id.to_string(),
            dimensions,
            schema_version: SCHEMA_VERSION,
            device_id: engine.clock.device_id().to_string(),
            exported_hlc: hlc,
            reindex_predicates_required: false,
        },
        facts,
    })
}

pub async fn import_bundle(
    engine: &MemoryEngine,
    bundle: ExportBundle,
    local_model_id: &str,
    local_dimensions: u32,
) -> Result<ImportResult, String> {
    let mut reindex = false;
    if bundle.manifest.model_id != local_model_id
        || bundle.manifest.dimensions != local_dimensions
    {
        reindex = true;
        engine
            .writer
            .set_meta(
                "reindex_predicates_required".into(),
                "1".into(),
            )
            .await?;
    }

    let mut merged = 0usize;
    for fact in bundle.facts {
        engine.writer.merge_import_fact(fact).await?;
        merged += 1;
    }

    engine
        .db
        .upsert_peer_watermark(&bundle.manifest.device_id, &bundle.manifest.exported_hlc)?;

    if reindex {
        let n = reindex_all_predicates(&engine.db, local_dimensions as usize)?;
        engine
            .writer
            .set_manifest(
                "predicate_embeddings".into(),
                local_model_id.to_string(),
                local_dimensions,
                "cosine".into(),
            )
            .await?;
        engine
            .writer
            .set_meta("reindex_predicates_required".into(), "0".into())
            .await?;
        return Ok(ImportResult {
            merged_facts: merged,
            reindex_predicates_required: true,
            reindexed: n,
        });
    }

    Ok(ImportResult {
        merged_facts: merged,
        reindex_predicates_required: false,
        reindexed: 0,
    })
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub merged_facts: usize,
    pub reindex_predicates_required: bool,
    pub reindexed: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::db::{new_uuid_v7, now_sqlite, MemoryDb};
    use crate::memory::device::load_or_create_device_id;
    use crate::memory::hlc::HlcClock;
    use crate::memory::types::{Fact, FactStatus, SourceType};
    use crate::memory::writer::MemoryWriter;
    use std::collections::HashMap;
    use std::sync::Arc;
    use tempfile::tempdir;

    fn test_engine() -> MemoryEngine {
        let dir = tempdir().unwrap();
        let memory_dir = dir.path().to_path_buf();
        // leak tempdir for test lifetime
        std::mem::forget(dir);
        let device_id = load_or_create_device_id(&memory_dir).unwrap();
        let db = Arc::new(MemoryDb::open(&memory_dir.join("memory.db")).unwrap());
        let clock = Arc::new(HlcClock::new(device_id));
        let writer = MemoryWriter::spawn(db.clone(), clock.clone());
        MemoryEngine {
            db,
            clock,
            writer,
            root: memory_dir,
        }
    }

    #[tokio::test]
    async fn repeated_import_is_idempotent() {
        let engine = test_engine();
        let now = now_sqlite();
        let mut counts = HashMap::new();
        counts.insert("peer".into(), 2u64);
        let fact = Fact {
            id: new_uuid_v7(),
            subject: "user".into(),
            predicate: "theme".into(),
            fact_value: "dark".into(),
            context_condition: None,
            source_type: SourceType::InferredPattern,
            status: FactStatus::Active,
            confidence: 0.8,
            observation_count: 2,
            device_counts: counts,
            last_observed_at: now.clone(),
            valid_from: now.clone(),
            valid_to: None,
            origin_device_id: "peer".into(),
            hlc_timestamp: format!("{}:0:peer", 1_700_000_000_000u64),
            source_episode_id: None,
            invalidated_by_fact_id: None,
            superseded_by_fact_id: None,
            created_at: now,
            c_eff: None,
        };
        let bundle = ExportBundle {
            manifest: ExportManifest {
                model_id: "hash".into(),
                dimensions: 384,
                schema_version: SCHEMA_VERSION,
                device_id: "peer".into(),
                exported_hlc: fact.hlc_timestamp.clone(),
                reindex_predicates_required: false,
            },
            facts: vec![fact],
        };
        let r1 = import_bundle(&engine, bundle.clone(), "hash", 384)
            .await
            .unwrap();
        let r2 = import_bundle(&engine, bundle, "hash", 384).await.unwrap();
        assert_eq!(r1.merged_facts, 1);
        assert_eq!(r2.merged_facts, 1);
        let facts = engine.db.list_active_and_provisional().unwrap();
        assert_eq!(facts.len(), 1);
        assert_eq!(facts[0].device_counts.get("peer"), Some(&2));
    }

    #[tokio::test]
    async fn soft_forget_removes_from_active_list() {
        let engine = test_engine();
        let fact = engine
            .writer
            .insert_explicit(
                "user".into(),
                "ui_theme".into(),
                "dark".into(),
                None,
                None,
            )
            .await
            .unwrap();
        assert_eq!(engine.db.list_active_and_provisional().unwrap().len(), 1);
        engine.writer.forget_fact(fact.id).await.unwrap();
        assert!(engine.db.list_active_and_provisional().unwrap().is_empty());
    }

    #[tokio::test]
    async fn edit_leaves_one_active_explicit() {
        let engine = test_engine();
        let fact = engine
            .writer
            .insert_explicit(
                "user".into(),
                "ui_theme".into(),
                "dark".into(),
                None,
                None,
            )
            .await
            .unwrap();
        let updated = engine
            .writer
            .update_fact_value(fact.id.clone(), "light".into())
            .await
            .unwrap();
        let active = engine.db.list_active_and_provisional().unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].fact_value, "light");
        assert_eq!(active[0].id, updated.id);
        assert_ne!(active[0].id, fact.id);
    }
}
