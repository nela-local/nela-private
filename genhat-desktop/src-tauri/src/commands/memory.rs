//! Tauri IPC for the temporal memory layer.

use crate::memory::sync::ImportResult;
use crate::memory::types::{
    AssembleContextResult, ClearMemoryRequest, ExportBundle, Fact, FactListFilter,
    IngestSignalRequest, RecordEpisodeRequest, RememberFactRequest, UpdateFactRequest,
};
use crate::memory::MemoryEngine;
use crate::memory::compact::MaintenanceReport;
use std::sync::Arc;
use tauri::State;

pub struct MemoryEngineState(pub Arc<MemoryEngine>);

#[tauri::command]
pub async fn memory_record_episode(
    state: State<'_, MemoryEngineState>,
    request: RecordEpisodeRequest,
) -> Result<String, String> {
    state.0.record_episode(request).await
}

#[tauri::command]
pub async fn memory_ingest_signal(
    state: State<'_, MemoryEngineState>,
    request: IngestSignalRequest,
) -> Result<(), String> {
    state.0.ingest_signal(request).await
}

#[tauri::command]
pub async fn memory_remember_fact(
    state: State<'_, MemoryEngineState>,
    request: RememberFactRequest,
) -> Result<Fact, String> {
    state.0.remember_fact(request).await
}

#[tauri::command]
pub async fn memory_assemble_context(
    state: State<'_, MemoryEngineState>,
    session_id: String,
    query: String,
) -> Result<AssembleContextResult, String> {
    state.0.assemble_context(&session_id, &query).await
}

#[tauri::command]
pub async fn memory_list_facts(
    state: State<'_, MemoryEngineState>,
    filter: FactListFilter,
) -> Result<Vec<Fact>, String> {
    state.0.list_facts(filter)
}

#[tauri::command]
pub async fn memory_get_fact(
    state: State<'_, MemoryEngineState>,
    id: String,
) -> Result<Option<Fact>, String> {
    state.0.get_fact(&id)
}

#[tauri::command]
pub async fn memory_update_fact(
    state: State<'_, MemoryEngineState>,
    request: UpdateFactRequest,
) -> Result<Fact, String> {
    state.0.update_fact(request).await
}

#[tauri::command]
pub async fn memory_forget_fact(
    state: State<'_, MemoryEngineState>,
    id: String,
) -> Result<(), String> {
    state.0.forget_fact(id).await
}

#[tauri::command]
pub async fn memory_delete_fact(
    state: State<'_, MemoryEngineState>,
    id: String,
) -> Result<(), String> {
    state.0.delete_fact(id).await
}

#[tauri::command]
pub async fn memory_clear(
    state: State<'_, MemoryEngineState>,
    request: ClearMemoryRequest,
) -> Result<(), String> {
    state.0.clear_memory(request).await
}

#[tauri::command]
pub async fn memory_export_bundle(
    state: State<'_, MemoryEngineState>,
    model_id: Option<String>,
    dimensions: Option<u32>,
) -> Result<ExportBundle, String> {
    state
        .0
        .export_bundle(
            model_id.as_deref().unwrap_or("hash-embed"),
            dimensions.unwrap_or(384),
        )
        .await
}

#[tauri::command]
pub async fn memory_import_bundle(
    state: State<'_, MemoryEngineState>,
    bundle: ExportBundle,
    model_id: Option<String>,
    dimensions: Option<u32>,
) -> Result<ImportResult, String> {
    state
        .0
        .import_bundle(
            bundle,
            model_id.as_deref().unwrap_or("hash-embed"),
            dimensions.unwrap_or(384),
        )
        .await
}

#[tauri::command]
pub async fn memory_run_maintenance(
    state: State<'_, MemoryEngineState>,
) -> Result<MaintenanceReport, String> {
    state.0.run_maintenance().await
}
