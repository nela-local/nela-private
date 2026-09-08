import { MessageCircle, X } from "lucide-react";
import {
  resolveTelegramReadConfirm,
  useTelegramReadConfirmStore,
} from "../stores/telegramReadConfirmStore";
import "./GmailSendConfirmCard.css";

export default function TelegramReadConfirmCard() {
  const pending = useTelegramReadConfirmStore((s) => s.pending);
  if (!pending) return null;

  const { request } = pending;
  const confirm = () => {
    resolveTelegramReadConfirm({ confirmed: true, request });
  };
  const cancel = () => {
    resolveTelegramReadConfirm({ confirmed: false, reason: "user_cancelled" });
  };

  const detail =
    request.maxResults === 1
      ? "Latest chat preview"
      : `Up to ${request.maxResults} recent chats`;

  return (
    <div className="gmail-confirm" role="dialog" aria-label="Allow Telegram read">
      <div className="gmail-confirm__header">
        <div className="gmail-confirm__title">
          <MessageCircle size={16} />
          <strong>Allow Telegram read?</strong>
        </div>
        <button
          type="button"
          className="gmail-confirm__icon-btn"
          onClick={cancel}
          aria-label="Cancel Telegram read"
        >
          <X size={16} />
        </button>
      </div>
      <p className="gmail-confirm__hint">
        {request.purpose}. NELA will fetch chat previews only for this request
        — nothing is stored in the cloud.
      </p>
      <p className="gmail-confirm__hint" style={{ marginTop: 0 }}>
        {detail}
      </p>
      <div className="gmail-confirm__actions">
        <button type="button" className="gmail-confirm__cancel" onClick={cancel}>
          Deny
        </button>
        <button type="button" className="gmail-confirm__send" onClick={confirm}>
          Allow once
        </button>
      </div>
    </div>
  );
}
