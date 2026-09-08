import { create } from "zustand";
import { Api, connectorsAccountConnect, connectorsAccountDisconnect } from "../api";
import type { DriveStatus } from "../types";
import { useDriveConnectPromptStore } from "./driveConnectPromptStore";

interface DriveState {
  connected: boolean;
  email: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<DriveStatus>;
  connect: () => Promise<DriveStatus>;
  disconnect: () => Promise<void>;
}

function errMessage(err: unknown, fallback: string): string {
  if (typeof err === "string" && err.trim()) return err.trim();
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return fallback;
}

function applyStatus(
  set: (partial: Partial<DriveState>) => void,
  status: DriveStatus
): DriveStatus {
  const connected = Boolean(status.connected);
  set({
    connected,
    email: status.email?.trim() || null,
    loading: false,
    error: null,
  });
  if (connected) useDriveConnectPromptStore.getState().hide();
  return status;
}

export const useDriveStore = create<DriveState>((set) => ({
  connected: false,
  email: null,
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const status = await Api.driveStatus();
      return applyStatus(set, status);
    } catch (err) {
      const message = errMessage(err, "Could not read Google Drive status.");
      set({ loading: false, error: message });
      throw err;
    }
  },

  connect: async () => {
    set({ loading: true, error: null });
    try {
      await connectorsAccountConnect("gdrive");
      const status = await Api.driveStatus();
      return applyStatus(set, status);
    } catch (err) {
      const message = errMessage(err, "Could not connect Google Drive.");
      set({ loading: false, error: message });
      throw err;
    }
  },

  disconnect: async () => {
    set({ loading: true, error: null });
    try {
      await connectorsAccountDisconnect("gdrive");
      set({ connected: false, email: null, loading: false, error: null });
    } catch (err) {
      const message = errMessage(err, "Could not disconnect Google Drive.");
      set({ loading: false, error: message });
      throw err;
    }
  },
}));
