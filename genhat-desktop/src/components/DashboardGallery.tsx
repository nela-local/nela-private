import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ArrowLeft,
  Check,
  LayoutDashboard,
  Loader2,
  Maximize2,
  Minimize2,
  Pencil,
  X,
} from "lucide-react";
import { attachTallyLiveBridge } from "../app/tallyLiveBridge";
import { isLiveTallyDashboardHtml } from "../app/tallyStaticDashboard";
import {
  readTallySnapshotCache,
  resolveDashboardPreviewHtml,
  loadLastShownTallySnapshot,
  TALLY_OFFLINE_NOTICE,
} from "../app/tallyDashboardSnapshotCache";
import {
  renameWorkspaceArtifact,
  useWorkspaceDashboards,
  type WorkspaceArtifactItem,
} from "../app/workspaceArtifacts";

const THUMB_INNER_W = 1280;
const THUMB_INNER_H = 800;

function DashboardTitleEditor({
  title,
  onSave,
  className = "",
  inputClassName = "",
}: {
  title: string;
  onSave: (next: string) => void;
  className?: string;
  inputClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== title) onSave(next);
    else setDraft(title);
  };

  const cancel = () => {
    setDraft(title);
    setEditing(false);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };

  if (editing) {
    return (
      <div
        className={`flex items-center gap-1 min-w-0 ${className}`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          className={`flex-1 min-w-0 bg-void-900 border border-neon/40 rounded-md px-2 py-1 text-txt outline-none focus:ring-1 focus:ring-neon/50 ${inputClassName}`}
          aria-label="Dashboard name"
          data-tour="dashboard-rename-input"
        />
        <button
          type="button"
          className="p-1 rounded text-neon hover:bg-neon-subtle shrink-0"
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          title="Save name"
          aria-label="Save name"
        >
          <Check size={14} />
        </button>
        <button
          type="button"
          className="p-1 rounded text-txt-muted hover:bg-void-700 shrink-0"
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancel}
          title="Cancel"
          aria-label="Cancel rename"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-1.5 min-w-0 ${className}`}>
      <span className={`truncate min-w-0 ${inputClassName}`}>{title}</span>
      <button
        type="button"
        className="p-1 rounded text-txt-muted opacity-0 group-hover:opacity-100 hover:text-neon hover:bg-neon-subtle shrink-0 transition-opacity"
        onClick={(e: ReactMouseEvent) => {
          e.stopPropagation();
          e.preventDefault();
          setEditing(true);
        }}
        title="Rename dashboard"
        aria-label="Rename dashboard"
        data-tour="dashboard-rename-btn"
      >
        <Pencil size={13} />
      </button>
    </div>
  );
}

function DashboardThumbCard({
  item,
  onOpen,
  onRename,
}: {
  item: WorkspaceArtifactItem;
  onOpen: () => void;
  onRename: (title: string) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(0.2);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const updateScale = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(w / THUMB_INNER_W);
    };
    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);

    (async () => {
      try {
        // Prefer cached snapshot for live Tally thumbs (shows real figures offline).
        const cached = await readTallySnapshotCache(item.path);
        if (cancelled) return;
        if (cached) {
          setHtml(cached);
          setLoading(false);
          return;
        }
        const resolved = await resolveDashboardPreviewHtml(item.path);
        if (cancelled) return;
        setHtml(resolved.html);
        setLoading(false);
      } catch {
        if (cancelled) return;
        setHtml(null);
        setFailed(true);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, item.path]);

  const previewHeight = Math.round(THUMB_INNER_H * scale);

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      className="group flex flex-col text-left rounded-xl border-2 border-glass-border bg-void-800/80 overflow-hidden transition-all duration-150 hover:border-neon/45 hover:shadow-[0_0_18px_rgba(0,212,255,0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon/50 cursor-pointer"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      title={item.title}
      data-tour="dashboard-gallery-card"
    >
      <div
        className="relative w-full overflow-hidden bg-void-900 border-b-2 border-glass-border"
        style={{ height: previewHeight || 150 }}
      >
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-txt-muted">
            <Loader2 size={22} className="animate-spin text-neon" />
          </div>
        )}
        {failed && !loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-txt-muted px-3">
            <LayoutDashboard size={28} className="text-neon/60" />
            <span className="text-[0.75rem] text-center">Preview unavailable</span>
          </div>
        )}
        {html && (
          <div
            className="pointer-events-none origin-top-left"
            style={
              {
                width: THUMB_INNER_W,
                height: THUMB_INNER_H,
                transform: `scale(${scale})`,
              } as CSSProperties
            }
          >
            <iframe
              title={`${item.title} preview`}
              srcDoc={html}
              sandbox="allow-scripts"
              className="w-full h-full border-0 bg-white"
              tabIndex={-1}
            />
          </div>
        )}
        {!html && !loading && !failed && (
          <div className="absolute inset-0 flex items-center justify-center text-txt-muted">
            <LayoutDashboard size={28} className="text-neon/40" />
          </div>
        )}
      </div>
      <div className="px-3 py-2.5 min-w-0 w-full">
        <DashboardTitleEditor
          title={item.title}
          onSave={onRename}
          className="w-full"
          inputClassName="text-[0.88rem] font-medium text-txt group-hover:text-neon transition-colors"
        />
      </div>
    </div>
  );
}

function DashboardEnlargedView({
  item,
  onBack,
  onRename,
}: {
  item: WorkspaceArtifactItem;
  onBack: () => void;
  onRename: (title: string) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [mode, setMode] = useState<"live" | "snapshot" | "static">("static");
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [isOsFullscreen, setIsOsFullscreen] = useState(false);
  const enteredFsRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setHtml(null);
    setOfflineNotice(null);

    resolveDashboardPreviewHtml(item.path)
      .then((resolved) => {
        if (cancelled) return;
        setHtml(resolved.html);
        setMode(resolved.mode);
        setOfflineNotice(resolved.offlineNotice);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item.path]);

  useEffect(() => {
    if (!html || mode !== "live" || !isLiveTallyDashboardHtml(html)) return;
    const liveShell = html;
    const detach = attachTallyLiveBridge(
      () => iframeRef.current?.contentWindow ?? null,
      {
        artifactPath: item.path,
        liveHtml: liveShell,
        onDisconnected: () => {
          void (async () => {
            const cached = await loadLastShownTallySnapshot(item.path);
            if (cached) {
              setHtml(cached);
              setMode("snapshot");
              setOfflineNotice(TALLY_OFFLINE_NOTICE);
            } else {
              setOfflineNotice(
                "Tally is offline and no previously loaded data is available yet."
              );
            }
          })();
        },
      }
    );
    return () => detach();
  }, [html, mode, item.path]);

  // Cover the whole app window; also try OS fullscreen once content is ready.
  useEffect(() => {
    if (loading || failed || !html || enteredFsRef.current) return;
    const el = canvasRef.current;
    if (!el) return;
    enteredFsRef.current = true;
    void el.requestFullscreen?.().catch(() => {
      /* fixed overlay already fills the app window */
    });
  }, [loading, failed, html]);

  useEffect(() => {
    const onFsChange = () => {
      const el = canvasRef.current;
      const active = Boolean(el && document.fullscreenElement === el);
      setIsOsFullscreen(active);
      // Esc / OS exit from true fullscreen → return to the gallery grid.
      if (enteredFsRef.current && !active && document.fullscreenElement == null) {
        onBack();
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [onBack]);

  useEffect(() => {
    return () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, []);

  const handleBack = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined).finally(onBack);
      return;
    }
    onBack();
  }, [onBack]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) {
        e.preventDefault();
        handleBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleBack]);

  const toggleOsFullscreen = useCallback(async () => {
    const el = canvasRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
        enteredFsRef.current = true;
      }
    } catch (err) {
      console.warn("Dashboard fullscreen failed:", err);
    }
  }, []);

  return (
    <div
      ref={canvasRef}
      className="fixed inset-0 z-[80] flex flex-col bg-void-900"
      data-tour="dashboard-gallery-enlarged"
    >
      <div className="h-11 px-4 flex items-center gap-3 shrink-0 border-b border-glass-border bg-void-800/95">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-txt-secondary hover:text-neon hover:bg-neon-subtle transition-colors"
          onClick={handleBack}
          data-tour="dashboard-gallery-back"
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <div className="group flex-1 min-w-0">
          <DashboardTitleEditor
            title={item.title}
            onSave={onRename}
            inputClassName="text-[0.95rem] font-medium text-txt"
          />
        </div>
        {mode === "snapshot" && (
          <span className="text-[0.7rem] text-amber-400/90 shrink-0 px-2 py-0.5 rounded border border-amber-400/25 bg-amber-400/10">
            Saved snapshot
          </span>
        )}
        <button
          type="button"
          className="p-2 rounded-lg text-txt-secondary hover:text-neon hover:bg-neon-subtle transition-colors shrink-0"
          onClick={() => void toggleOsFullscreen()}
          title={isOsFullscreen ? "Exit full screen" : "Full screen"}
          aria-label={isOsFullscreen ? "Exit full screen" : "Full screen"}
        >
          {isOsFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>

      {offlineNotice && (
        <div className="px-4 py-2 text-[0.78rem] text-amber-200/90 bg-amber-500/10 border-b border-amber-400/20 shrink-0">
          {offlineNotice}
        </div>
      )}

      <div className="flex-1 min-h-0 relative bg-void-900">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-txt-muted text-sm">
            <Loader2 size={20} className="animate-spin text-neon" />
            Loading dashboard…
          </div>
        )}
        {failed && !loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-txt-muted text-sm px-6">
            <LayoutDashboard size={36} className="text-neon/50" />
            <p>Could not load this dashboard.</p>
          </div>
        )}
        {html && (
          <iframe
            ref={iframeRef}
            title={item.title}
            srcDoc={html}
            sandbox="allow-scripts"
            className="w-full h-full border-0 bg-white"
            allow="fullscreen"
          />
        )}
      </div>
    </div>
  );
}

export default function DashboardGallery() {
  const dashboards = useWorkspaceDashboards();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const selected =
    selectedPath != null
      ? dashboards.find((d) => d.path === selectedPath) ?? null
      : null;

  const clearSelection = useCallback(() => setSelectedPath(null), []);

  const handleRename = useCallback((path: string, title: string) => {
    renameWorkspaceArtifact(path, title);
  }, []);

  useEffect(() => {
    if (selectedPath && !dashboards.some((d) => d.path === selectedPath)) {
      setSelectedPath(null);
    }
  }, [dashboards, selectedPath]);

  if (selected) {
    return (
      <DashboardEnlargedView
        item={selected}
        onBack={clearSelection}
        onRename={(title) => handleRename(selected.path, title)}
      />
    );
  }

  return (
    <div
      className="flex-1 flex flex-col min-h-0 h-full overflow-hidden"
      data-tour="dashboard-gallery"
    >
      <div className="px-6 pt-5 pb-3 shrink-0">
        <h1 className="text-xl font-semibold text-txt">Dashboards</h1>
        <p className="mt-1 text-[0.8rem] text-txt-muted">
          Previews of dashboards generated in this workspace. Hover a name to
          rename it.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-8">
        {dashboards.length === 0 ? (
          <div className="h-full min-h-[240px] flex flex-col items-center justify-center gap-3 text-center px-6">
            <LayoutDashboard size={40} className="text-neon/45" />
            <p className="text-txt-muted text-sm max-w-md leading-relaxed">
              No dashboards yet. Ask in chat for a dashboard or live view — it
              will appear here.
            </p>
          </div>
        ) : (
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            }}
          >
            {dashboards.map((item) => (
              <DashboardThumbCard
                key={item.key}
                item={item}
                onOpen={() => setSelectedPath(item.path)}
                onRename={(title) => handleRename(item.path, title)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
