import { create } from "zustand";
import type { AppUpdateInfo } from "../app/appUpdateCheck";
import {
  checkForAppUpdate,
  checkForAppUpdatePrompt,
  dismissUpdateVersion,
  openAppUpdateDownload,
  snoozeUpdatePrompt,
} from "../app/appUpdateCheck";

type AppUpdateState = {
  open: boolean;
  checking: boolean;
  error: string | null;
  info: AppUpdateInfo | null;
  /** Manual check found already-latest. */
  upToDateMessage: string | null;
  setOpen: (open: boolean) => void;
  clearUpToDate: () => void;
  runStartupCheck: () => Promise<void>;
  runManualCheck: () => Promise<void>;
  downloadNow: () => Promise<void>;
  remindLater: () => void;
  dismissVersion: () => void;
};

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  open: false,
  checking: false,
  error: null,
  info: null,
  upToDateMessage: null,

  setOpen: (open) => set({ open }),

  clearUpToDate: () => set({ upToDateMessage: null }),

  runStartupCheck: async () => {
    try {
      const info = await checkForAppUpdatePrompt();
      if (info) set({ info, open: true, error: null });
    } catch (e) {
      console.warn("App update check skipped:", e);
    }
  },

  runManualCheck: async () => {
    set({ checking: true, error: null, upToDateMessage: null });
    try {
      const info = await checkForAppUpdate();
      if (info) {
        set({ info, open: true, checking: false });
      } else {
        const { getVersion } = await import("@tauri-apps/api/app");
        const current = await getVersion();
        set({
          checking: false,
          open: false,
          info: null,
          upToDateMessage: `You're on the latest version (${current}).`,
        });
      }
    } catch (e) {
      set({
        checking: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  downloadNow: async () => {
    const info = get().info;
    if (!info) return;
    await openAppUpdateDownload(info);
  },

  remindLater: () => {
    snoozeUpdatePrompt();
    set({ open: false });
  },

  dismissVersion: () => {
    const info = get().info;
    if (info) dismissUpdateVersion(info.latestVersion);
    set({ open: false });
  },
}));
