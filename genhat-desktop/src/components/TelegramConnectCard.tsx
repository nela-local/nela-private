import { MessageCircle, X } from "lucide-react";
import { useTelegramStore } from "../stores/telegramStore";
import { useTelegramConnectPromptStore } from "../stores/telegramConnectPromptStore";
import "./GmailSendConfirmCard.css";

export default function TelegramConnectCard() {
  const visible = useTelegramConnectPromptStore((s) => s.visible);
  const hide = useTelegramConnectPromptStore((s) => s.hide);
  const connected = useTelegramStore((s) => s.connected);
  const openWizard = useTelegramStore((s) => s.openWizard);

  if (!visible || connected) return null;

  return (
    <div className="gmail-confirm" role="dialog" aria-label="Connect Telegram">
      <div className="gmail-confirm__header">
        <div className="gmail-confirm__title">
          <MessageCircle size={16} />
          <strong>Connect Telegram</strong>
        </div>
        <button
          type="button"
          className="gmail-confirm__icon-btn"
          onClick={hide}
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
      <p className="gmail-confirm__hint">
        Connect your Telegram account so NELA can send and read messages you
        approve. You confirm every send and every read.
      </p>
      <div className="gmail-confirm__actions">
        <button type="button" className="gmail-confirm__cancel" onClick={hide}>
          Not now
        </button>
        <button
          type="button"
          className="gmail-confirm__send"
          onClick={() => {
            hide();
            openWizard();
          }}
        >
          Connect Telegram
        </button>
      </div>
    </div>
  );
}
