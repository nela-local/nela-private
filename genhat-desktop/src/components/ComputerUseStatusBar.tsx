import { Loader2, Monitor, Square } from "lucide-react";
import {
  cancelComputerUseRun,
  useComputerUseStore,
} from "../stores/computerUseStore";

/** Compact live status strip while Computer Use is running. */
export default function ComputerUseStatusBar() {
  const running = useComputerUseStore((s) => s.running);
  const goal = useComputerUseStore((s) => s.goal);
  const lastNarration = useComputerUseStore((s) => s.lastNarration);
  const lastError = useComputerUseStore((s) => s.lastError);
  const steps = useComputerUseStore((s) => s.steps);

  if (!running && !lastError) return null;

  return (
    <div className="mx-3 mb-2 rounded-lg border border-glass-border bg-void-800/60 px-3 py-2 text-[0.78rem]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 text-txt">
          {running ? (
            <Loader2 size={14} className="animate-spin shrink-0 text-neon" />
          ) : (
            <Monitor size={14} className="shrink-0 text-txt-muted" />
          )}
          <span className="font-medium shrink-0">Computer Use</span>
          {goal ? (
            <span className="text-txt-muted truncate">· {goal}</span>
          ) : null}
        </div>
        {running ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 shrink-0"
            onClick={() => void cancelComputerUseRun()}
          >
            <Square size={12} />
            Stop
          </button>
        ) : null}
      </div>
      {lastNarration ? (
        <div className="mt-1 text-txt-muted truncate">{lastNarration}</div>
      ) : null}
      {steps.length > 0 ? (
        <div className="mt-1 text-[0.7rem] text-txt-muted">
          Step {steps[steps.length - 1]!.step}: {steps[steps.length - 1]!.action}
        </div>
      ) : null}
      {lastError ? (
        <div className="mt-1 text-red-400">{lastError}</div>
      ) : null}
    </div>
  );
}
