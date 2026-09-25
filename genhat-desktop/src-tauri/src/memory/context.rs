//! Dual-tier context assembly: preferences + hybrid episodic retrieval.

use crate::memory::confidence::{c_eff, should_omit};
use crate::memory::embeddings::{hash_embed, top_k_episode_by_vector};
use crate::memory::types::{AssembleContextResult, Fact, FactStatus, SourceType};
use crate::memory::writer::{collect_decay_ids, MemoryWriter};
use crate::memory::MemoryEngine;
use crate::rag::fusion::rrf_fuse_with_k;

const RRF_K: f64 = 60.0;

/// Annotate facts with c_eff and drop omitted ones; return decay ids separately.
pub fn filter_facts_for_context(facts: Vec<Fact>) -> (Vec<Fact>, Vec<String>) {
    let mut kept = Vec::new();
    let mut annotated = Vec::new();
    for mut f in facts {
        let eff = c_eff(f.confidence, &f.last_observed_at, None);
        f.c_eff = Some(eff);
        annotated.push(f);
    }
    let decay_ids = collect_decay_ids(&annotated);
    for f in annotated {
        let eff = f.c_eff.unwrap_or(0.0);
        if should_omit(eff) {
            continue;
        }
        if f.valid_to.is_some() {
            continue;
        }
        if !matches!(f.status, FactStatus::Active | FactStatus::Provisional) {
            continue;
        }
        // Only inject active into preferences; provisional only if high enough already shown via c_eff
        if f.status == FactStatus::Active
            || (f.status == FactStatus::Provisional && eff >= 0.5)
        {
            kept.push(f);
        }
    }
    (kept, decay_ids)
}

pub fn format_preferences_markdown(facts: &[Fact]) -> String {
    let mut explicit = Vec::new();
    let mut inferred = Vec::new();
    for f in facts {
        match f.source_type {
            SourceType::ExplicitStatement => {
                explicit.push(format!(
                    "- {}: {} (explicitly set)",
                    f.predicate, f.fact_value
                ));
            }
            SourceType::InferredPattern => {
                let ce = f.c_eff.unwrap_or(f.confidence);
                inferred.push(format!(
                    "- {}: {} (confidence: {:.2}, observed {} times)",
                    f.predicate, f.fact_value, ce, f.observation_count
                ));
            }
        }
    }
    if explicit.is_empty() && inferred.is_empty() {
        return String::new();
    }
    let mut md = String::from("<user_preferences>\n");
    if !explicit.is_empty() {
        md.push_str("[Explicit Directives]\n");
        md.push_str(&explicit.join("\n"));
        md.push('\n');
    }
    if !inferred.is_empty() {
        md.push_str("[Inferred Behavioral Patterns]\n");
        md.push_str(&inferred.join("\n"));
        md.push('\n');
    }
    md.push_str("</user_preferences>");
    md
}

pub async fn assemble_context(
    engine: &MemoryEngine,
    _session_id: &str,
    query: &str,
) -> Result<AssembleContextResult, String> {
    let facts = engine.db.list_active_and_provisional()?;
    let (kept, decay_ids) = filter_facts_for_context(facts);
    enqueue_decays(&engine.writer, decay_ids).await;

    let preferences_markdown = format_preferences_markdown(&kept);
    let episodic_snippets = hybrid_episodic_retrieve(&engine, query, 5)?;

    Ok(AssembleContextResult {
        preferences_markdown,
        episodic_snippets,
    })
}

async fn enqueue_decays(writer: &MemoryWriter, ids: Vec<String>) {
    for id in ids {
        let _ = writer.decay_fact(id).await;
    }
}

fn hybrid_episodic_retrieve(
    engine: &MemoryEngine,
    query: &str,
    limit: usize,
) -> Result<Vec<String>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    // FTS5 BM25-ish ranking (MATCH order)
    let fts_q = sanitize_fts_query(query);
    let fts_hits = if fts_q.is_empty() {
        Vec::new()
    } else {
        engine.db.fts_search(&fts_q, limit * 3).unwrap_or_default()
    };
    let fts_ranking: Vec<(i64, f32)> = fts_hits
        .iter()
        .enumerate()
        .map(|(i, (rowid, _, _))| (*rowid, 1.0 / (i as f32 + 1.0)))
        .collect();

    // Vector
    let q_emb = hash_embed(query, 384);
    let vec_hits = top_k_episode_by_vector(&engine.db, &q_emb, limit * 3).unwrap_or_default();
    let vec_ranking: Vec<(i64, f32)> = vec_hits
        .iter()
        .map(|(rowid, sim, _, _)| (*rowid, *sim))
        .collect();

    let fused = rrf_fuse_with_k(&[fts_ranking, vec_ranking], RRF_K);

    // Map rowid → content
    let mut content_by_rowid = std::collections::HashMap::new();
    for (rowid, _id, content) in &fts_hits {
        content_by_rowid.insert(*rowid, content.clone());
    }
    for (rowid, _sim, _id, content) in &vec_hits {
        content_by_rowid
            .entry(*rowid)
            .or_insert_with(|| content.clone());
    }

    let mut out = Vec::new();
    for fr in fused.into_iter().take(limit) {
        if let Some(c) = content_by_rowid.get(&fr.chunk_id) {
            let snippet: String = c.chars().take(400).collect();
            out.push(snippet);
        }
    }
    Ok(out)
}

fn sanitize_fts_query(q: &str) -> String {
    let tokens: Vec<&str> = q
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 2)
        .take(8)
        .collect();
    tokens.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn sample_fact(src: SourceType, pred: &str, val: &str, conf: f64) -> Fact {
        Fact {
            id: "1".into(),
            subject: "user".into(),
            predicate: pred.into(),
            fact_value: val.into(),
            context_condition: None,
            source_type: src,
            status: FactStatus::Active,
            confidence: conf,
            observation_count: 3,
            device_counts: HashMap::new(),
            last_observed_at: chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            valid_from: chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            valid_to: None,
            origin_device_id: "d".into(),
            hlc_timestamp: "1:0:d".into(),
            source_episode_id: None,
            invalidated_by_fact_id: None,
            superseded_by_fact_id: None,
            created_at: String::new(),
            c_eff: Some(conf),
        }
    }

    #[test]
    fn formats_both_tiers() {
        let facts = vec![
            sample_fact(SourceType::ExplicitStatement, "ui_theme", "dark", 1.0),
            sample_fact(SourceType::InferredPattern, "editor", "vim", 0.85),
        ];
        let md = format_preferences_markdown(&facts);
        assert!(md.contains("Explicit Directives"));
        assert!(md.contains("Inferred Behavioral Patterns"));
    }
}
