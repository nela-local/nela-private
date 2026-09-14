import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Calculator, Loader2, Radar, X } from "lucide-react";
import { useTallyStore } from "../stores/tallyStore";
import { useConnectorStore } from "../stores/connectorStore";
import "./GmailSendConfirmCard.css";
import "./TelegramConnectModal.css";

export default function TallyConnectModal() {
  const open = useTallyStore((s) => s.wizardOpen);
  const closeWizard = useTallyStore((s) => s.closeWizard);
  const connect = useTallyStore((s) => s.connect);
  const scanPorts = useTallyStore((s) => s.scanPorts);
  const loading = useTallyStore((s) => s.loading);
  const scanning = useTallyStore((s) => s.scanning);
  const error = useTallyStore((s) => s.error);
  const host0 = useTallyStore((s) => s.host);
  const port0 = useTallyStore((s) => s.port);
  const company0 = useTallyStore((s) => s.company);
  const refreshConnectors = useConnectorStore((s) => s.refresh);

  const [host, setHost] = useState(host0 || "127.0.0.1");
  const [port, setPort] = useState(String(port0 || 9000));
  const [company, setCompany] = useState(company0 || "");
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [foundPorts, setFoundPorts] = useState<number[]>([]);

  useEffect(() => {
    if (!open) return;
    setHost(host0 || "127.0.0.1");
    setPort(String(port0 || 9000));
    setCompany(company0 || "");
    setScanNote(null);
    setFoundPorts([]);
  }, [open, host0, port0, company0]);

  if (!open) return null;

  const busy = loading || scanning;

  const onScan = async () => {
    setScanNote(null);
    setFoundPorts([]);
    const result = await scanPorts(host.trim() || "127.0.0.1");
    if (!result) return;
    if (result.ok && result.ports.length > 0) {
      setHost(result.host || host);
      setPort(String(result.ports[0]));
      setFoundPorts(result.ports);
      setScanNote(
        result.ports.length === 1
          ? `Found Tally on port ${result.ports[0]}.`
          : `Found Tally on ports ${result.ports.join(", ")}. Using ${result.ports[0]}.`,
      );
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const portNum = Number.parseInt(port, 10);
    if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) return;
    const ok = await connect({
      host: host.trim() || "127.0.0.1",
      port: portNum,
      company: company.trim() || undefined,
    });
    if (ok) await refreshConnectors();
  };

  return createPortal(
    <div
      className="telegram-wizard"
      role="dialog"
      aria-modal="true"
      aria-label="Connect Tally"
      onClick={() => closeWizard()}
    >
      <div
        className="gmail-confirm telegram-wizard__card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gmail-confirm__header">
          <div className="gmail-confirm__title">
            <Calculator size={16} />
            <strong>Connect Tally</strong>
          </div>
          <button
            type="button"
            className="gmail-confirm__icon-btn"
            onClick={() => closeWizard()}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <p className="gmail-confirm__hint">
          Enable <strong>HTTP Server</strong> in TallyPrime (see below), load
          your company, then connect. Leave <strong>Company blank</strong> unless
          you paste the exact company name from Tally. Use{" "}
          <strong>Find port</strong> if not on <code>9000</code>. Read-only —
          NELA never writes vouchers.
        </p>
        <p className="gmail-confirm__hint" style={{ marginTop: 0 }}>
          Gateway: <strong>F1 → Settings → Connectivity / Advanced
          Configuration</strong> → set TallyPrime acts as <strong>Server</strong>{" "}
          or <strong>Both</strong>, port <code>9000</code>, enable HTTP/ODBC →
          Ctrl+A to save. Company must stay open in Tally.
        </p>
        <form onSubmit={(e) => void onSubmit(e)}>
          <label className="gmail-confirm__field">
            <span>Host</span>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="127.0.0.1"
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <label className="gmail-confirm__field">
            <span>Port</span>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
              <input
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="9000"
                inputMode="numeric"
                disabled={busy}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="gmail-confirm__cancel"
                onClick={() => void onScan()}
                disabled={busy}
                title="Scan common localhost ports for Tally HTTP"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  whiteSpace: "nowrap",
                }}
              >
                {scanning ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Radar size={14} />
                )}
                Find port
              </button>
            </div>
          </label>
          {foundPorts.length > 1 ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.35rem",
                margin: "-0.25rem 0 0.7rem",
              }}
            >
              {foundPorts.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="gmail-confirm__cancel"
                  style={{
                    padding: "0.25rem 0.55rem",
                    fontSize: "0.75rem",
                    opacity: String(p) === port ? 1 : 0.7,
                  }}
                  onClick={() => setPort(String(p))}
                  disabled={busy}
                >
                  {p}
                </button>
              ))}
            </div>
          ) : null}
          <label className="gmail-confirm__field">
            <span>Company (optional — leave blank)</span>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Exact Tally name, or blank = loaded company"
              autoComplete="off"
              disabled={busy}
            />
          </label>
          {scanNote ? (
            <p className="gmail-confirm__hint" style={{ marginTop: 0 }}>
              {scanNote}
            </p>
          ) : null}
          {error ? <p className="gmail-confirm__error">{error}</p> : null}
          <div className="gmail-confirm__actions">
            <button
              type="button"
              className="gmail-confirm__cancel"
              onClick={() => closeWizard()}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="gmail-confirm__send"
              disabled={busy}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              {loading ? "Connecting…" : "Test & connect"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
