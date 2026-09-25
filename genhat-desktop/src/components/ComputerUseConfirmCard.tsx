import { Monitor, X } from "lucide-react";
import {
  denyComputerUsePending,
  resolveComputerUsePending,
  useComputerUseStore,
} from "../stores/computerUseStore";
import "./GmailSendConfirmCard.css";

export default function ComputerUseConfirmCard() {
  const pending = useComputerUseStore((s) => s.pendingInput);
  if (!pending) return null;

  const isStart = pending.runId === "__start__";
  const title =
    pending.kind === "confirm"
      ? isStart
        ? "Allow Computer Use?"
        : "Confirm this action?"
      : "Computer Use needs input";

  const allow = () => {
    void resolveComputerUsePending(isStart ? "__allow__" : "yes");
  };
  const deny = () => {
    void denyComputerUsePending();
  };

  return (
    <div className="gmail-confirm" role="dialog" aria-label={title}>
      <div className="gmail-confirm__header">
        <div className="gmail-confirm__title">
          <Monitor size={16} />
          <strong>{title}</strong>
        </div>
        <button
          type="button"
          className="gmail-confirm__icon-btn"
          onClick={deny}
          aria-label="Deny"
        >
          <X size={16} />
        </button>
      </div>
      <p className="gmail-confirm__hint" style={{ whiteSpace: "pre-wrap" }}>
        {pending.prompt}
      </p>
      {pending.kind === "clarify" ? (
        <ClarifyForm onSubmit={(text) => void resolveComputerUsePending(text)} onCancel={deny} />
      ) : (
        <div className="gmail-confirm__actions">
          <button type="button" className="gmail-confirm__cancel" onClick={deny}>
            Deny
          </button>
          <button type="button" className="gmail-confirm__send" onClick={allow}>
            {isStart ? "Allow" : "Proceed"}
          </button>
        </div>
      )}
    </div>
  );
}

function ClarifyForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="gmail-confirm__actions"
      style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const text = String(fd.get("answer") || "").trim();
        if (text) onSubmit(text);
      }}
    >
      <input
        name="answer"
        className="flex-1 rounded border border-glass-border bg-void-900 px-2 py-1.5 text-[0.8rem] text-txt"
        placeholder="Type your answer…"
        autoFocus
      />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="gmail-confirm__cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="gmail-confirm__send">
          Send
        </button>
      </div>
    </form>
  );
}
