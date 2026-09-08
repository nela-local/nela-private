import { create } from "zustand";

export type DriveAccessKind = "search" | "list_recent" | "get";

export type DriveAccessRequest = {
  kind: DriveAccessKind;
  purpose: string;
  query?: string | null;
  maxResults?: number;
  fileId?: string | null;
  fileNameHint?: string | null;
};

export type DriveAccessConfirmResult =
  | { confirmed: true; request: DriveAccessRequest }
  | { confirmed: false; reason: "user_cancelled" };

type PendingConfirm = {
  requestId: string;
  request: DriveAccessRequest;
};

interface DriveAccessConfirmState {
  pending: PendingConfirm | null;
}

let confirmResolve: ((value: DriveAccessConfirmResult) => void) | null = null;
let requestCounter = 0;

export const resolveDriveAccessConfirm = (value: DriveAccessConfirmResult) => {
  const resolver = confirmResolve;
  confirmResolve = null;
  useDriveAccessConfirmStore.setState({ pending: null });
  resolver?.(value);
};

export const cancelDriveAccessConfirm = () => {
  if (!confirmResolve && !useDriveAccessConfirmStore.getState().pending) return;
  resolveDriveAccessConfirm({ confirmed: false, reason: "user_cancelled" });
};

export const openDriveAccessConfirm = (
  request: DriveAccessRequest
): Promise<DriveAccessConfirmResult> => {
  if (confirmResolve) {
    const prev = confirmResolve;
    confirmResolve = null;
    prev({ confirmed: false, reason: "user_cancelled" });
  }

  requestCounter += 1;
  const requestId = `drive-access-${requestCounter}`;

  return new Promise<DriveAccessConfirmResult>((resolve) => {
    confirmResolve = resolve;
    useDriveAccessConfirmStore.setState({
      pending: { requestId, request },
    });
  });
};

export const useDriveAccessConfirmStore = create<DriveAccessConfirmState>(() => ({
  pending: null,
}));
