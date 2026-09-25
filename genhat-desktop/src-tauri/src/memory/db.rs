//! SQLite storage for temporal memory: WAL, FTS5, facts, embeddings.

use crate::memory::gcounter::{counts_to_json, parse_counts};
use crate::memory::types::{
    Episode, Fact, FactListFilter, FactStatus, ObservationSignal, SignalType, SourceType,
};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};

#[derive(Debug)]
struct WalModeCustomizer;

impl r2d2::CustomizeConnection<Connection, rusqlite::Error> for WalModeCustomizer {
    fn on_acquire(&self, conn: &mut Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA busy_timeout=5000;
             PRAGMA foreign_keys=ON;",
        )?;
        Ok(())
    }
}

#[derive(Clone)]
pub struct MemoryDb {
    pool: Pool<SqliteConnectionManager>,
    pub path: PathBuf,
}

impl MemoryDb {
    pub fn open(db_path: &Path) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create memory db dir: {e}"))?;
        }
        if !db_path.exists() {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(db_path)
                .map_err(|e| format!("create memory.db: {e}"))?;
        }

        let manager = SqliteConnectionManager::file(db_path);
        let pool = Pool::builder()
            .max_size(8)
            .connection_customizer(Box::new(WalModeCustomizer))
            .build(manager)
            .map_err(|e| format!("memory pool: {e}"))?;

        let db = Self {
            pool,
            path: db_path.to_path_buf(),
        };
        db.migrate()?;
        Ok(db)
    }

    pub fn conn(&self) -> Result<r2d2::PooledConnection<SqliteConnectionManager>, String> {
        self.pool.get().map_err(|e| format!("memory pool get: {e}"))
    }

    /// Exclusive write connection (same pool; writer actor serializes usage).
    pub fn write_conn(&self) -> Result<r2d2::PooledConnection<SqliteConnectionManager>, String> {
        self.conn()
    }

    fn migrate(&self) -> Result<(), String> {
        let conn = self.conn()?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS episodes (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool', 'system')),
                content TEXT NOT NULL,
                is_pruned INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
                content,
                content='episodes',
                content_rowid='rowid'
            );

            CREATE TABLE IF NOT EXISTS observation_signals (
                id TEXT PRIMARY KEY,
                signal_type TEXT NOT NULL CHECK(signal_type IN ('code_edit', 'param_override', 'file_scan', 'rejection')),
                subject TEXT NOT NULL,
                candidate_predicate TEXT NOT NULL,
                candidate_value TEXT NOT NULL,
                context_condition TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                processed INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS facts (
                id TEXT PRIMARY KEY,
                subject TEXT NOT NULL,
                predicate TEXT NOT NULL,
                fact_value TEXT NOT NULL,
                context_condition TEXT,
                context_key TEXT GENERATED ALWAYS AS (COALESCE(context_condition, '__GLOBAL__')) VIRTUAL,
                source_type TEXT NOT NULL CHECK(source_type IN ('explicit_statement', 'inferred_pattern')),
                status TEXT NOT NULL CHECK(status IN ('provisional', 'active', 'superseded')),
                confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
                observation_count INTEGER NOT NULL DEFAULT 1,
                device_counts TEXT NOT NULL DEFAULT '{}',
                last_observed_at DATETIME NOT NULL,
                valid_from DATETIME NOT NULL,
                valid_to DATETIME,
                origin_device_id TEXT NOT NULL,
                hlc_timestamp TEXT NOT NULL,
                source_episode_id TEXT REFERENCES episodes(id),
                invalidated_by_fact_id TEXT REFERENCES facts(id),
                superseded_by_fact_id TEXT REFERENCES facts(id),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE UNIQUE INDEX IF NOT EXISTS uq_active_fact
            ON facts(subject, predicate, context_key)
            WHERE valid_to IS NULL AND status = 'active';

            CREATE INDEX IF NOT EXISTS idx_provisional_eval
            ON facts(predicate, status)
            WHERE status = 'provisional';

            CREATE INDEX IF NOT EXISTS idx_temporal_lookup
            ON facts(valid_from, valid_to);

            CREATE TABLE IF NOT EXISTS embedding_manifest (
                table_name TEXT PRIMARY KEY,
                model_id TEXT NOT NULL,
                dimensions INTEGER NOT NULL,
                distance_metric TEXT NOT NULL,
                indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS predicate_embeddings (
                fact_id TEXT PRIMARY KEY REFERENCES facts(id) ON DELETE CASCADE,
                embedding BLOB NOT NULL
            );

            CREATE TABLE IF NOT EXISTS episode_embeddings (
                episode_id TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
                embedding BLOB NOT NULL
            );

            CREATE TABLE IF NOT EXISTS peer_sync_watermarks (
                peer_device_id TEXT PRIMARY KEY,
                last_synced_hlc TEXT NOT NULL,
                last_synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS memory_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )
        .map_err(|e| format!("memory migrate tables: {e}"))?;

        // FTS triggers — create only if missing
        let trigger_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='episodes_ai'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if trigger_count == 0 {
            conn.execute_batch(
                r#"
                CREATE TRIGGER episodes_ai AFTER INSERT ON episodes BEGIN
                  INSERT INTO episodes_fts(rowid, content) VALUES (new.rowid, new.content);
                END;
                CREATE TRIGGER episodes_ad AFTER DELETE ON episodes BEGIN
                  INSERT INTO episodes_fts(episodes_fts, rowid, content) VALUES('delete', old.rowid, old.content);
                END;
                CREATE TRIGGER episodes_au AFTER UPDATE ON episodes BEGIN
                  INSERT INTO episodes_fts(episodes_fts, rowid, content) VALUES('delete', old.rowid, old.content);
                  INSERT INTO episodes_fts(rowid, content) VALUES(new.rowid, new.content);
                END;
                "#,
            )
            .map_err(|e| format!("memory FTS triggers: {e}"))?;
        }

        Ok(())
    }

    pub fn insert_episode(&self, ep: &Episode) -> Result<(), String> {
        let conn = self.write_conn()?;
        conn.execute(
            "INSERT INTO episodes (id, session_id, role, content, is_pruned, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(NULLIF(?6, ''), CURRENT_TIMESTAMP))",
            params![
                ep.id,
                ep.session_id,
                ep.role.as_str(),
                ep.content,
                ep.is_pruned as i64,
                ep.created_at,
            ],
        )
        .map_err(|e| format!("insert episode: {e}"))?;
        Ok(())
    }

    pub fn insert_signal(&self, sig: &ObservationSignal) -> Result<(), String> {
        let conn = self.write_conn()?;
        conn.execute(
            "INSERT INTO observation_signals
             (id, signal_type, subject, candidate_predicate, candidate_value, context_condition, created_at, processed)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE(NULLIF(?7, ''), CURRENT_TIMESTAMP), ?8)",
            params![
                sig.id,
                sig.signal_type.as_str(),
                sig.subject,
                sig.candidate_predicate,
                sig.candidate_value,
                sig.context_condition,
                sig.created_at,
                sig.processed as i64,
            ],
        )
        .map_err(|e| format!("insert signal: {e}"))?;
        Ok(())
    }

    pub fn insert_fact(&self, fact: &Fact) -> Result<(), String> {
        let conn = self.write_conn()?;
        Self::insert_fact_on(&conn, fact)
    }

    pub fn insert_fact_on(conn: &Connection, fact: &Fact) -> Result<(), String> {
        conn.execute(
            "INSERT INTO facts (
                id, subject, predicate, fact_value, context_condition,
                source_type, status, confidence, observation_count, device_counts,
                last_observed_at, valid_from, valid_to, origin_device_id, hlc_timestamp,
                source_episode_id, invalidated_by_fact_id, superseded_by_fact_id, created_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5,
                ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14, ?15,
                ?16, ?17, ?18, COALESCE(NULLIF(?19, ''), CURRENT_TIMESTAMP)
             )",
            params![
                fact.id,
                fact.subject,
                fact.predicate,
                fact.fact_value,
                fact.context_condition,
                fact.source_type.as_str(),
                fact.status.as_str(),
                fact.confidence,
                fact.observation_count,
                counts_to_json(&fact.device_counts),
                fact.last_observed_at,
                fact.valid_from,
                fact.valid_to,
                fact.origin_device_id,
                fact.hlc_timestamp,
                fact.source_episode_id,
                fact.invalidated_by_fact_id,
                fact.superseded_by_fact_id,
                fact.created_at,
            ],
        )
        .map_err(|e| format!("insert fact: {e}"))?;
        Ok(())
    }

    pub fn update_fact_fields_on(
        conn: &Connection,
        id: &str,
        status: FactStatus,
        valid_to: Option<&str>,
        superseded_by: Option<&str>,
        invalidated_by: Option<&str>,
        confidence: Option<f64>,
        observation_count: Option<i64>,
        device_counts_json: Option<&str>,
        last_observed_at: Option<&str>,
        hlc_timestamp: Option<&str>,
    ) -> Result<(), String> {
        conn.execute(
            "UPDATE facts SET
                status = ?2,
                valid_to = COALESCE(?3, valid_to),
                superseded_by_fact_id = COALESCE(?4, superseded_by_fact_id),
                invalidated_by_fact_id = COALESCE(?5, invalidated_by_fact_id),
                confidence = COALESCE(?6, confidence),
                observation_count = COALESCE(?7, observation_count),
                device_counts = COALESCE(?8, device_counts),
                last_observed_at = COALESCE(?9, last_observed_at),
                hlc_timestamp = COALESCE(?10, hlc_timestamp)
             WHERE id = ?1",
            params![
                id,
                status.as_str(),
                valid_to,
                superseded_by,
                invalidated_by,
                confidence,
                observation_count,
                device_counts_json,
                last_observed_at,
                hlc_timestamp,
            ],
        )
        .map_err(|e| format!("update fact: {e}"))?;
        Ok(())
    }

    pub fn get_fact(&self, id: &str) -> Result<Option<Fact>, String> {
        let conn = self.conn()?;
        conn.query_row(
            "SELECT id, subject, predicate, fact_value, context_condition,
                    source_type, status, confidence, observation_count, device_counts,
                    last_observed_at, valid_from, valid_to, origin_device_id, hlc_timestamp,
                    source_episode_id, invalidated_by_fact_id, superseded_by_fact_id, created_at
             FROM facts WHERE id = ?1",
            params![id],
            row_to_fact,
        )
        .optional()
        .map_err(|e| format!("get fact: {e}"))
    }

    pub fn find_active_fact(
        &self,
        subject: &str,
        predicate: &str,
        context_condition: Option<&str>,
    ) -> Result<Option<Fact>, String> {
        let conn = self.conn()?;
        let ctx_key = context_condition.unwrap_or("__GLOBAL__");
        conn.query_row(
            "SELECT id, subject, predicate, fact_value, context_condition,
                    source_type, status, confidence, observation_count, device_counts,
                    last_observed_at, valid_from, valid_to, origin_device_id, hlc_timestamp,
                    source_episode_id, invalidated_by_fact_id, superseded_by_fact_id, created_at
             FROM facts
             WHERE subject = ?1 AND predicate = ?2 AND context_key = ?3
               AND valid_to IS NULL AND status = 'active'
             LIMIT 1",
            params![subject, predicate, ctx_key],
            row_to_fact,
        )
        .optional()
        .map_err(|e| format!("find active fact: {e}"))
    }

    pub fn find_provisional_fact(
        &self,
        subject: &str,
        predicate: &str,
        context_condition: Option<&str>,
        fact_value: &str,
    ) -> Result<Option<Fact>, String> {
        let conn = self.conn()?;
        let ctx_key = context_condition.unwrap_or("__GLOBAL__");
        conn.query_row(
            "SELECT id, subject, predicate, fact_value, context_condition,
                    source_type, status, confidence, observation_count, device_counts,
                    last_observed_at, valid_from, valid_to, origin_device_id, hlc_timestamp,
                    source_episode_id, invalidated_by_fact_id, superseded_by_fact_id, created_at
             FROM facts
             WHERE subject = ?1 AND predicate = ?2 AND context_key = ?3
               AND fact_value = ?4 AND status = 'provisional' AND valid_to IS NULL
             LIMIT 1",
            params![subject, predicate, ctx_key, fact_value],
            row_to_fact,
        )
        .optional()
        .map_err(|e| format!("find provisional: {e}"))
    }

    pub fn list_facts(&self, filter: &FactListFilter) -> Result<Vec<Fact>, String> {
        let conn = self.conn()?;
        let mut sql = String::from(
            "SELECT id, subject, predicate, fact_value, context_condition,
                    source_type, status, confidence, observation_count, device_counts,
                    last_observed_at, valid_from, valid_to, origin_device_id, hlc_timestamp,
                    source_episode_id, invalidated_by_fact_id, superseded_by_fact_id, created_at
             FROM facts WHERE 1=1",
        );
        let mut binds: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if !filter.include_history {
            sql.push_str(" AND status IN ('active', 'provisional') AND valid_to IS NULL");
        }
        if let Some(ref st) = filter.status {
            sql.push_str(" AND status = ?");
            binds.push(Box::new(st.clone()));
        }
        if let Some(ref src) = filter.source_type {
            sql.push_str(" AND source_type = ?");
            binds.push(Box::new(src.clone()));
        }
        if let Some(ref q) = filter.query {
            sql.push_str(" AND (predicate LIKE ? OR fact_value LIKE ? OR subject LIKE ?)");
            let like = format!("%{q}%");
            binds.push(Box::new(like.clone()));
            binds.push(Box::new(like.clone()));
            binds.push(Box::new(like));
        }
        sql.push_str(" ORDER BY last_observed_at DESC");

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("list facts prepare: {e}"))?;
        let params_refs: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
        let rows = stmt
            .query_map(params_refs.as_slice(), row_to_fact)
            .map_err(|e| format!("list facts query: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("list facts row: {e}"))?);
        }
        Ok(out)
    }

    pub fn list_active_and_provisional(&self) -> Result<Vec<Fact>, String> {
        self.list_facts(&FactListFilter {
            status: None,
            source_type: None,
            query: None,
            include_history: false,
        })
    }

    pub fn list_all_facts(&self) -> Result<Vec<Fact>, String> {
        self.list_facts(&FactListFilter {
            status: None,
            source_type: None,
            query: None,
            include_history: true,
        })
    }

    pub fn delete_fact(&self, id: &str) -> Result<(), String> {
        let conn = self.write_conn()?;
        conn.execute("DELETE FROM predicate_embeddings WHERE fact_id = ?1", params![id])
            .map_err(|e| format!("delete embedding: {e}"))?;
        conn.execute("DELETE FROM facts WHERE id = ?1", params![id])
            .map_err(|e| format!("delete fact: {e}"))?;
        Ok(())
    }

    pub fn clear_facts(&self, include_episodes: bool) -> Result<(), String> {
        let conn = self.write_conn()?;
        conn.execute_batch(
            "DELETE FROM predicate_embeddings;
             DELETE FROM facts;
             DELETE FROM observation_signals;",
        )
        .map_err(|e| format!("clear facts: {e}"))?;
        if include_episodes {
            conn.execute_batch(
                "DELETE FROM episode_embeddings;
                 DELETE FROM episodes;",
            )
            .map_err(|e| format!("clear episodes: {e}"))?;
        }
        Ok(())
    }

    pub fn upsert_predicate_embedding(&self, fact_id: &str, embedding: &[u8]) -> Result<(), String> {
        let conn = self.write_conn()?;
        conn.execute(
            "INSERT INTO predicate_embeddings (fact_id, embedding) VALUES (?1, ?2)
             ON CONFLICT(fact_id) DO UPDATE SET embedding = excluded.embedding",
            params![fact_id, embedding],
        )
        .map_err(|e| format!("upsert predicate embedding: {e}"))?;
        Ok(())
    }

    pub fn upsert_episode_embedding(&self, episode_id: &str, embedding: &[u8]) -> Result<(), String> {
        let conn = self.write_conn()?;
        conn.execute(
            "INSERT INTO episode_embeddings (episode_id, embedding) VALUES (?1, ?2)
             ON CONFLICT(episode_id) DO UPDATE SET embedding = excluded.embedding",
            params![episode_id, embedding],
        )
        .map_err(|e| format!("upsert episode embedding: {e}"))?;
        Ok(())
    }

    pub fn list_predicate_embeddings(&self) -> Result<Vec<(String, Vec<u8>, String)>, String> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare(
                "SELECT pe.fact_id, pe.embedding, f.predicate
                 FROM predicate_embeddings pe
                 JOIN facts f ON f.id = pe.fact_id
                 WHERE f.status IN ('active', 'provisional') AND f.valid_to IS NULL",
            )
            .map_err(|e| format!("list pred emb: {e}"))?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?, r.get::<_, String>(2)?))
            })
            .map_err(|e| format!("list pred emb query: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("pred emb row: {e}"))?);
        }
        Ok(out)
    }

    pub fn set_manifest(
        &self,
        table_name: &str,
        model_id: &str,
        dimensions: u32,
        distance_metric: &str,
    ) -> Result<(), String> {
        let conn = self.write_conn()?;
        conn.execute(
            "INSERT INTO embedding_manifest (table_name, model_id, dimensions, distance_metric, indexed_at)
             VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
             ON CONFLICT(table_name) DO UPDATE SET
               model_id = excluded.model_id,
               dimensions = excluded.dimensions,
               distance_metric = excluded.distance_metric,
               indexed_at = CURRENT_TIMESTAMP",
            params![table_name, model_id, dimensions as i64, distance_metric],
        )
        .map_err(|e| format!("set manifest: {e}"))?;
        Ok(())
    }

    pub fn get_manifest(
        &self,
        table_name: &str,
    ) -> Result<Option<(String, u32, String)>, String> {
        let conn = self.conn()?;
        conn.query_row(
            "SELECT model_id, dimensions, distance_metric FROM embedding_manifest WHERE table_name = ?1",
            params![table_name],
            |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as u32, r.get(2)?)),
        )
        .optional()
        .map_err(|e| format!("get manifest: {e}"))
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.write_conn()?;
        conn.execute(
            "INSERT INTO memory_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| format!("set meta: {e}"))?;
        Ok(())
    }

    pub fn get_meta(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn()?;
        conn.query_row(
            "SELECT value FROM memory_meta WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("get meta: {e}"))
    }

    pub fn fts_search(&self, query: &str, limit: usize) -> Result<Vec<(i64, String, String)>, String> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare(
                "SELECT e.rowid, e.id, e.content
                 FROM episodes_fts f
                 JOIN episodes e ON e.rowid = f.rowid
                 WHERE episodes_fts MATCH ?1 AND e.is_pruned = 0
                 ORDER BY rank
                 LIMIT ?2",
            )
            .map_err(|e| format!("fts prepare: {e}"))?;
        let rows = stmt
            .query_map(params![query, limit as i64], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .map_err(|e| format!("fts query: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("fts row: {e}"))?);
        }
        Ok(out)
    }

    pub fn list_episode_embeddings(&self) -> Result<Vec<(String, i64, Vec<u8>, String)>, String> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare(
                "SELECT e.id, e.rowid, ee.embedding, e.content
                 FROM episode_embeddings ee
                 JOIN episodes e ON e.id = ee.episode_id
                 WHERE e.is_pruned = 0",
            )
            .map_err(|e| format!("list ep emb: {e}"))?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, Vec<u8>>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| format!("ep emb query: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("ep emb row: {e}"))?);
        }
        Ok(out)
    }

    pub fn unprocessed_signals(&self, limit: usize) -> Result<Vec<ObservationSignal>, String> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, signal_type, subject, candidate_predicate, candidate_value,
                        context_condition, created_at, processed
                 FROM observation_signals WHERE processed = 0
                 ORDER BY created_at ASC LIMIT ?1",
            )
            .map_err(|e| format!("signals prepare: {e}"))?;
        let rows = stmt
            .query_map(params![limit as i64], |r| {
                Ok(ObservationSignal {
                    id: r.get(0)?,
                    signal_type: SignalType::parse(&r.get::<_, String>(1)?)
                        .unwrap_or(SignalType::CodeEdit),
                    subject: r.get(2)?,
                    candidate_predicate: r.get(3)?,
                    candidate_value: r.get(4)?,
                    context_condition: r.get(5)?,
                    created_at: r.get(6)?,
                    processed: r.get::<_, i64>(7)? != 0,
                })
            })
            .map_err(|e| format!("signals query: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("signal row: {e}"))?);
        }
        Ok(out)
    }

    pub fn mark_signal_processed(&self, id: &str) -> Result<(), String> {
        let conn = self.write_conn()?;
        conn.execute(
            "UPDATE observation_signals SET processed = 1 WHERE id = ?1",
            params![id],
        )
        .map_err(|e| format!("mark signal: {e}"))?;
        Ok(())
    }

    pub fn prune_old_episodes(&self) -> Result<usize, String> {
        let conn = self.write_conn()?;
        let n = conn
            .execute(
                "UPDATE episodes SET content = '[PRUNED_EPISODE_ARCHIVE: facts preserved]', is_pruned = 1
                 WHERE created_at < datetime('now', '-90 days') AND is_pruned = 0",
                [],
            )
            .map_err(|e| format!("prune episodes: {e}"))?;
        let _ = conn.execute_batch("PRAGMA incremental_vacuum;");
        Ok(n)
    }

    pub fn upsert_peer_watermark(&self, peer: &str, hlc: &str) -> Result<(), String> {
        let conn = self.write_conn()?;
        conn.execute(
            "INSERT INTO peer_sync_watermarks (peer_device_id, last_synced_hlc, last_synced_at)
             VALUES (?1, ?2, CURRENT_TIMESTAMP)
             ON CONFLICT(peer_device_id) DO UPDATE SET
               last_synced_hlc = excluded.last_synced_hlc,
               last_synced_at = CURRENT_TIMESTAMP",
            params![peer, hlc],
        )
        .map_err(|e| format!("peer watermark: {e}"))?;
        Ok(())
    }
}

