import { create } from "zustand";
import { Api } from "../api";
import type { TelegramStatus } from "../types";
import { useTelegramConnectPromptStore } from "./telegramConnectPromptStore";

interface TelegramState {
  connected: boolean;
  username: string | null;
  loading: boolean;
  error: string | null;
  wizardOpen: boolean;
  wizardStep: "phone" | "code" | "password";
  passwordHint: string | null;
  refresh: () => Promise<TelegramStatus>;
  openWizard: () => void;
  closeWizard: () => void;
  start: (phone: string) => Promise<void>;
  submitCode: (code: string) => Promise<void>;
  submitPassword: (password: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

function errMessage(err: unknown, fallback: string): string {
  if (typeof err === "string" && err.trim()) return err.trim();
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return fallback;
}

function applyStatus(
  set: (partial: Partial<TelegramState>) => void,
  status: TelegramStatus
): TelegramStatus {
  const connected = Boolean(status.connected);
  set({
    connected,
    username: status.username?.trim() || status.phone?.trim() || null,
    loading: false,
    error: null,
  });
  if (connected) {
    useTelegramConnectPromptStore.getState().hide();
    set({ wizardOpen: false, wizardStep: "phone", passwordHint: null });
  }
  return status;
}

export const useTelegramStore = create<TelegramState>((set) => ({
  connected: false,
  username: null,
  loading: false,
  error: null,
  wizardOpen: false,
  wizardStep: "phone",
  passwordHint: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const status = await Api.telegramStatus();
      return applyStatus(set, status);
    } catch (err) {
      const message = errMessage(err, "Could not read Telegram status.");
      set({ loading: false, error: message });
      throw err;
    }
  },

  openWizard: () =>
    set({
      wizardOpen: true,
      wizardStep: "phone",
      passwordHint: null,
      error: null,
    }),

  closeWizard: () =>
    set({
      wizardOpen: false,
      wizardStep: "phone",
      passwordHint: null,
      loading: false,
      error: null,
    }),

  start: async (phone) => {
    set({ loading: true, error: null });
    try {
      const next = await Api.telegramConnectStart(phone);
      if (next.next === "connected") {
        applyStatus(set, {
          connected: true,
          username: next.username,
        });
        return;
      }
      set({
        loading: false,
        wizardStep: next.next === "password" ? "password" : "code",
        passwordHint: next.hint ?? null,
      });
    } catch (err) {
      set({
        loading: false,
        error: errMessage(err, "Could not start Telegram sign-in."),
      });
      throw err;
    }
  },

  submitCode: async (code) => {
    set({ loading: true, error: null });
    try {
      const next = await Api.telegramConnectCode(code);
      if (next.next === "connected") {
        applyStatus(set, {
          connected: true,
          username: next.username,
        });
        return;
      }
      set({
        loading: false,
        wizardStep: next.next === "password" ? "password" : "code",
        passwordHint: next.hint ?? null,
      });
    } catch (err) {
      set({
        loading: false,
        error: errMessage(err, "Could not verify the Telegram code."),
      });
      throw err;
    }
  },

  submitPassword: async (password) => {
    set({ loading: true, error: null });
    try {
      const next = await Api.telegramConnectPassword(password);
      applyStatus(set, {
        connected: next.next === "connected",
        username: next.username,
      });
    } catch (err) {
      set({
        loading: false,
        error: errMessage(err, "Could not verify the Telegram password."),
      });
      throw err;
    }
  },

  disconnect: async () => {
    set({ loading: true, error: null });
    try {
      await Api.telegramDisconnect();
      set({
        connected: false,
        username: null,
        loading: false,
        error: null,
        wizardOpen: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: errMessage(err, "Could not disconnect Telegram."),
      });
      throw err;
    }
  },
}));
