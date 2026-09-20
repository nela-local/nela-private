import {
  FileCode,
  LayoutDashboard,
  Presentation,
  Table2,
} from "lucide-react";
import {
  artifactKindLabel,
  useWorkspaceArtifacts,
  type ArtifactKind,
  type WorkspaceArtifactItem,
} from "../app/workspaceArtifacts";
import { useSessionStore } from "../stores/sessionStore";

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

  const artifacts = useWorkspaceArtifacts();
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const activePath = activeSession?.artifactPath ?? null;
  const panelOpen = Boolean(activeSession?.artifactPanelOpen);

  const openArtifact = (item: WorkspaceArtifactItem) => {
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
                          {artifactKindLabel(item.kind)}
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