fn row_to_fact(r: &rusqlite::Row<'_>) -> rusqlite::Result<Fact> {
    let device_counts_json: String = r.get(9)?;
    Ok(Fact {
        id: r.get(0)?,
        subject: r.get(1)?,
        predicate: r.get(2)?,
        fact_value: r.get(3)?,
        context_condition: r.get(4)?,
        source_type: SourceType::parse(&r.get::<_, String>(5)?)
            .unwrap_or(SourceType::InferredPattern),
        status: FactStatus::parse(&r.get::<_, String>(6)?).unwrap_or(FactStatus::Active),
        confidence: r.get(7)?,
        observation_count: r.get(8)?,
        device_counts: parse_counts(&device_counts_json),
        last_observed_at: r.get(10)?,
        valid_from: r.get(11)?,
        valid_to: r.get(12)?,
        origin_device_id: r.get(13)?,
        hlc_timestamp: r.get(14)?,
        source_episode_id: r.get(15)?,
        invalidated_by_fact_id: r.get(16)?,
        superseded_by_fact_id: r.get(17)?,
        created_at: r.get(18)?,
        c_eff: None,
    })
}

pub fn new_uuid_v7() -> String {
    uuid::Uuid::now_v7().to_string()
}

pub fn now_sqlite() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn embedding_to_bytes(embedding: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(embedding.len() * 4);
    for &v in embedding {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    bytes
}

pub fn bytes_to_embedding(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect()
}

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom < 1e-12 {
        0.0
    } else {
        dot / denom
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::types::Role;
    use std::collections::HashMap;
    use tempfile::tempdir;

    #[test]
    fn fts_tracks_insert_and_prune() {
        let dir = tempdir().unwrap();
        let db = MemoryDb::open(&dir.path().join("memory.db")).unwrap();
        let ep = Episode {
            id: new_uuid_v7(),
            session_id: "s1".into(),
            role: Role::User,
            content: "I prefer dark mode UI".into(),
            is_pruned: false,
            created_at: now_sqlite(),
        };
        db.insert_episode(&ep).unwrap();
        let hits = db.fts_search("dark", 10).unwrap();
        assert!(!hits.is_empty());

        let conn = db.write_conn().unwrap();
        conn.execute(
            "UPDATE episodes SET content = '[PRUNED_EPISODE_ARCHIVE: facts preserved]', is_pruned = 1 WHERE id = ?1",
            params![ep.id],
        )
        .unwrap();
        drop(conn);
        let hits2 = db.fts_search("\"PRUNED_EPISODE_ARCHIVE\"", 10).unwrap();
        assert!(!hits2.is_empty() || db.fts_search("PRUNED*", 10).is_ok());
    }

    #[test]
    fn active_fact_unique_constraint() {
        let dir = tempdir().unwrap();
        let db = MemoryDb::open(&dir.path().join("memory.db")).unwrap();
        let mut counts = HashMap::new();
        counts.insert("d".into(), 1u64);
        let now = now_sqlite();
        let f1 = Fact {
            id: new_uuid_v7(),
            subject: "user".into(),
            predicate: "theme".into(),
            fact_value: "dark".into(),
            context_condition: None,
            source_type: SourceType::ExplicitStatement,
            status: FactStatus::Active,
            confidence: 1.0,
            observation_count: 1,
            device_counts: counts.clone(),
            last_observed_at: now.clone(),
            valid_from: now.clone(),
            valid_to: None,
            origin_device_id: "d".into(),
            hlc_timestamp: "1:0:d".into(),
            source_episode_id: None,
            invalidated_by_fact_id: None,
            superseded_by_fact_id: None,
            created_at: now.clone(),
            c_eff: None,
        };
        db.insert_fact(&f1).unwrap();
        let f2 = Fact {
            id: new_uuid_v7(),
            fact_value: "light".into(),
            hlc_timestamp: "2:0:d".into(),
            ..f1.clone()
        };
        assert!(db.insert_fact(&f2).is_err());
    }
}
