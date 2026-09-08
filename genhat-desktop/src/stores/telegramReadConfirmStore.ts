import { create } from "zustand";

export type TelegramReadRequest = {
  purpose: string;
  maxResults: number;
};

export type TelegramReadConfirmResult =
  | { confirmed: true; request: TelegramReadRequest }
  | { confirmed: false; reason: "user_cancelled" };

type PendingConfirm = {
  requestId: string;
  request: TelegramReadRequest;
};

interface TelegramReadConfirmState {
  pending: PendingConfirm | null;
}

let confirmResolve: ((value: TelegramReadConfirmResult) => void) | null = null;
let requestCounter = 0;

export const resolveTelegramReadConfirm = (value: TelegramReadConfirmResult) => {
  const resolver = confirmResolve;
  confirmResolve = null;
  useTelegramReadConfirmStore.setState({ pending: null });
  resolver?.(value);
};

export const cancelTelegramReadConfirm = () => {
  if (!confirmResolve && !useTelegramReadConfirmStore.getState().pending) return;
  resolveTelegramReadConfirm({ confirmed: false, reason: "user_cancelled" });
};

export const openTelegramReadConfirm = (
  request: TelegramReadRequest
): Promise<TelegramReadConfirmResult> => {
  if (confirmResolve) {
    const prev = confirmResolve;
    confirmResolve = null;
    prev({ confirmed: false, reason: "user_cancelled" });
  }

  requestCounter += 1;
  const requestId = `telegram-read-${requestCounter}`;

  return new Promise<TelegramReadConfirmResult>((resolve) => {
    confirmResolve = resolve;
    useTelegramReadConfirmStore.setState({
      pending: { requestId, request },
    });
  });
};

export const useTelegramReadConfirmStore = create<TelegramReadConfirmState>(() => ({
  pending: null,
}));
