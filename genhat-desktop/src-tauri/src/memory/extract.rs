//! Observation-signal processing (behavioral telemetry → provisional facts).
//! Preference facts from conversation are written only via the LLM
//! `remember_user_fact` tool (`MemoryEngine::remember_fact`).

use crate::memory::db::{new_uuid_v7, now_sqlite};
use crate::memory::embeddings::store_predicate_embedding;
use crate::memory::predicates::{apply_disambiguation, resolve_predicate, PredicateMatch};
use crate::memory::types::{IngestSignalRequest, ObservationSignal, SignalType};
use crate::memory::MemoryEngine;

async fn resolve_and_canonicalize(
    engine: &MemoryEngine,
    candidate: &str,
) -> Result<String, String> {
    let emb = crate::memory::embeddings::hash_embed(candidate, 384);
    match resolve_predicate(&engine.db, candidate, Some(&emb))? {
        PredicateMatch::Exact { predicate }
        | PredicateMatch::Semantic { predicate, .. } => Ok(predicate),
        PredicateMatch::Ambiguous { existing, .. } => {
            let _ = apply_disambiguation(
                PredicateMatch::Ambiguous {
                    candidate: candidate.into(),
                    existing: existing.clone(),
                    similarity: 0.85,
                },
                true,
            );
            Ok(existing)
        }
        PredicateMatch::New => Ok(candidate.to_string()),
    }
}

pub async fn ingest_signal(
    engine: &MemoryEngine,
    req: IngestSignalRequest,
) -> Result<(), String> {
    let signal_type = SignalType::parse(&req.signal_type)?;
    let positive = !matches!(signal_type, SignalType::Rejection);
    let sig = ObservationSignal {
        id: new_uuid_v7(),
        signal_type,
        subject: req.subject.clone(),
        candidate_predicate: req.candidate_predicate.clone(),
        candidate_value: req.candidate_value.clone(),
        context_condition: req.context_condition.clone(),
        created_at: now_sqlite(),
        processed: false,
    };
    engine.writer.insert_signal(sig.clone()).await?;

    let predicate = resolve_and_canonicalize(engine, &sig.candidate_predicate).await?;
    let fact = engine
        .writer
        .apply_observation(
            sig.subject,
            predicate.clone(),
            sig.candidate_value,
            sig.context_condition,
            positive,
        )
        .await?;
    let _ = store_predicate_embedding(&engine.writer, &fact.id, &predicate, 384).await;
    engine.writer.mark_signal_processed(sig.id).await?;
    Ok(())
}

pub async fn process_pending_signals(engine: &MemoryEngine, limit: usize) -> Result<usize, String> {
    let signals = engine.db.unprocessed_signals(limit)?;
    let mut n = 0;
    for sig in signals {
        let positive = !matches!(sig.signal_type, SignalType::Rejection);
        let predicate = resolve_and_canonicalize(engine, &sig.candidate_predicate).await?;
        let fact = engine
            .writer
            .apply_observation(
                sig.subject,
                predicate.clone(),
                sig.candidate_value,
                sig.context_condition,
                positive,
            )
            .await?;
        let _ = store_predicate_embedding(&engine.writer, &fact.id, &predicate, 384).await;
        engine.writer.mark_signal_processed(sig.id).await?;
        n += 1;
    }
    Ok(n)
}
