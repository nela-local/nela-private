import { HardDrive, X } from "lucide-react";
import { useDriveStore } from "../stores/driveStore";
import { useDriveConnectPromptStore } from "../stores/driveConnectPromptStore";
import "./GmailSendConfirmCard.css";

export default function DriveConnectCard() {
  const visible = useDriveConnectPromptStore((s) => s.visible);
  const hide = useDriveConnectPromptStore((s) => s.hide);
  const connected = useDriveStore((s) => s.connected);
  const loading = useDriveStore((s) => s.loading);
  const error = useDriveStore((s) => s.error);
  const connect = useDriveStore((s) => s.connect);

  if (!visible || connected) return null;

  const onConnect = () => {
    void connect()
      .then(() => hide())
      .catch(() => undefined);
  };

  return (
    <div className="gmail-confirm" role="dialog" aria-label="Connect Google Drive">
      <div className="gmail-confirm__header">
        <div className="gmail-confirm__title">
          <HardDrive size={16} />
          <strong>Connect Google Drive</strong>
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
        Connect Google Drive so NELA can search files, share open links, and
        summarize Docs/Sheets you approve. You&apos;ll confirm every Drive access.
      </p>
      {error ? <p className="gmail-confirm__error">{error}</p> : null}
      <div className="gmail-confirm__actions">
        <button type="button" className="gmail-confirm__cancel" onClick={hide}>
          Not now
        </button>
        <button
          type="button"
          className="gmail-confirm__send"
          onClick={onConnect}
          disabled={loading}
        >
          {loading ? "Opening Google…" : "Connect Drive"}
        </button>
      </div>
    </div>
  );
}
