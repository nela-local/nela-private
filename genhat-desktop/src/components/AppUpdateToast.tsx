import { Download, X } from "lucide-react";
import { useAppUpdateStore } from "../stores/appUpdateStore";

export default function AppUpdateToast() {
  const open = useAppUpdateStore((s) => s.open);
  const info = useAppUpdateStore((s) => s.info);
  const downloadNow = useAppUpdateStore((s) => s.downloadNow);
  const remindLater = useAppUpdateStore((s) => s.remindLater);
  const dismissVersion = useAppUpdateStore((s) => s.dismissVersion);

  if (!open || !info) return null;

  return (
    <div
      className="fixed bottom-4 left-4 z-[92] w-[360px] max-w-[92vw] rounded-xl border border-neon/50 bg-void-800/95 shadow-[0_12px_36px_rgba(0,0,0,0.45)] backdrop-blur-md"
      role="status"
      aria-live="polite"
    >
      <div className="px-4 py-3 text-sm text-txt">
        <div className="mb-1 flex items-start justify-between gap-2">
          <div>
            <div className="font-medium text-neon">Update available</div>
            <div className="text-[0.78rem] text-txt-muted mt-0.5">
              NELA {info.latestVersion} is ready (you have {info.currentVersion}).
            </div>
          </div>
          <button
            type="button"
            className="p-1 rounded text-txt-muted hover:text-txt hover:bg-void-700/50"
            onClick={() => dismissVersion()}
            title="Dismiss this version"
            aria-label="Dismiss this version"
          >
            <X size={14} />
          </button>
        </div>

        {info.assetName ? (
          <div className="text-[11px] text-txt-muted mb-3 truncate" title={info.assetName}>
            {info.platform} · {info.assetName}
          </div>
        ) : (
          <div className="text-[11px] text-txt-muted mb-3">{info.platform} installer</div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neon/15 border border-neon/60 text-neon text-[0.78rem] font-medium hover:bg-neon/25 transition"
            onClick={() => void downloadNow()}
          >
            <Download size={14} />
            Download now
          </button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg border border-glass-border text-[0.78rem] text-txt-muted hover:text-txt hover:border-neon/40 transition"
            onClick={() => remindLater()}
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
