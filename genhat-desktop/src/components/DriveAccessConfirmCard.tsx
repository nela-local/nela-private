import { HardDrive, X } from "lucide-react";
import {
  resolveDriveAccessConfirm,
  useDriveAccessConfirmStore,
} from "../stores/driveAccessConfirmStore";
import "./GmailSendConfirmCard.css";

export default function DriveAccessConfirmCard() {
  const pending = useDriveAccessConfirmStore((s) => s.pending);
  if (!pending) return null;

  const { request } = pending;
  const confirm = () => {
    resolveDriveAccessConfirm({ confirmed: true, request });
  };
  const cancel = () => {
    resolveDriveAccessConfirm({ confirmed: false, reason: "user_cancelled" });
  };

  const kindLabel =
    request.kind === "search"
      ? "Search Drive"
      : request.kind === "list_recent"
        ? "List recent files"
        : "Open Drive file";

  const detail =
    request.kind === "search" && request.query
      ? `Query: ${request.query}${request.maxResults ? ` · up to ${request.maxResults} results` : ""}`
      : request.kind === "list_recent"
        ? `Up to ${request.maxResults ?? 5} recently modified files`
        : request.fileNameHint
          ? `File: ${request.fileNameHint}`
          : request.fileId
            ? `File id: ${request.fileId}`
            : "One Drive file";

  return (
    <div className="gmail-confirm" role="dialog" aria-label="Allow Google Drive access">
      <div className="gmail-confirm__header">
        <div className="gmail-confirm__title">
          <HardDrive size={16} />
          <strong>Allow Google Drive?</strong>
        </div>
        <button
          type="button"
          className="gmail-confirm__icon-btn"
          onClick={cancel}
          aria-label="Cancel Drive access"
        >
          <X size={16} />
        </button>
      </div>
      <p className="gmail-confirm__hint">
        {request.purpose}. NELA will access Drive only for this request — file
        content stays on this device for summarization and is not stored in the cloud.
      </p>
      <p className="gmail-confirm__hint" style={{ marginTop: 0 }}>
        <strong>{kindLabel}</strong> · {detail}
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
