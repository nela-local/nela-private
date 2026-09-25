import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brain, Loader2, Pencil, Trash2, EyeOff, Download, Upload, RefreshCw } from "lucide-react";
import { Api, type MemoryFact, type MemoryExportBundle } from "../api";

const MemorySettings: React.FC = () => {
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [includeHistory, setIncludeHistory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearEpisodes, setClearEpisodes] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await Api.memoryListFacts({
        query: query.trim() || null,
        includeHistory,
      });
      setFacts(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [query, includeHistory]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const explicit = useMemo(
    () => facts.filter((f) => f.sourceType === "explicit_statement"),
    [facts]
  );
  const inferred = useMemo(
    () => facts.filter((f) => f.sourceType === "inferred_pattern"),
    [facts]
  );

  const startEdit = (f: MemoryFact) => {
    setEditingId(f.id);
    setEditValue(f.factValue);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setBusyId(editingId);
    try {
      await Api.memoryUpdateFact({ id: editingId, factValue: editValue.trim() });
      setEditingId(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const forget = async (id: string) => {
    if (!confirm("Forget this memory? It will leave active context but stay in history.")) return;
    setBusyId(id);
    try {
      await Api.memoryForgetFact(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const hardDelete = async (id: string) => {
    if (!confirm("Permanently delete this memory? This cannot be undone.")) return;
    setBusyId(id);
    try {
      await Api.memoryDeleteFact(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const clearAll = async () => {
    if (
      !confirm(
        clearEpisodes
          ? "Delete ALL memories and conversation archive?"
          : "Delete ALL preference memories?"
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      await Api.memoryClear({ includeEpisodes: clearEpisodes });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const exportBundle = async () => {
    try {
      const bundle = await Api.memoryExportBundle();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "nela-memory-export.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onImportFile = async (file: File | null) => {
    if (!file) return;
    try {
      const raw = await file.text();
      const bundle = JSON.parse(raw) as MemoryExportBundle;
      await Api.memoryImportBundle(bundle);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const renderGroup = (title: string, rows: MemoryFact[]) => (
    <div className="mt-3">
      <div className="text-[0.78rem] font-semibold text-txt mb-1.5">{title}</div>
      {rows.length === 0 ? (
        <div className="text-[0.75rem] text-txt-muted">None</div>
      ) : (
        <ul className="space-y-2 m-0 p-0 list-none">
          {rows.map((f) => (
            <li
              key={f.id}
              className="rounded-lg border border-glass-border px-3 py-2 bg-void-800/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[0.82rem] font-medium text-txt truncate">
                    {f.predicate}
                    {f.status !== "active" && f.status !== "provisional" ? (
                      <span className="ml-2 text-[0.7rem] text-txt-muted">({f.status})</span>
                    ) : null}
                  </div>
                  {editingId === f.id ? (
                    <div className="mt-1 flex gap-2">
                      <input
                        className="flex-1 rounded border border-glass-border bg-void-900 px-2 py-1 text-[0.8rem] text-txt"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveEdit();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <button
                        type="button"
                        className="text-[0.75rem] px-2 py-1 rounded border border-glass-border hover:border-neon/50"
                        onClick={() => void saveEdit()}
                        disabled={busyId === f.id}
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <div className="text-[0.78rem] text-txt-muted mt-0.5 break-words">
                      {f.factValue}
                    </div>
                  )}
                  <div className="text-[0.7rem] text-txt-muted mt-1">
                    conf {(f.cEff ?? f.confidence).toFixed(2)}
                    {f.sourceType === "inferred_pattern"
                      ? ` · observed ${f.observationCount}×`
                      : ""}
                    {" · "}
                    {f.lastObservedAt}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {f.status === "active" || f.status === "provisional" ? (
                    <>
                      <button
                        type="button"
                        title="Edit"
                        className="p-1.5 rounded hover:bg-void-700 text-txt-muted hover:text-txt"
                        onClick={() => startEdit(f)}
                        disabled={busyId === f.id}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        title="Forget"
                        className="p-1.5 rounded hover:bg-void-700 text-txt-muted hover:text-txt"
                        onClick={() => void forget(f.id)}
                        disabled={busyId === f.id}
                      >
                        <EyeOff size={14} />
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    title="Delete permanently"
                    className="p-1.5 rounded hover:bg-void-700 text-txt-muted hover:text-red-400"
                    onClick={() => void hardDelete(f.id)}
                    disabled={busyId === f.id}
                  >
                    {busyId === f.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="settings-group">
      <div className="flex items-center gap-2 mb-1">
        <Brain size={16} className="text-txt-muted" />
        <div className="settings-group-title m-0">Memory</div>
      </div>
      <div className="settings-field-hint mb-3">
        What NELA has learned about you on this device. Edit or delete anytime —
        changes take effect on the next chat turn.
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="search"
          placeholder="Search preferences…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[140px] rounded-lg border border-glass-border bg-void-900 px-2.5 py-1.5 text-[0.8rem] text-txt"
        />
        <label className="inline-flex items-center gap-1.5 text-[0.75rem] text-txt-muted">
          <input
            type="checkbox"
            checked={includeHistory}
            onChange={(e) => setIncludeHistory(e.target.checked)}
          />
          History
        </label>
        <button
          type="button"
          onClick={() => void reload()}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-glass-border text-[0.75rem] text-txt-muted hover:text-txt"
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="text-[0.75rem] text-red-400 mb-2">{error}</div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-[0.8rem] text-txt-muted py-4">
          <Loader2 size={14} className="animate-spin" />
          Loading memories…
        </div>
      ) : (
        <>
          {renderGroup("Explicit directives", explicit)}
          {renderGroup("Inferred patterns", inferred)}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-glass-border">
        <button
          type="button"
          onClick={() => void exportBundle()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-glass-border text-[0.75rem] text-txt-muted hover:text-txt"
        >
          <Download size={13} />
          Export
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-glass-border text-[0.75rem] text-txt-muted hover:text-txt"
        >
          <Upload size={13} />
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = "";
            void onImportFile(f);
          }}
        />
        <label className="inline-flex items-center gap-1.5 text-[0.72rem] text-txt-muted ml-auto">
          <input
            type="checkbox"
            checked={clearEpisodes}
            onChange={(e) => setClearEpisodes(e.target.checked)}
          />
          Also clear archive
        </label>
        <button
          type="button"
          onClick={() => void clearAll()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-500/40 text-[0.75rem] text-red-400 hover:bg-red-500/10"
        >
          <Trash2 size={13} />
          Clear all
        </button>
      </div>
    </div>
  );
};

export default MemorySettings;
