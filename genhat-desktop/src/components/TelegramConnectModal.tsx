import { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, MessageCircle, X } from "lucide-react";
import { useTelegramStore } from "../stores/telegramStore";
import { useConnectorStore } from "../stores/connectorStore";
import "./GmailSendConfirmCard.css";
import "./TelegramConnectModal.css";

export default function TelegramConnectModal() {
  const open = useTelegramStore((s) => s.wizardOpen);
  const step = useTelegramStore((s) => s.wizardStep);
  const loading = useTelegramStore((s) => s.loading);
  const error = useTelegramStore((s) => s.error);
  const hint = useTelegramStore((s) => s.passwordHint);
  const closeWizard = useTelegramStore((s) => s.closeWizard);
  const start = useTelegramStore((s) => s.start);
  const submitCode = useTelegramStore((s) => s.submitCode);
  const submitPassword = useTelegramStore((s) => s.submitPassword);
  const refreshConnectors = useConnectorStore((s) => s.refresh);

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");

  if (!open) return null;

  const finishIfConnected = async (fn: () => Promise<void>) => {
    await fn();
    if (useTelegramStore.getState().connected) {
      await refreshConnectors();
    }
  };

  const title =
    step === "phone"
      ? "Connect Telegram"
      : step === "code"
        ? "Enter the login code"
        : "Two-step password";

  return createPortal(
    <div
      className="telegram-wizard"
      role="dialog"
      aria-modal="true"
      aria-label="Connect Telegram"
      onClick={closeWizard}
    >
      <div
        className="gmail-confirm telegram-wizard__card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gmail-confirm__header">
          <div className="gmail-confirm__title">
            <MessageCircle size={16} />
            <strong>{title}</strong>
          </div>
          <button
            type="button"
            className="gmail-confirm__icon-btn"
            onClick={closeWizard}
            aria-label="Cancel Telegram connect"
          >
            <X size={16} />
          </button>
        </div>
        {step === "phone" ? (
          <>
            <p className="gmail-confirm__hint">
              Telegram will send a code to this number. Use country code.
              The session stays on this device.
            </p>
            <label className="gmail-confirm__field">
              <span>Phone</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+14155552671"
                autoComplete="tel"
                autoFocus
              />
            </label>
            {error ? <p className="gmail-confirm__error">{error}</p> : null}
            <div className="gmail-confirm__actions">
              <button type="button" className="gmail-confirm__cancel" onClick={closeWizard}>
                Cancel
              </button>
              <button
                type="button"
                className="gmail-confirm__send"
                disabled={loading || !phone.trim()}
                onClick={() => void finishIfConnected(() => start(phone)).catch(() => undefined)}
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                {loading ? "Sending code…" : "Send code"}
              </button>
            </div>
          </>
        ) : null}
        {step === "code" ? (
          <>
            <p className="gmail-confirm__hint">
              Open Telegram on your phone and enter the login code.
            </p>
            <label className="gmail-confirm__field">
              <span>Code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="12345"
                autoComplete="one-time-code"
                autoFocus
              />
            </label>
            {error ? <p className="gmail-confirm__error">{error}</p> : null}
            <div className="gmail-confirm__actions">
              <button type="button" className="gmail-confirm__cancel" onClick={closeWizard}>
                Cancel
              </button>
              <button
                type="button"
                className="gmail-confirm__send"
                disabled={loading || !code.trim()}
                onClick={() => void finishIfConnected(() => submitCode(code)).catch(() => undefined)}
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                {loading ? "Checking…" : "Continue"}
              </button>
            </div>
          </>
        ) : null}
        {step === "password" ? (
          <>
            <p className="gmail-confirm__hint">
              This account has two-step verification.
              {hint ? ` Hint: ${hint}` : ""}
            </p>
            <label className="gmail-confirm__field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </label>
            {error ? <p className="gmail-confirm__error">{error}</p> : null}
            <div className="gmail-confirm__actions">
              <button type="button" className="gmail-confirm__cancel" onClick={closeWizard}>
                Cancel
              </button>
              <button
                type="button"
                className="gmail-confirm__send"
                disabled={loading || !password.trim()}
                onClick={() =>
                  void finishIfConnected(() => submitPassword(password)).catch(() => undefined)
                }
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                {loading ? "Signing in…" : "Connect"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
