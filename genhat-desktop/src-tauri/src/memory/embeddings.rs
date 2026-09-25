//! Predicate / episode embedding helpers (BLOB + cosine).

use crate::memory::db::{bytes_to_embedding, cosine_similarity, embedding_to_bytes, MemoryDb};
use crate::memory::writer::MemoryWriter;

/// Hash-based fallback embedding when no model is available (deterministic, 384-d).
pub fn hash_embed(text: &str, dims: usize) -> Vec<f32> {
    let dims = if dims == 0 { 384 } else { dims };
    let mut v = vec![0.0f32; dims];
    for (i, b) in text.bytes().enumerate() {
        let idx = (b as usize).wrapping_mul(31).wrapping_add(i) % dims;
        v[idx] += 1.0;
    }
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-6);
    for x in &mut v {
        *x /= norm;
    }
    v
}

pub async fn store_predicate_embedding(
    writer: &MemoryWriter,
    fact_id: &str,
    text: &str,
    dims: usize,
) -> Result<Vec<f32>, String> {
    let emb = hash_embed(text, dims);
    writer
        .upsert_predicate_embedding(fact_id.to_string(), embedding_to_bytes(&emb))
        .await?;
    Ok(emb)
}

pub async fn store_episode_embedding(
    writer: &MemoryWriter,
    episode_id: &str,
    text: &str,
    dims: usize,
) -> Result<(), String> {
    let emb = hash_embed(text, dims);
    writer
        .upsert_episode_embedding(episode_id.to_string(), embedding_to_bytes(&emb))
        .await
}

pub fn top_k_episode_by_vector(
    db: &MemoryDb,
    query: &[f32],
    k: usize,
) -> Result<Vec<(i64, f32, String, String)>, String> {
    let rows = db.list_episode_embeddings()?;
    let mut scored: Vec<(i64, f32, String, String)> = rows
        .into_iter()
        .map(|(id, rowid, bytes, content)| {
            let emb = bytes_to_embedding(&bytes);
            let sim = cosine_similarity(query, &emb);
            (rowid, sim, id, content)
        })
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(k);
    Ok(scored)
}

pub fn reindex_all_predicates(db: &MemoryDb, dims: usize) -> Result<usize, String> {
    let facts = db.list_active_and_provisional()?;
    let mut n = 0;
    for f in facts {
        let emb = hash_embed(&f.predicate, dims);
        db.upsert_predicate_embedding(&f.id, &embedding_to_bytes(&emb))?;
        n += 1;
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn similar_text_higher_similarity() {
        let a = hash_embed("preferred theme", 384);
        let b = hash_embed("preferred theme", 384);
        let c = hash_embed("totally unrelated cuisine preference xyz", 384);
        assert!(cosine_similarity(&a, &b) > 0.99);
        assert!(cosine_similarity(&a, &c) < cosine_similarity(&a, &b));
    }
}
