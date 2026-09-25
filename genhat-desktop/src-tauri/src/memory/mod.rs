//! Embedded bi-temporal memory layer (v2.1).
//!
//! Zero-daemon, local-first preference + episodic store with WAL SQLite,
//! single-writer actor, lazy confidence decay, and HLC/G-Counter sync.

pub mod compact;
pub mod confidence;
pub mod context;
pub mod db;
pub mod device;
pub mod embeddings;
pub mod extract;
pub mod gcounter;
pub mod hlc;
pub mod predicates;
pub mod sync;
pub mod types;
pub mod writer;

use crate::memory::db::{new_uuid_v7, now_sqlite, MemoryDb};
use crate::memory::device::load_or_create_device_id;
use crate::memory::embeddings::store_episode_embedding;
use crate::memory::hlc::HlcClock;
use crate::memory::types::{
    AssembleContextResult, ClearMemoryRequest, Episode, Fact, FactListFilter, IngestSignalRequest,
    RecordEpisodeRequest, RememberFactRequest, Role, UpdateFactRequest,
};
use crate::memory::writer::MemoryWriter;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Clone)]
pub struct MemoryEngine {
    pub db: Arc<MemoryDb>,
    pub clock: Arc<HlcClock>,
    pub writer: MemoryWriter,
    pub root: PathBuf,
}

impl MemoryEngine {
    pub fn open(app_data_dir: &Path) -> Result<Self, String> {
        let root = app_data_dir.join("memory");
        std::fs::create_dir_all(&root).map_err(|e| format!("memory dir: {e}"))?;
        let device_id = load_or_create_device_id(&root)?;
        let db = Arc::new(MemoryDb::open(&root.join("memory.db"))?);
        let clock = Arc::new(HlcClock::new(device_id));
        let writer = MemoryWriter::spawn(db.clone(), clock.clone());
        // Ensure embedding manifest defaults
        let _ = db.set_manifest("predicate_embeddings", "hash-embed", 384, "cosine");
        Ok(Self {
            db,
            clock,
            writer,
            root,
        })
    }

    pub async fn record_episode(&self, req: RecordEpisodeRequest) -> Result<String, String> {
        let role = Role::parse(&req.role)?;
        let id = new_uuid_v7();
        let ep = Episode {
            id: id.clone(),
            session_id: req.session_id,
            role,
            content: req.content.clone(),
            is_pruned: false,
            created_at: now_sqlite(),
        };
        self.writer.insert_episode(ep).await?;
        let _ = store_episode_embedding(&self.writer, &id, &req.content, 384).await;
        Ok(id)
    }

    pub async fn ingest_signal(&self, req: IngestSignalRequest) -> Result<(), String> {
        extract::ingest_signal(self, req).await
    }

    pub async fn assemble_context(
        &self,
        session_id: &str,
        query: &str,
    ) -> Result<AssembleContextResult, String> {
        context::assemble_context(self, session_id, query).await
    }

    pub fn list_facts(&self, filter: FactListFilter) -> Result<Vec<Fact>, String> {
        let mut facts = self.db.list_facts(&filter)?;
        for f in &mut facts {
            f.c_eff = Some(confidence::c_eff(f.confidence, &f.last_observed_at, None));
        }
        Ok(facts)
    }

    pub fn get_fact(&self, id: &str) -> Result<Option<Fact>, String> {
        let mut fact = self.db.get_fact(id)?;
        if let Some(ref mut f) = fact {
            f.c_eff = Some(confidence::c_eff(f.confidence, &f.last_observed_at, None));
        }
        Ok(fact)
    }

    pub async fn update_fact(&self, req: UpdateFactRequest) -> Result<Fact, String> {
        let fact = self
            .writer
            .update_fact_value(req.id, req.fact_value)
            .await?;
        let _ = embeddings::store_predicate_embedding(
            &self.writer,
            &fact.id,
            &fact.predicate,
            384,
        )
        .await;
        Ok(fact)
    }

    pub async fn forget_fact(&self, id: String) -> Result<(), String> {
        self.writer.forget_fact(id).await
    }

    /// LLM / tool path: persist a validated user fact.
    pub async fn remember_fact(&self, req: RememberFactRequest) -> Result<Fact, String> {
        let predicate = req.predicate.trim();
        let fact_value = req.fact_value.trim();
        if predicate.is_empty() || fact_value.is_empty() {
            return Err("predicate and fact_value are required".into());
        }
        let subject = if req.subject.trim().is_empty() {
            "user".to_string()
        } else {
            req.subject.trim().to_string()
        };
        let fact = if req.explicit {
            self.writer
                .insert_explicit(
                    subject,
                    predicate.to_string(),
                    fact_value.to_string(),
                    req.context_condition.clone(),
                    None,
                )
                .await?
        } else {
            self.writer
                .apply_observation(
                    subject,
                    predicate.to_string(),
                    fact_value.to_string(),
                    req.context_condition.clone(),
                    true,
                )
                .await?
        };
        let _ = embeddings::store_predicate_embedding(
            &self.writer,
            &fact.id,
            &fact.predicate,
            384,
        )
        .await;
        Ok(fact)
    }

    pub async fn delete_fact(&self, id: String) -> Result<(), String> {
        self.writer.delete_fact(id).await
    }

    pub async fn clear_memory(&self, req: ClearMemoryRequest) -> Result<(), String> {
        self.writer.clear_memory(req.include_episodes).await
    }

    pub async fn export_bundle(
        &self,
        model_id: &str,
        dimensions: u32,
    ) -> Result<types::ExportBundle, String> {
        sync::export_bundle(self, model_id, dimensions).await
    }

    pub async fn import_bundle(
        &self,
        bundle: types::ExportBundle,
        local_model_id: &str,
        local_dimensions: u32,
    ) -> Result<sync::ImportResult, String> {
        sync::import_bundle(self, bundle, local_model_id, local_dimensions).await
    }

    pub async fn run_maintenance(&self) -> Result<compact::MaintenanceReport, String> {
        compact::run_maintenance(self).await
    }
}
