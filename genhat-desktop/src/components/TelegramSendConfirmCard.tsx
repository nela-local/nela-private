import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import {
  resolveTelegramSendConfirm,
  useTelegramSendConfirmStore,
  type TelegramDraft,
} from "../stores/telegramSendConfirmStore";
import "./GmailSendConfirmCard.css";

export default function TelegramSendConfirmCard() {
  const pending = useTelegramSendConfirmStore((s) => s.pending);
  const [draft, setDraft] = useState<TelegramDraft | null>(null);
  const [initId, setInitId] = useState<string | null>(null);

  const requestId = pending?.requestId ?? null;
  if (pending && requestId !== initId) {
    setInitId(requestId);
    setDraft(pending.draft);
  }

  useEffect(() => {
    if (!pending) {
      setDraft(null);
      setInitId(null);
    }
  }, [pending]);

  if (!pending || !draft) return null;

  const confirm = () => {
    if (!draft.to.trim() || !draft.body.trim()) return;
    resolveTelegramSendConfirm({
      confirmed: true,
      draft: { to: draft.to.trim(), body: draft.body },
    });
  };

  const cancel = () => {
    resolveTelegramSendConfirm({ confirmed: false, reason: "user_cancelled" });
  };

  const canSend = draft.to.trim().length > 0 && draft.body.trim().length > 0;

  return (
    <div className="gmail-confirm" role="dialog" aria-label="Confirm Telegram message">
      <div className="gmail-confirm__header">
        <div className="gmail-confirm__title">
          <MessageCircle size={16} />
          <strong>Send this Telegram message?</strong>
        </div>
        <button
          type="button"
          className="gmail-confirm__icon-btn"
          onClick={cancel}
          aria-label="Cancel Telegram send"
        >
          <X size={16} />
        </button>
      </div>
      <p className="gmail-confirm__hint">
        Review and edit before sending. Nothing is sent until you confirm.
      </p>
      <label className="gmail-confirm__field">
        <span>Chat</span>
        <input
          value={draft.to}
          onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          placeholder="@username or saved name"
          autoComplete="off"
        />
      </label>
      <label className="gmail-confirm__field">
        <span>Message</span>
        <textarea
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          rows={6}
        />
      </label>
      <div className="gmail-confirm__actions">
        <button type="button" className="gmail-confirm__cancel" onClick={cancel}>
          Cancel
        </button>
        <button
          type="button"
          className="gmail-confirm__send"
          onClick={confirm}
          disabled={!canSend}
        >
          Send
        </button>
      </div>
    </div>
  );
}
