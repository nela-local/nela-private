import { create } from "zustand";

export type TallyAccessKind =
  | "list_ledgers"
  | "trial_balance"
  | "daybook"
  | "outstanding"
  | "live_dashboard"
  | "export_excel";

export type TallyAccessRequest = {
  kind: TallyAccessKind;
  purpose: string;
  group?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  voucherType?: string | null;
  maxRows?: number;
};

export type TallyAccessConfirmResult =
  | { confirmed: true; request: TallyAccessRequest; remember?: boolean }
  | { confirmed: false; reason: "user_cancelled" };

type PendingConfirm = {
  requestId: string;
  request: TallyAccessRequest;
};

interface TallyAccessConfirmState {
  pending: PendingConfirm | null;
  /** When true, skip further Tally export confirms until disconnect / clear. */
  sessionTrusted: boolean;
}

let confirmResolve: ((value: TallyAccessConfirmResult) => void) | null = null;
let requestCounter = 0;

export const resolveTallyAccessConfirm = (value: TallyAccessConfirmResult) => {
  const resolver = confirmResolve;
  confirmResolve = null;
  // Live dashboard always grants session trust so Refresh works without re-prompting.
  const grantSession =
    value.confirmed &&
    (value.remember || value.request.kind === "live_dashboard");
  if (grantSession) {
    useTallyAccessConfirmStore.setState({ pending: null, sessionTrusted: true });
  } else {
    useTallyAccessConfirmStore.setState({ pending: null });
  }
  resolver?.(value);
};

export const cancelTallyAccessConfirm = () => {
  if (!confirmResolve && !useTallyAccessConfirmStore.getState().pending) return;
  resolveTallyAccessConfirm({ confirmed: false, reason: "user_cancelled" });
};

export const clearTallySessionTrust = () => {
  useTallyAccessConfirmStore.setState({ sessionTrusted: false });
};

/** Mark this app session as trusted for Tally read tools (live dashboard path). */
export const grantTallySessionTrust = () => {
  useTallyAccessConfirmStore.setState({ sessionTrusted: true });
};

export const isTallySessionTrusted = () =>
  useTallyAccessConfirmStore.getState().sessionTrusted;

export const openTallyAccessConfirm = (
  request: TallyAccessRequest
): Promise<TallyAccessConfirmResult> => {
  if (useTallyAccessConfirmStore.getState().sessionTrusted) {
    return Promise.resolve({ confirmed: true, request, remember: true });
  }
  cancelTallyAccessConfirm();
  const requestId = `tally-${++requestCounter}`;
  return new Promise<TallyAccessConfirmResult>((resolve) => {
    confirmResolve = resolve;
    useTallyAccessConfirmStore.setState({
      pending: { requestId, request },
    });
  });
};

export const useTallyAccessConfirmStore = create<TallyAccessConfirmState>(() => ({
  pending: null,
  sessionTrusted: false,
}));
