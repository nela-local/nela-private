import { create } from "zustand";
import { Api } from "../api";
import { friendlyErrorFromUnknown } from "../app/friendlyError";

type TallyStatus = {
  connected: boolean;
  host?: string | null;
  port?: number | null;
  company?: string | null;
  lastError?: string | null;
};

type TallyScanResult = {
  ok: boolean;
  host: string;
  ports: number[];
  scanned: number;
  error?: string | null;
};

type TallyStore = {
  connected: boolean;
  host: string;
  port: number;
  company: string;
  loading: boolean;
  scanning: boolean;
  error: string | null;
  wizardOpen: boolean;
  openWizard: () => void;
  closeWizard: () => void;
  refresh: () => Promise<void>;
  scanPorts: (host?: string) => Promise<TallyScanResult | null>;
  connect: (input: {
    host: string;
    port: number;
    company?: string;
  }) => Promise<boolean>;
  disconnect: () => Promise<void>;
};

export const useTallyStore = create<TallyStore>((set, get) => ({
  connected: false,
  host: "127.0.0.1",
  port: 9000,
  company: "",
  loading: false,
  scanning: false,
  error: null,
  wizardOpen: false,

  openWizard: () => set({ wizardOpen: true, error: null }),
  closeWizard: () => set({ wizardOpen: false }),

  scanPorts: async (host) => {
    set({ scanning: true, error: null });
    try {
      const result = (await Api.tallyScanPorts({
        host: host?.trim() || get().host || "127.0.0.1",
      })) as TallyScanResult;
      if (result.ok && result.ports.length > 0) {
        set({
          scanning: false,
          host: result.host || get().host,
          port: result.ports[0],
          error: null,
        });
      } else {
        set({
          scanning: false,
          error:
            result.error?.trim() ||
            `No Tally HTTP server found on ${result.scanned} common ports. Enter the port from TallyPrime settings.`,
        });
      }
      return result;
    } catch (e) {
      set({ scanning: false, error: friendlyErrorFromUnknown(e) });
      return null;
    }
  },

  refresh: async () => {
    try {
      const status = (await Api.tallyStatus()) as TallyStatus;
      set({
        connected: Boolean(status.connected),
        host: status.host?.trim() || get().host || "127.0.0.1",
        port: status.port ?? get().port ?? 9000,
        company: status.company ?? "",
        error: status.lastError ?? null,
      });
    } catch (e) {
      set({ connected: false, error: friendlyErrorFromUnknown(e) });
    }
  },

  connect: async (input) => {
    set({ loading: true, error: null });
    try {
      const status = (await Api.tallyConnect({
        host: input.host.trim() || "127.0.0.1",
        port: input.port || 9000,
        company: input.company?.trim() || null,
      })) as TallyStatus;
      set({
        connected: Boolean(status.connected),
        host: status.host ?? input.host,
        port: status.port ?? input.port,
        company: status.company ?? input.company ?? "",
        loading: false,
        error: status.lastError ?? null,
        wizardOpen: status.connected ? false : get().wizardOpen,
      });
      return Boolean(status.connected);
    } catch (e) {
      set({ loading: false, error: friendlyErrorFromUnknown(e) });
      return false;
    }
  },

  disconnect: async () => {
    set({ loading: true, error: null });
    try {
      await Api.tallyDisconnect();
      const { clearTallySessionTrust } = await import(
        "./tallyAccessConfirmStore"
      );
      clearTallySessionTrust();
      set({ connected: false, loading: false });
    } catch (e) {
      set({ loading: false, error: friendlyErrorFromUnknown(e) });
    }
  },
}));
