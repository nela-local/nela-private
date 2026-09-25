//! Domain types for the embedded bi-temporal memory layer.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const LAMBDA: f64 = 0.035;
pub const C_OMIT: f64 = 0.20;
pub const DELTA_POS: f64 = 0.25;
pub const DELTA_NEG: f64 = 0.40;
pub const PROMOTE_N: i64 = 3;
pub const PROMOTE_C: f64 = 0.80;
pub const SIM_AUTO: f64 = 0.92;
pub const SIM_ASK: f64 = 0.78;
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    User,
    Assistant,
    Tool,
    System,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::User => "user",
            Role::Assistant => "assistant",
            Role::Tool => "tool",
            Role::System => "system",
        }
    }

    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "user" => Ok(Role::User),
            "assistant" => Ok(Role::Assistant),
            "tool" => Ok(Role::Tool),
            "system" => Ok(Role::System),
            other => Err(format!("invalid role: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SignalType {
    CodeEdit,
    ParamOverride,
    FileScan,
    Rejection,
}

impl SignalType {
    pub fn as_str(self) -> &'static str {
        match self {
            SignalType::CodeEdit => "code_edit",
            SignalType::ParamOverride => "param_override",
            SignalType::FileScan => "file_scan",
            SignalType::Rejection => "rejection",
        }
    }

    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "code_edit" => Ok(SignalType::CodeEdit),
            "param_override" => Ok(SignalType::ParamOverride),
            "file_scan" => Ok(SignalType::FileScan),
            "rejection" => Ok(SignalType::Rejection),
            other => Err(format!("invalid signal_type: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceType {
    ExplicitStatement,
    InferredPattern,
}

impl SourceType {
    pub fn as_str(self) -> &'static str {
        match self {
            SourceType::ExplicitStatement => "explicit_statement",
            SourceType::InferredPattern => "inferred_pattern",
        }
    }

    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "explicit_statement" => Ok(SourceType::ExplicitStatement),
            "inferred_pattern" => Ok(SourceType::InferredPattern),
            other => Err(format!("invalid source_type: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactStatus {
    Provisional,
    Active,
    Superseded,
}

impl FactStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            FactStatus::Provisional => "provisional",
            FactStatus::Active => "active",
            FactStatus::Superseded => "superseded",
        }
    }

    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "provisional" => Ok(FactStatus::Provisional),
            "active" => Ok(FactStatus::Active),
            "superseded" => Ok(FactStatus::Superseded),
            other => Err(format!("invalid status: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Episode {
    pub id: String,
    pub session_id: String,
    pub role: Role,
    pub content: String,
    pub is_pruned: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationSignal {
    pub id: String,
    pub signal_type: SignalType,
    pub subject: String,
    pub candidate_predicate: String,
    pub candidate_value: String,
    pub context_condition: Option<String>,
    pub created_at: String,
    pub processed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fact {
    pub id: String,
    pub subject: String,
    pub predicate: String,
    pub fact_value: String,
    pub context_condition: Option<String>,
    pub source_type: SourceType,
    pub status: FactStatus,
    pub confidence: f64,
    pub observation_count: i64,
    pub device_counts: HashMap<String, u64>,
    pub last_observed_at: String,
    pub valid_from: String,
    pub valid_to: Option<String>,
    pub origin_device_id: String,
    pub hlc_timestamp: String,
    pub source_episode_id: Option<String>,
    pub invalidated_by_fact_id: Option<String>,
    pub superseded_by_fact_id: Option<String>,
    pub created_at: String,
    /// Lazily computed effective confidence; not stored.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub c_eff: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportManifest {
    pub model_id: String,
    pub dimensions: u32,
    pub schema_version: u32,
    pub device_id: String,
    pub exported_hlc: String,
    #[serde(default)]
    pub reindex_predicates_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBundle {
    pub manifest: ExportManifest,
    pub facts: Vec<Fact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FactListFilter {
    pub status: Option<String>,
    pub source_type: Option<String>,
    pub query: Option<String>,
    #[serde(default)]
    pub include_history: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssembleContextResult {
    pub preferences_markdown: String,
    pub episodic_snippets: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordEpisodeRequest {
    pub session_id: String,
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestSignalRequest {
    pub signal_type: String,
    pub subject: String,
    pub candidate_predicate: String,
    pub candidate_value: String,
    pub context_condition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFactRequest {
    pub id: String,
    pub fact_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearMemoryRequest {
    #[serde(default)]
    pub include_episodes: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RememberFactRequest {
    pub predicate: String,
    pub fact_value: String,
    #[serde(default = "default_subject")]
    pub subject: String,
    pub context_condition: Option<String>,
    /// When true (default), store as an explicit directive.
    #[serde(default = "default_explicit")]
    pub explicit: bool,
}

fn default_subject() -> String {
    "user".to_string()
}

fn default_explicit() -> bool {
    true
}
