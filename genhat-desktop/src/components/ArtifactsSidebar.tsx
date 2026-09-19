import { useMemo } from "react";
import {
  FileCode,
  LayoutDashboard,
  Presentation,
  Table2,
} from "lucide-react";
import { looksLikePresentationTitle } from "../app/artifactDownload";
import { useSessionStore } from "../stores/sessionStore";

type ArtifactKind = "dashboard" | "presentation" | "spreadsheet" | "page";

type ArtifactListItem = {
  key: string;
  path: string;
  title: string;
  kind: ArtifactKind;
  sessionId: string;
  /** User prompt that led to this artifact. */
  prompt: string;
  /** Best-effort sort key (message order ≈ recency within session). */
  sortIndex: number;
};

function filenameTitle(path: string): string {
  const base = path.split(/[/\\]/).pop() || "Artifact";
  return base
    .replace(/\.(html?|csv|xlsx?)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Artifact";
}

function precedingUserPrompt(
  messages: { role: string; content?: string }[],
  assistantIdx: number
): string {
  for (let i = assistantIdx - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role === "user") {
      const text = (m.content ?? "").replace(/\s+/g, " ").trim();
      return text || "No prompt";
    }
  }
  return "No prompt";
}

function detectKind(path: string, title: string): ArtifactKind {
  const lowerPath = path.toLowerCase();
  const lowerTitle = title.toLowerCase();
  if (/\.(csv|xlsx?)$/i.test(lowerPath)) return "spreadsheet";
  if (looksLikePresentationTitle(title, path)) return "presentation";
  if (
    /tally|day[\s_-]?book|dashboard|live\s+dashboard|trial\s+balance|outstanding/i.test(
      `${lowerTitle} ${lowerPath}`
    )
  ) {
    return "dashboard";
  }
  return "page";
}

function kindLabel(kind: ArtifactKind): string {
  switch (kind) {
    case "dashboard":
      return "Dashboard";
    case "presentation":
      return "Presentation";
    case "spreadsheet":
      return "Spreadsheet";
    default:
      return "Page";
  }
}

function KindIcon({ kind }: { kind: ArtifactKind }) {
  const className = "text-neon shrink-0";
  switch (kind) {
    case "dashboard":
      return <LayoutDashboard size={16} className={className} />;
    case "presentation":
      return <Presentation size={16} className={className} />;
    case "spreadsheet":
      return <Table2 size={16} className={className} />;
    default:
      return <FileCode size={16} className={className} />;
  }
}

export default function ArtifactsSidebar() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const openSessionInViewer = useSessionStore((s) => s.openSessionInViewer);
  const updateSession = useSessionStore((s) => s.updateSession);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const activePath = activeSession?.artifactPath ?? null;
  const panelOpen = Boolean(activeSession?.artifactPanelOpen);

  const artifacts = useMemo(() => {
    const byPath = new Map<string, ArtifactListItem>();
    let globalIndex = 0;

    for (const session of sessions) {
      const push = (
        path: string | null | undefined,
        titleHint: string | null | undefined,
        prompt: string
      ) => {
        const trimmed = path?.trim();
        if (!trimmed) return;
        const title =
          (titleHint && titleHint.trim()) || filenameTitle(trimmed);
        const kind = detectKind(trimmed, title);
        const existing = byPath.get(trimmed);
        const item: ArtifactListItem = {
          key: trimmed,
          path: trimmed,
          title,
          kind,
          sessionId: session.id,
          prompt,
          sortIndex: globalIndex++,
        };
        // Prefer a later occurrence (newer message / session-level update).
        if (!existing || item.sortIndex >= existing.sortIndex) {
          byPath.set(trimmed, item);
        }
      };

      for (let i = 0; i < session.messages.length; i += 1) {
        const msg = session.messages[i]!;
        if (msg.role !== "assistant") continue;
        const prompt = precedingUserPrompt(session.messages, i);
        const refs =
          msg.artifacts && msg.artifacts.length > 0
            ? msg.artifacts
            : msg.artifactPath
              ? [{ path: msg.artifactPath, title: msg.artifactTitle }]
              : [];
        for (const ref of refs) {
          push(ref.path, ref.title || msg.artifactTitle, prompt);
        }
      }

      // Session-level path only if not already covered by a message.
      const sessionPath = session.artifactPath?.trim();
      if (sessionPath && !byPath.has(sessionPath)) {
        let prompt = "No prompt";
        for (let i = session.messages.length - 1; i >= 0; i -= 1) {
          const m = session.messages[i];
          if (m?.role === "user") {
            prompt = (m.content ?? "").replace(/\s+/g, " ").trim() || "No prompt";
            break;
          }
        }
        push(sessionPath, session.streamingArtifactTitle, prompt);
      }
    }

    return [...byPath.values()].sort((a, b) => b.sortIndex - a.sortIndex);
  }, [sessions]);

  const openArtifact = (item: ArtifactListItem) => {
    openSessionInViewer(item.sessionId);
    updateSession(item.sessionId, () => ({
      artifactPath: item.path,
      artifactPanelOpen: true,
      artifactStage: "LivePreview",
      streamingArtifactHtml: undefined,
      streamingArtifactCsv: undefined,
    }));
  };

  return (
    <aside
      className="w-[280px] min-w-[280px] border-r border-glass-border bg-void-800 flex flex-col"
      data-tour="artifacts-sidebar"
    >
      <div className="h-10 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-txt">
          <span className="text-2xl font-semibold mt-2">Dashboards</span>
        </div>
      </div>

      <div className="px-4 pb-1">
        <p className="text-[0.72rem] text-txt-muted leading-snug">
          Open pages, sheets, and live views from your chats — no browser needed.
        </p>
      </div>

      <div className="flex-1 p-2 flex flex-col min-h-0">
        <div className="flex-1 bg-void-900 border border-glass-border rounded-xl p-2 flex flex-col gap-1.5 shadow-md overflow-y-auto">
          {artifacts.length === 0 ? (
            <div className="text-[0.9rem] text-txt-muted p-2 leading-snug">
              Nothing here yet. Ask in chat for a dashboard, page, or spreadsheet —
              it will show up in this list.
            </div>
          ) : (
            artifacts.map((item) => {
              const isOpen =
                panelOpen &&
                activeSessionId === item.sessionId &&
                activePath === item.path;

              return (
                <button
                  key={item.key}
                  type="button"
                  className={`group relative w-full text-left rounded-xl border px-3 py-2.5 transition-all duration-150 ${
                    isOpen
                      ? "bg-neon-subtle border-neon/30 text-txt shadow-[0_0_14px_rgba(0,212,255,0.08)]"
                      : "bg-void-700/65 border-glass-border text-txt-secondary hover:border-neon/20 hover:text-txt"
                  }`}
                  onClick={() => openArtifact(item)}
                  title={`${item.title}\n${item.prompt}`}
                  data-tour="artifact-sidebar-item"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <KindIcon kind={item.kind} />
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[0.82rem] font-medium truncate">
                          {item.title}
                        </span>
                        <span className="text-[0.68rem] text-txt-muted shrink-0">
                          {kindLabel(item.kind)}
                        </span>
                      </div>
                      <p className="mt-1 text-[0.72rem] text-txt-muted leading-snug max-h-[2.4em] overflow-hidden">
                        {item.prompt}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
