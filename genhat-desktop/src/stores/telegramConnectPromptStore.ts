import { create } from "zustand";

interface TelegramConnectPromptState {
  visible: boolean;
  show: () => void;
  hide: () => void;
}

export const useTelegramConnectPromptStore = create<TelegramConnectPromptState>((set) => ({
  visible: false,
  show: () => set({ visible: true }),
  hide: () => set({ visible: false }),
}));
