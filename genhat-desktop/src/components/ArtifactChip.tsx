import { useEffect, useState } from "react";
import {
  CloudUpload,
  Download,
  FileCode,
  Table2,
  Presentation,
  PanelRightOpen,
  PanelRightClose,
  Loader2,
} from "lucide-react";
import { downloadArtifactCopy, looksLikePresentationTitle } from "../app/artifactDownload";
import { useConnectorStore } from "../stores/connectorStore";
import { friendlyErrorFromUnknown } from "../app/friendlyError";

export interface ArtifactChipProps {
  title: string;
  type?: "text/html" | "text/csv";
  path?: string | null;
  /** True while the side panel is showing this artifact. */
  panelOpen?: boolean;
  /** Still generating (no path yet). */
  loading?: boolean;
  onTogglePanel: () => void;
}

export default function ArtifactChip({
  title,
  type = "text/html",
  path,
  panelOpen = false,
  loading = false,
  onTogglePanel,
}: ArtifactChipProps) {
  const [downloading, setDownloading] = useState(false);
  const [savingDrive, setSavingDrive] = useState(false);
  const connections = useConnectorStore((s) => s.connections);
  const refresh = useConnectorStore((s) => s.refresh);
  const saveLocalFile = useConnectorStore((s) => s.saveLocalFile);

  useEffect(() => {
    if (connections.length === 0) void refresh();
  }, [connections.length, refresh]);

  const driveConn = connections.find((c) => c.providerId === "gdrive");
  const isPresentation =
    type !== "text/csv" && looksLikePresentationTitle(title, path ?? undefined);

  const Icon =
    type === "text/csv" ? Table2 : isPresentation ? Presentation : FileCode;

  const label =
    title.trim() ||
    (type === "text/csv" ? "Spreadsheet" : isPresentation ? "Presentation" : "Artifact");

  const onDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!path || downloading) return;
    setDownloading(true);
    try {
      await downloadArtifactCopy(path);
    } catch (err) {
      console.warn("Artifact download failed:", err);
    } finally {
      setDownloading(false);
    }
  };

  const onSaveToDrive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!path || !driveConn || savingDrive) return;
    setSavingDrive(true);
    try {
      const base =
        title.trim().replace(/[^\w\- ]+/g, "").trim() ||
        path.split(/[/\\]/).pop() ||
        "artifact";
      const ext = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "";
      const name = base.toLowerCase().endsWith(ext.toLowerCase())
        ? base
        : `${base}${ext}`;
      await saveLocalFile(driveConn.id, path, name, driveConn.remoteFolderId);
    } catch (err) {
      console.warn("Save to Drive failed:", friendlyErrorFromUnknown(err));
    } finally {
      setSavingDrive(false);
    }
  };

  const kindLabel =
    type === "text/csv"
      ? "Spreadsheet"
      : isPresentation
        ? "Presentation · save as PPTX"
        : "HTML artifact";

  return (
    <div className="mt-3 max-w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-glass-border bg-void-700">
      <button
        type="button"
        onClick={onTogglePanel}
        className="flex-1 min-w-0 flex items-center gap-2.5 text-left hover:opacity-90 transition"
        title={panelOpen ? "Hide artifact panel" : "Show artifact panel"}
      >
        {loading ? (
          <Loader2 size={16} className="text-neon shrink-0 animate-spin" />
        ) : (
          <Icon size={16} className="text-neon shrink-0" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[0.82rem] font-medium text-txt truncate">
            {label}
          </span>
          <span className="block text-[0.68rem] text-txt-muted truncate">
            {loading ? "Generating…" : kindLabel}
          </span>
        </span>
      </button>
      <div className="flex items-center gap-0.5 shrink-0">
        {driveConn && (
          <button
            type="button"
            onClick={onSaveToDrive}
            disabled={!path || savingDrive || loading}
            className="p-1.5 rounded-lg text-txt-muted hover:text-neon hover:bg-glass-hover transition disabled:opacity-40 disabled:pointer-events-none"
            title="Save to Google Drive"
            aria-label="Save to Google Drive"
          >
            {savingDrive ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <CloudUpload size={15} />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onDownload}
          disabled={!path || downloading || loading}
          className="p-1.5 rounded-lg text-txt-muted hover:text-neon hover:bg-glass-hover transition disabled:opacity-40 disabled:pointer-events-none"
          title={
            path
              ? isPresentation
                ? "Download as PowerPoint, PDF, Word, or HTML"
                : "Download as Word or HTML"
              : "Download available when ready"
          }
          aria-label={
            isPresentation
              ? "Download presentation as PowerPoint"
              : "Download artifact"
          }
        >
          {downloading ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Download size={15} />
          )}
        </button>
        <button
          type="button"
          onClick={onTogglePanel}
          className="p-1.5 rounded-lg text-txt-muted hover:text-neon hover:bg-glass-hover transition"
          title={panelOpen ? "Hide artifact panel" : "Show artifact panel"}
          aria-label={panelOpen ? "Hide artifact panel" : "Show artifact panel"}
        >
          {panelOpen ? (
            <PanelRightClose size={15} />
          ) : (
            <PanelRightOpen size={15} />
          )}
        </button>
      </div>
    </div>
  );
}
