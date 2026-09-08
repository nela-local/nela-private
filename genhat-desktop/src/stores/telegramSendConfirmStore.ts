import { create } from "zustand";

export type TelegramDraft = {
  to: string;
  body: string;
};

export type TelegramSendConfirmResult =
  | { confirmed: true; draft: TelegramDraft }
  | { confirmed: false; reason: "user_cancelled" };

type PendingConfirm = {
  requestId: string;
  draft: TelegramDraft;
};

interface TelegramSendConfirmState {
  pending: PendingConfirm | null;
}

let confirmResolve: ((value: TelegramSendConfirmResult) => void) | null = null;
let requestCounter = 0;

export const resolveTelegramSendConfirm = (value: TelegramSendConfirmResult) => {
  const resolver = confirmResolve;
  confirmResolve = null;
  useTelegramSendConfirmStore.setState({ pending: null });
  resolver?.(value);
};

export const cancelTelegramSendConfirm = () => {
  if (!confirmResolve && !useTelegramSendConfirmStore.getState().pending) return;
  resolveTelegramSendConfirm({ confirmed: false, reason: "user_cancelled" });
};

export const openTelegramSendConfirm = (
  draft: TelegramDraft
): Promise<TelegramSendConfirmResult> => {
  if (confirmResolve) {
    const prev = confirmResolve;
    confirmResolve = null;
    prev({ confirmed: false, reason: "user_cancelled" });
  }

  requestCounter += 1;
  const requestId = `telegram-send-${requestCounter}`;

  return new Promise<TelegramSendConfirmResult>((resolve) => {
    confirmResolve = resolve;
    useTelegramSendConfirmStore.setState({
      pending: { requestId, draft },
    });
  });
};

export const useTelegramSendConfirmStore = create<TelegramSendConfirmState>(() => ({
  pending: null,
}));
