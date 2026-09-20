import { Calculator, X } from "lucide-react";
import {
  resolveTallyAccessConfirm,
  useTallyAccessConfirmStore,
} from "../stores/tallyAccessConfirmStore";
import "./GmailSendConfirmCard.css";

export default function TallyAccessConfirmCard() {
  const pending = useTallyAccessConfirmStore((s) => s.pending);
  if (!pending) return null;

  const { request } = pending;
  const confirmOnce = () => {
    resolveTallyAccessConfirm({ confirmed: true, request });
  };
  const confirmForever = () => {
    resolveTallyAccessConfirm({ confirmed: true, request, remember: true });
  };
  const cancel = () => {
    resolveTallyAccessConfirm({ confirmed: false, reason: "user_cancelled" });
  };

  const kindLabel =
    request.kind === "list_ledgers"
      ? "List ledgers"
      : request.kind === "trial_balance"
        ? "Trial balance"
        : request.kind === "daybook"
          ? "Day book"
          : request.kind === "sales"
            ? "Sales"
            : request.kind === "cash_bank"
              ? "Cash & bank"
              : request.kind === "live_dashboard"
                ? "Live dashboard (ongoing refresh)"
                : request.kind === "export_excel"
                  ? "Excel export"
                  : "Outstanding (debtors/creditors)";

  const details: string[] = [];
  if (request.group) details.push(`Group: ${request.group}`);
  if (request.fromDate || request.toDate) {
    details.push(
      `Dates: ${request.fromDate ?? "…"} → ${request.toDate ?? "…"}`
    );
  }
  if (request.voucherType) details.push(`Voucher type: ${request.voucherType}`);
  if (request.maxRows) details.push(`Up to ${request.maxRows} rows`);

  return (
    <div className="gmail-confirm" role="dialog" aria-label="Allow Tally read">
      <div className="gmail-confirm__header">
        <div className="gmail-confirm__title">
          <Calculator size={16} />
          <strong>Allow Tally read?</strong>
        </div>
        <button
          type="button"
          className="gmail-confirm__icon-btn"
          onClick={cancel}
          aria-label="Cancel Tally access"
        >
          <X size={16} />
        </button>
      </div>
      <p className="gmail-confirm__hint">
        {request.purpose}. NELA will only <strong>export</strong> data from your
        local Tally HTTP server — nothing is written back to Tally.
        {request.kind === "live_dashboard"
          ? " Allowing this enables Refresh on the live dashboard until you disconnect Tally."
          : ""}
      </p>
      <p className="gmail-confirm__hint" style={{ marginTop: 0 }}>
        <strong>{kindLabel}</strong>
        {details.length ? ` · ${details.join(" · ")}` : ""}
      </p>
      <div className="gmail-confirm__actions">
        <button type="button" className="gmail-confirm__cancel" onClick={cancel}>
          Deny
        </button>
        <button type="button" className="gmail-confirm__cancel" onClick={confirmOnce}>
          Allow once
        </button>
        <button
          type="button"
          className="gmail-confirm__send"
          onClick={confirmForever}
          title="Skip confirmations for Tally exports until you disconnect"
        >
          Allow for session
        </button>
      </div>
    </div>
  );
}
