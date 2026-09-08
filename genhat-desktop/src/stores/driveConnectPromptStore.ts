import { create } from "zustand";

interface DriveConnectPromptState {
  visible: boolean;
  show: () => void;
  hide: () => void;
}

export const useDriveConnectPromptStore = create<DriveConnectPromptState>((set) => ({
  visible: false,
  show: () => set({ visible: true }),
  hide: () => set({ visible: false }),
}));
