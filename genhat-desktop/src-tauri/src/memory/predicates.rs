//! Two-stage predicate resolution: lexical then semantic.

use crate::memory::db::{bytes_to_embedding, cosine_similarity, MemoryDb};
use crate::memory::types::{SIM_ASK, SIM_AUTO};
use strsim::{damerau_levenshtein, jaro_winkler};

#[derive(Debug, Clone, PartialEq)]
pub enum PredicateMatch {
    Exact { predicate: String },
    Semantic { predicate: String, similarity: f64 },
    Ambiguous { candidate: String, existing: String, similarity: f64 },
    New,
}

/// Stage 1: lexical collision if Damerau-Levenshtein distance ≤ 2
/// (or very high Jaro-Winkler as a soft assist).
pub fn lexical_match(candidate: &str, existing: &[String]) -> Option<String> {
    let cand = candidate.to_lowercase();
    for pred in existing {
        let p = pred.to_lowercase();
        if damerau_levenshtein(&cand, &p) <= 2 {
            return Some(pred.clone());
        }
        if jaro_winkler(&cand, &p) >= 0.96 && cand.len().abs_diff(p.len()) <= 2 {
            return Some(pred.clone());
        }
    }
    None
}

/// Stage 2: embedding cosine against active predicate embeddings.
pub fn semantic_match(
    db: &MemoryDb,
    candidate_embedding: &[f32],
) -> Result<PredicateMatch, String> {
    let rows = db.list_predicate_embeddings()?;
    let mut best: Option<(String, f64)> = None;
    for (_fact_id, bytes, predicate) in rows {
        let emb = bytes_to_embedding(&bytes);
        let sim = cosine_similarity(candidate_embedding, &emb) as f64;
        if best.as_ref().map(|(_, s)| sim > *s).unwrap_or(true) {
            best = Some((predicate, sim));
        }
    }
    match best {
        Some((pred, sim)) if sim >= SIM_AUTO => Ok(PredicateMatch::Semantic {
            predicate: pred,
            similarity: sim,
        }),
        Some((pred, sim)) if sim >= SIM_ASK => Ok(PredicateMatch::Ambiguous {
            candidate: String::new(), // filled by caller
            existing: pred,
            similarity: sim,
        }),
        _ => Ok(PredicateMatch::New),
    }
}

/// Resolve a candidate predicate against known actives.
pub fn resolve_predicate(
    db: &MemoryDb,
    candidate: &str,
    candidate_embedding: Option<&[f32]>,
) -> Result<PredicateMatch, String> {
    let existing: Vec<String> = db
        .list_active_and_provisional()?
        .into_iter()
        .map(|f| f.predicate)
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();

    if let Some(hit) = lexical_match(candidate, &existing) {
        return Ok(PredicateMatch::Exact { predicate: hit });
    }

    if let Some(emb) = candidate_embedding {
        let mut m = semantic_match(db, emb)?;
        if let PredicateMatch::Ambiguous {
            existing,
            similarity,
            ..
        } = m
        {
            m = PredicateMatch::Ambiguous {
                candidate: candidate.to_string(),
                existing,
                similarity,
            };
        }
        return Ok(m);
    }

    Ok(PredicateMatch::New)
}

/// Apply a JSON disambiguation answer: `{ "match": true|false }`.
pub fn apply_disambiguation(
    ambiguous: PredicateMatch,
    match_yes: bool,
) -> PredicateMatch {
    match ambiguous {
        PredicateMatch::Ambiguous { existing, similarity, .. } if match_yes => {
            PredicateMatch::Semantic {
                predicate: existing,
                similarity,
            }
        }
        _ => PredicateMatch::New,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lexical_distance_two_collides() {
        let existing = vec!["preferred_theme".into()];
        assert_eq!(
            lexical_match("preferred_thme", &existing),
            Some("preferred_theme".into())
        );
    }

    #[test]
    fn distant_predicate_is_new() {
        let existing = vec!["preferred_theme".into()];
        assert!(lexical_match("favorite_food", &existing).is_none());
    }
}
