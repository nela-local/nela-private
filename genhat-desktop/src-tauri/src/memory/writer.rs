//! Single-writer actor: all mutations enqueue through an mpsc channel.

use crate::memory::confidence::{
    c_eff, reinforce_negative, reinforce_positive, should_omit, should_promote,
};
use crate::memory::db::{new_uuid_v7, now_sqlite, MemoryDb};
use crate::memory::gcounter::{bump_device, counts_to_json, merge_counts, sum_counts};
use crate::memory::hlc::HlcClock;
use crate::memory::types::{
    Episode, Fact, FactStatus, ObservationSignal, SourceType,
};
use rusqlite::OptionalExtension;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};

pub enum WriteOp {
    InsertEpisode {
        episode: Episode,
        reply: oneshot::Sender<Result<(), String>>,
    },
    InsertSignal {
        signal: ObservationSignal,
        reply: oneshot::Sender<Result<(), String>>,
    },
    InsertFact {
        fact: Fact,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Soft-supersede a fact (forget from active context).
    ForgetFact {
        id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    DeleteFact {
        id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Edit: supersede old + insert new explicit fact.
    UpdateFactValue {
        id: String,
        new_value: String,
        reply: oneshot::Sender<Result<Fact, String>>,
    },
    ClearMemory {
        include_episodes: bool,
        reply: oneshot::Sender<Result<(), String>>,
    },
    DecayFact {
        id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Apply observation: create/update provisional, maybe promote.
    ApplyObservation {
        subject: String,
        predicate: String,
        fact_value: String,
        context_condition: Option<String>,
        positive: bool,
        reply: oneshot::Sender<Result<Fact, String>>,
    },
    /// Insert explicit fact, invalidating incumbent.
    InsertExplicit {
        subject: String,
        predicate: String,
        fact_value: String,
        context_condition: Option<String>,
        source_episode_id: Option<String>,
        reply: oneshot::Sender<Result<Fact, String>>,
    },
    UpsertPredicateEmbedding {
        fact_id: String,
        embedding: Vec<u8>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    UpsertEpisodeEmbedding {
        episode_id: String,
        embedding: Vec<u8>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    MarkSignalProcessed {
        id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    PruneEpisodes {
        reply: oneshot::Sender<Result<usize, String>>,
    },
    SetMeta {
        key: String,
        value: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    SetManifest {
        table_name: String,
        model_id: String,
        dimensions: u32,
        distance_metric: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    MergeImportFact {
        fact: Fact,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Raw {
        f: Box<dyn FnOnce(&MemoryDb, &HlcClock) -> Result<(), String> + Send>,
        reply: oneshot::Sender<Result<(), String>>,
    },
}

#[derive(Clone)]
pub struct MemoryWriter {
    tx: mpsc::Sender<WriteOp>,
}

impl MemoryWriter {
    pub fn spawn(db: Arc<MemoryDb>, clock: Arc<HlcClock>) -> Self {
        let (tx, mut rx) = mpsc::channel::<WriteOp>(256);
        let db_w = db.clone();
        let clock_w = clock.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(op) = rx.recv().await {
                handle_op(&db_w, &clock_w, op);
            }
        });
        Self { tx }
    }

    pub async fn enqueue(&self, op: WriteOp) -> Result<(), String> {
        self.tx
            .send(op)
            .await
            .map_err(|_| "memory writer stopped".to_string())
    }

    async fn call<T, F>(&self, build: F) -> Result<T, String>
    where
        F: FnOnce(oneshot::Sender<Result<T, String>>) -> WriteOp,
    {
        let (tx, rx) = oneshot::channel();
        self.enqueue(build(tx)).await?;
        rx.await.map_err(|_| "memory writer dropped reply".to_string())?
    }

    pub async fn insert_episode(&self, episode: Episode) -> Result<(), String> {
        self.call(|reply| WriteOp::InsertEpisode { episode, reply })
            .await
    }

    pub async fn insert_signal(&self, signal: ObservationSignal) -> Result<(), String> {
        self.call(|reply| WriteOp::InsertSignal { signal, reply })
            .await
    }

    pub async fn forget_fact(&self, id: String) -> Result<(), String> {
        self.call(|reply| WriteOp::ForgetFact { id, reply }).await
    }

    pub async fn delete_fact(&self, id: String) -> Result<(), String> {
        self.call(|reply| WriteOp::DeleteFact { id, reply }).await
    }

    pub async fn update_fact_value(&self, id: String, new_value: String) -> Result<Fact, String> {
        self.call(|reply| WriteOp::UpdateFactValue {
            id,
            new_value,
            reply,
        })
        .await
    }

    pub async fn clear_memory(&self, include_episodes: bool) -> Result<(), String> {
        self.call(|reply| WriteOp::ClearMemory {
            include_episodes,
            reply,
        })
        .await
    }

    pub async fn decay_fact(&self, id: String) -> Result<(), String> {
        self.call(|reply| WriteOp::DecayFact { id, reply }).await
    }

    pub async fn apply_observation(
        &self,
        subject: String,
        predicate: String,
        fact_value: String,
        context_condition: Option<String>,
        positive: bool,
    ) -> Result<Fact, String> {
        self.call(|reply| WriteOp::ApplyObservation {
            subject,
            predicate,
            fact_value,
            context_condition,
            positive,
            reply,
        })
        .await
    }

    pub async fn insert_explicit(
        &self,
        subject: String,
        predicate: String,
        fact_value: String,
        context_condition: Option<String>,
        source_episode_id: Option<String>,
    ) -> Result<Fact, String> {
        self.call(|reply| WriteOp::InsertExplicit {
            subject,
            predicate,
            fact_value,
            context_condition,
            source_episode_id,
            reply,
        })
        .await
    }

    pub async fn upsert_predicate_embedding(
        &self,
        fact_id: String,
        embedding: Vec<u8>,
    ) -> Result<(), String> {
        self.call(|reply| WriteOp::UpsertPredicateEmbedding {
            fact_id,
            embedding,
            reply,
        })
        .await
    }

    pub async fn upsert_episode_embedding(
        &self,
        episode_id: String,
        embedding: Vec<u8>,
    ) -> Result<(), String> {
        self.call(|reply| WriteOp::UpsertEpisodeEmbedding {
            episode_id,
            embedding,
            reply,
        })
        .await
    }

    pub async fn mark_signal_processed(&self, id: String) -> Result<(), String> {
        self.call(|reply| WriteOp::MarkSignalProcessed { id, reply })
            .await
    }

    pub async fn prune_episodes(&self) -> Result<usize, String> {
        self.call(|reply| WriteOp::PruneEpisodes { reply }).await
    }

    pub async fn set_meta(&self, key: String, value: String) -> Result<(), String> {
        self.call(|reply| WriteOp::SetMeta { key, value, reply })
            .await
    }

    pub async fn set_manifest(
        &self,
        table_name: String,
        model_id: String,
        dimensions: u32,
        distance_metric: String,
    ) -> Result<(), String> {
        self.call(|reply| WriteOp::SetManifest {
            table_name,
            model_id,
            dimensions,
            distance_metric,
            reply,
        })
        .await
    }

    pub async fn merge_import_fact(&self, fact: Fact) -> Result<(), String> {
        self.call(|reply| WriteOp::MergeImportFact { fact, reply })
            .await
    }
}

fn handle_op(db: &MemoryDb, clock: &HlcClock, op: WriteOp) {
    match op {
        WriteOp::InsertEpisode { episode, reply } => {
            let _ = reply.send(db.insert_episode(&episode));
        }
        WriteOp::InsertSignal { signal, reply } => {
            let _ = reply.send(db.insert_signal(&signal));
        }
        WriteOp::InsertFact { fact, reply } => {
            let _ = reply.send(db.insert_fact(&fact));
        }
        WriteOp::ForgetFact { id, reply } => {
            let _ = reply.send(forget_fact(db, clock, &id));
        }
        WriteOp::DeleteFact { id, reply } => {
            let _ = reply.send(db.delete_fact(&id));
        }
        WriteOp::UpdateFactValue {
            id,
            new_value,
            reply,
        } => {
            let _ = reply.send(update_fact_value(db, clock, &id, &new_value));
        }
        WriteOp::ClearMemory {
            include_episodes,
            reply,
        } => {
            let _ = reply.send(db.clear_facts(include_episodes));
        }
        WriteOp::DecayFact { id, reply } => {
            let _ = reply.send(forget_fact(db, clock, &id));
        }
        WriteOp::ApplyObservation {
            subject,
            predicate,
            fact_value,
            context_condition,
            positive,
            reply,
        } => {
            let _ = reply.send(apply_observation(
                db,
                clock,
                &subject,
                &predicate,
                &fact_value,
                context_condition.as_deref(),
                positive,
            ));
        }
        WriteOp::InsertExplicit {
            subject,
            predicate,
            fact_value,
            context_condition,
            source_episode_id,
            reply,
        } => {
            let _ = reply.send(insert_explicit(
                db,
                clock,
                &subject,
                &predicate,
                &fact_value,
                context_condition.as_deref(),
                source_episode_id.as_deref(),
            ));
        }
        WriteOp::UpsertPredicateEmbedding {
            fact_id,
            embedding,
            reply,
        } => {
            let _ = reply.send(db.upsert_predicate_embedding(&fact_id, &embedding));
        }
        WriteOp::UpsertEpisodeEmbedding {
            episode_id,
            embedding,
            reply,
        } => {
            let _ = reply.send(db.upsert_episode_embedding(&episode_id, &embedding));
        }
        WriteOp::MarkSignalProcessed { id, reply } => {
            let _ = reply.send(db.mark_signal_processed(&id));
        }
        WriteOp::PruneEpisodes { reply } => {
            let _ = reply.send(db.prune_old_episodes());
        }
        WriteOp::SetMeta { key, value, reply } => {
            let _ = reply.send(db.set_meta(&key, &value));
        }
        WriteOp::SetManifest {
            table_name,
            model_id,
            dimensions,
            distance_metric,
            reply,
        } => {
            let _ = reply.send(db.set_manifest(
                &table_name,
                &model_id,
                dimensions,
                &distance_metric,
            ));
        }
        WriteOp::MergeImportFact { fact, reply } => {
            let _ = reply.send(merge_import_fact(db, clock, fact));
        }
        WriteOp::Raw { f, reply } => {
            let _ = reply.send(f(db, clock));
        }
    }
}

fn forget_fact(db: &MemoryDb, clock: &HlcClock, id: &str) -> Result<(), String> {
    let now = now_sqlite();
    let hlc = clock.tick().format();
    let conn = db.write_conn()?;
    conn.execute(
        "UPDATE facts SET status = 'superseded', valid_to = ?2, hlc_timestamp = ?3 WHERE id = ?1",
        rusqlite::params![id, now, hlc],
    )
    .map_err(|e| format!("forget fact: {e}"))?;
    Ok(())
}

fn update_fact_value(
    db: &MemoryDb,
    clock: &HlcClock,
    id: &str,
    new_value: &str,
) -> Result<Fact, String> {
    let old = db
        .get_fact(id)?
        .ok_or_else(|| format!("fact not found: {id}"))?;
    insert_explicit(
        db,
        clock,
        &old.subject,
        &old.predicate,
        new_value,
        old.context_condition.as_deref(),
        None,
    )
}

fn insert_explicit(
    db: &MemoryDb,
    clock: &HlcClock,
    subject: &str,
    predicate: &str,
    fact_value: &str,
    context_condition: Option<&str>,
    source_episode_id: Option<&str>,
) -> Result<Fact, String> {
    let now = now_sqlite();
    let hlc = clock.tick();
    let new_id = new_uuid_v7();
    let mut counts = std::collections::HashMap::new();
    bump_device(&mut counts, clock.device_id(), 1);

    let conn = db.write_conn()?;
    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| format!("begin: {e}"))?;

    let fact = Fact {
        id: new_id.clone(),
        subject: subject.to_string(),
        predicate: predicate.to_string(),
        fact_value: fact_value.to_string(),
        context_condition: context_condition.map(|s| s.to_string()),
        source_type: SourceType::ExplicitStatement,
        status: FactStatus::Active,
        confidence: 1.0,
        observation_count: 1,
        device_counts: counts,
        last_observed_at: now.clone(),
        valid_from: now.clone(),
        valid_to: None,
        origin_device_id: clock.device_id().to_string(),
        hlc_timestamp: hlc.format(),
        source_episode_id: source_episode_id.map(|s| s.to_string()),
        invalidated_by_fact_id: None,
        superseded_by_fact_id: None,
        created_at: now.clone(),
        c_eff: Some(1.0),
    };

    // Close any active incumbent first (without FK to new id yet — unique index
    // requires no other active row before insert).
    let incumbent: Option<String> = {
        let ctx_key = context_condition.unwrap_or("__GLOBAL__");
        conn.query_row(
            "SELECT id FROM facts WHERE subject = ?1 AND predicate = ?2 AND context_key = ?3
             AND valid_to IS NULL AND status = 'active' LIMIT 1",
            rusqlite::params![subject, predicate, ctx_key],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("find incumbent: {e}"))?
    };

    if let Some(ref inc_id) = incumbent {
        conn.execute(
            "UPDATE facts SET status = 'superseded', valid_to = ?2 WHERE id = ?1",
            rusqlite::params![inc_id, now],
        )
        .map_err(|e| format!("supersede: {e}"))?;
    }

    // Close provisional with same key
    {
        let ctx_key = context_condition.unwrap_or("__GLOBAL__");
        let _ = conn.execute(
            "UPDATE facts SET status = 'superseded', valid_to = ?4
             WHERE subject = ?1 AND predicate = ?2 AND context_key = ?3
               AND status = 'provisional' AND valid_to IS NULL",
            rusqlite::params![subject, predicate, ctx_key, now],
        );
    }

    MemoryDb::insert_fact_on(&conn, &fact)?;

    // Now that new fact exists, wire lineage FKs on the old row.
    if let Some(inc_id) = incumbent {
        conn.execute(
            "UPDATE facts SET invalidated_by_fact_id = ?2, superseded_by_fact_id = ?2 WHERE id = ?1",
            rusqlite::params![inc_id, new_id],
        )
        .map_err(|e| format!("lineage: {e}"))?;
    }

    conn.execute("COMMIT", [])
        .map_err(|e| format!("commit: {e}"))?;
    Ok(fact)
}

fn apply_observation(
    db: &MemoryDb,
    clock: &HlcClock,
    subject: &str,
    predicate: &str,
    fact_value: &str,
    context_condition: Option<&str>,
    positive: bool,
) -> Result<Fact, String> {
    let now = now_sqlite();
    let hlc = clock.tick();

    if let Some(mut existing) =
        db.find_provisional_fact(subject, predicate, context_condition, fact_value)?
    {
        let eff = c_eff(existing.confidence, &existing.last_observed_at, None);
        let new_c = if positive {
            reinforce_positive(eff)
        } else {
            reinforce_negative(eff)
        };
        bump_device(&mut existing.device_counts, clock.device_id(), 1);
        existing.observation_count = sum_counts(&existing.device_counts);
        existing.confidence = new_c;
        existing.last_observed_at = now.clone();
        existing.hlc_timestamp = hlc.format();

        let conn = db.write_conn()?;
        MemoryDb::update_fact_fields_on(
            &conn,
            &existing.id,
            existing.status,
            None,
            None,
            None,
            Some(new_c),
            Some(existing.observation_count),
            Some(&counts_to_json(&existing.device_counts)),
            Some(&now),
            Some(&existing.hlc_timestamp),
        )?;

        // Maybe promote
        let eff2 = c_eff(new_c, &now, None);
        if positive && should_promote(existing.observation_count, eff2) {
            try_promote(db, clock, &existing.id)?;
            if let Some(updated) = db.get_fact(&existing.id)? {
                return Ok(updated);
            }
        }
        existing.c_eff = Some(eff2);
        return Ok(existing);
    }

    // New provisional
    let mut counts = std::collections::HashMap::new();
    bump_device(&mut counts, clock.device_id(), 1);
    let init_c = if positive {
        reinforce_positive(0.0)
    } else {
        0.0
    };
    let fact = Fact {
        id: new_uuid_v7(),
        subject: subject.to_string(),
        predicate: predicate.to_string(),
        fact_value: fact_value.to_string(),
        context_condition: context_condition.map(|s| s.to_string()),
        source_type: SourceType::InferredPattern,
        status: FactStatus::Provisional,
        confidence: init_c,
        observation_count: 1,
        device_counts: counts,
        last_observed_at: now.clone(),
        valid_from: now.clone(),
        valid_to: None,
        origin_device_id: clock.device_id().to_string(),
        hlc_timestamp: hlc.format(),
        source_episode_id: None,
        invalidated_by_fact_id: None,
        superseded_by_fact_id: None,
        created_at: now.clone(),
        c_eff: Some(init_c),
    };
    db.insert_fact(&fact)?;

    let eff = c_eff(init_c, &now, None);
    if positive && should_promote(fact.observation_count, eff) {
        try_promote(db, clock, &fact.id)?;
        if let Some(updated) = db.get_fact(&fact.id)? {
            return Ok(updated);
        }
    }
    Ok(fact)
}

fn try_promote(db: &MemoryDb, clock: &HlcClock, fact_id: &str) -> Result<(), String> {
    let fact = db
        .get_fact(fact_id)?
        .ok_or_else(|| "missing fact for promote".to_string())?;
    let now = now_sqlite();
    let _hlc = clock.tick();

    let conn = db.write_conn()?;
    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| format!("begin promote: {e}"))?;

    let ctx_key = fact
        .context_condition
        .as_deref()
        .unwrap_or("__GLOBAL__");
    let incumbent: Option<(String, String)> = conn
        .query_row(
            "SELECT id, source_type FROM facts
             WHERE subject = ?1 AND predicate = ?2 AND context_key = ?3
               AND valid_to IS NULL AND status = 'active' LIMIT 1",
            rusqlite::params![fact.subject, fact.predicate, ctx_key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| format!("incumbent: {e}"))?;

    if let Some((inc_id, src)) = incumbent {
        if src == SourceType::ExplicitStatement.as_str() {
            conn.execute("ROLLBACK", []).ok();
            return Ok(()); // explicit beats inferred
        }
        if inc_id != fact.id {
            // Different value — supersede incumbent
            conn.execute(
                "UPDATE facts SET status = 'superseded', valid_to = ?2, superseded_by_fact_id = ?3
                 WHERE id = ?1",
                rusqlite::params![inc_id, now, fact.id],
            )
            .map_err(|e| format!("supersede incumbent: {e}"))?;
        }
    }

    conn.execute(
        "UPDATE facts SET status = 'active', valid_to = NULL WHERE id = ?1",
        rusqlite::params![fact.id],
    )
    .map_err(|e| format!("activate: {e}"))?;
    conn.execute("COMMIT", [])
        .map_err(|e| format!("commit promote: {e}"))?;
    Ok(())
}

fn merge_import_fact(db: &MemoryDb, clock: &HlcClock, incoming: Fact) -> Result<(), String> {
    use crate::memory::hlc::HlcTimestamp;

    let _ = clock.receive(&HlcTimestamp::parse(&incoming.hlc_timestamp).unwrap_or_else(|_| {
        HlcTimestamp {
            physical_ms: 0,
            counter: 0,
            device_id: incoming.origin_device_id.clone(),
        }
    }));

    // Look for same subject/predicate/context/value among open facts
    let all = db.list_all_facts()?;
    let ctx = incoming.context_condition.clone();
    let same_value = all.iter().find(|f| {
        f.subject == incoming.subject
            && f.predicate == incoming.predicate
            && f.context_condition == ctx
            && f.fact_value == incoming.fact_value
            && f.valid_to.is_none()
            && matches!(f.status, FactStatus::Active | FactStatus::Provisional)
    });

    if let Some(local) = same_value {
        let merged = merge_counts(&local.device_counts, &incoming.device_counts);
        let obs = sum_counts(&merged);
        let last = if incoming.last_observed_at > local.last_observed_at {
            incoming.last_observed_at.clone()
        } else {
            local.last_observed_at.clone()
        };
        let conf = local.confidence.max(incoming.confidence);
        let conn = db.write_conn()?;
        MemoryDb::update_fact_fields_on(
            &conn,
            &local.id,
            local.status,
            None,
            None,
            None,
            Some(conf),
            Some(obs),
            Some(&counts_to_json(&merged)),
            Some(&last),
            None,
        )?;
        return Ok(());
    }

    // Conflict: same key, different value
    let open_same_key = all.iter().find(|f| {
        f.subject == incoming.subject
            && f.predicate == incoming.predicate
            && f.context_condition == ctx
            && f.valid_to.is_none()
            && f.status == FactStatus::Active
    });

    if let Some(local) = open_same_key {
        let winner_is_incoming = resolve_conflict(local, &incoming);
        if winner_is_incoming {
            let now = incoming.valid_from.clone();
            let conn = db.write_conn()?;
            conn.execute("BEGIN IMMEDIATE", []).map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE facts SET status = 'superseded', valid_to = ?2, superseded_by_fact_id = ?3
                 WHERE id = ?1",
                rusqlite::params![local.id, now, incoming.id],
            )
            .map_err(|e| e.to_string())?;
            // Ensure incoming not already present
            if db.get_fact(&incoming.id)?.is_none() {
                MemoryDb::insert_fact_on(&conn, &incoming)?;
            }
            conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
        }
        // else keep local
        return Ok(());
    }

    // No conflict — insert if new id
    if db.get_fact(&incoming.id)?.is_none() {
        db.insert_fact(&incoming)?;
    }
    Ok(())
}

fn resolve_conflict(local: &Fact, incoming: &Fact) -> bool {
    use crate::memory::hlc::HlcTimestamp;
    use std::cmp::Ordering;

    match (local.source_type, incoming.source_type) {
        (SourceType::ExplicitStatement, SourceType::InferredPattern) => false,
        (SourceType::InferredPattern, SourceType::ExplicitStatement) => true,
        _ => {
            let lh = HlcTimestamp::parse(&local.hlc_timestamp).ok();
            let ih = HlcTimestamp::parse(&incoming.hlc_timestamp).ok();
            match (lh, ih) {
                (Some(a), Some(b)) => b.cmp_hlc(&a) == Ordering::Greater,
                _ => incoming.hlc_timestamp > local.hlc_timestamp,
            }
        }
    }
}

/// Enqueue decay for facts whose c_eff dropped below threshold (called from reads).
pub fn collect_decay_ids(facts: &[Fact]) -> Vec<String> {
    facts
        .iter()
        .filter(|f| {
            let eff = f
                .c_eff
                .unwrap_or_else(|| c_eff(f.confidence, &f.last_observed_at, None));
            should_omit(eff)
                && matches!(f.status, FactStatus::Active | FactStatus::Provisional)
                && f.valid_to.is_none()
        })
        .map(|f| f.id.clone())
        .collect()
}
