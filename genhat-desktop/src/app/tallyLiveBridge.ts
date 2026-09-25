/**
 * Host bridge: artifact iframe postMessage → Api.tally* → response.
 * Also caches successful live report payloads so offline can show last-seen data.
 */

import { Api } from "../api";
import {
  NELA_TALLY_REQUEST,
  NELA_TALLY_RESPONSE,
  type TallyLiveRequestMessage,
  type TallyLiveResponseMessage,
  type TallyLiveRequestKind,
  type TallyLiveFocus,
} from "./tallyLiveDashboard";
import {
  isTallyLiveSelectionMessage,
  setTallyLiveSelection,
} from "./tallyLiveSelection";
import { recordLiveTallyReportSuccess } from "./tallyDashboardSnapshotCache";

function isTallyLiveRequest(data: unknown): data is TallyLiveRequestMessage {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    d.type === NELA_TALLY_REQUEST &&
    typeof d.id === "string" &&
    typeof d.kind === "string"
  );
}

async function runKind(
  kind: TallyLiveRequestKind,
  req: TallyLiveRequestMessage
): Promise<unknown> {
  switch (kind) {
    case "status": {
      const status = await Api.tallyStatus();
      return status;
    }
    case "daybook":
      return Api.tallyDaybook({
        fromDate: req.fromDate ?? null,
        toDate: req.toDate ?? null,
        maxRows: req.maxRows ?? 200,
      });
    case "trial_balance":
      return Api.tallyTrialBalance({
        fromDate: req.fromDate ?? null,
        toDate: req.toDate ?? null,
        maxRows: req.maxRows ?? 200,
      });
    case "outstanding":
      return Api.tallyOutstanding({ maxRows: req.maxRows ?? 100 });
    case "list_ledgers":
      return Api.tallyListLedgers({ maxRows: req.maxRows ?? 200 });
    case "sales":
      return Api.tallySales({
        fromDate: req.fromDate ?? null,
        toDate: req.toDate ?? null,
        maxRows: req.maxRows ?? 200,
      });
    case "cash_bank":
      return Api.tallyCashBank({
        fromDate: req.fromDate ?? null,
        toDate: req.toDate ?? null,
        maxRows: req.maxRows ?? 100,
      });
    default:
      throw new Error(`Unknown Tally live kind: ${kind}`);
  }
}

function isDisconnectError(
  connected: boolean | undefined,
  error: string | null | undefined
): boolean {
  if (connected === false) return true;
  const msg = (error || "").toLowerCase();
  return (
    msg.includes("not connected") ||
    msg.includes("tally is not connected") ||
    msg.includes("could not reach") ||
    msg.includes("timed out") ||
    msg.includes("connection refused") ||
    msg.includes("econnrefused")
  );
}

/**
 * Handle one nela-tally-request and return a response payload (caller posts it).
 */
export async function handleTallyLiveRequest(
  data: unknown
): Promise<TallyLiveResponseMessage | null> {
  if (!isTallyLiveRequest(data)) return null;

  const kind = data.kind as TallyLiveRequestKind;
  let meta: TallyLiveResponseMessage["meta"];

  // Remember the period the live preview is actually querying.
  const focusFromKind =
    kind === "daybook" || kind === "outstanding" || kind === "trial_balance"
      ? (kind as TallyLiveFocus)
      : undefined;
  if (data.fromDate != null || data.toDate != null || focusFromKind) {
    setTallyLiveSelection({
      fromDate: data.fromDate,
      toDate: data.toDate,
      focus: focusFromKind,
    });
  }

  try {
    const { hasTallyConnectorAccess } = await import("./tallyAccess");
    if (!hasTallyConnectorAccess()) {
      return {
        type: NELA_TALLY_RESPONSE,
        id: data.id,
        ok: false,
        kind,
        error:
          "Tally Connector is locked. Upgrade in Settings → Connections to enable live books.",
        meta: {
          host: null,
          port: null,
          company: null,
          connected: false,
        },
      };
    }

    const status = await Api.tallyStatus();
    meta = {
      host: status.host ?? null,
      port: status.port ?? null,
      company: status.company ?? null,
      connected: Boolean(status.connected),
    };
    if (status.company) {
      setTallyLiveSelection({ company: status.company });
    }

    if (kind === "status") {
      if (!status.connected) {
        return {
          type: NELA_TALLY_RESPONSE,
          id: data.id,
          ok: false,
          kind,
          error:
            "Tally is not connected in NELA. Open Settings → Connections → Connect Tally (HTTP on localhost).",
          meta,
        };
      }
      return {
        type: NELA_TALLY_RESPONSE,
        id: data.id,
        ok: true,
        kind,
        data: status,
        meta,
      };
    }

    if (!status.connected) {
      return {
        type: NELA_TALLY_RESPONSE,
        id: data.id,
        ok: false,
        kind,
        error:
          "Tally is not connected. Start TallyPrime with HTTP enabled, then Connect in NELA.",
        meta,
      };
    }

    // Live dashboard preview: read-only refreshes are auto-approved (no chat Allow card).
    const result = await runKind(kind, data);
    const failed =
      result &&
      typeof result === "object" &&
      "ok" in result &&
      (result as { ok?: boolean }).ok === false;

    if (failed) {
      const err =
        (result as { error?: string; reason?: string }).error ||
        (result as { reason?: string }).reason ||
        "Tally export failed.";
      return {
        type: NELA_TALLY_RESPONSE,
        id: data.id,
        ok: false,
        kind,
        error: err,
        meta,
      };
    }

    return {
      type: NELA_TALLY_RESPONSE,
      id: data.id,
      ok: true,
      kind,
      data: result,
      meta,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      type: NELA_TALLY_RESPONSE,
      id: data.id,
      ok: false,
      kind,
      error: message || "Tally request failed.",
      meta,
    };
  }
}

export type TallyLiveBridgeOptions = {
  /** Live dashboard artifact path — used to cache last-shown report data. */
  artifactPath?: string | null;
  /** Live shell HTML (for title / default dates when building the snapshot). */
  liveHtml?: string | null;
  /** Fired when Tally is unreachable / disconnected (after a failed live request). */
  onDisconnected?: (info: { error?: string | null }) => void;
  /** Fired after a static snapshot was written from live report data. */
  onSnapshotCached?: (staticHtml: string) => void;
};

/** Attach a window message listener that bridges Tally live requests to a target iframe. */
export function attachTallyLiveBridge(
  getTargetWindow: () => Window | null | undefined,
  options?: TallyLiveBridgeOptions
): () => void {
  let disconnectNotified = false;

  const notifyDisconnected = (error?: string | null) => {
    if (disconnectNotified) return;
    disconnectNotified = true;
    options?.onDisconnected?.({ error });
  };

  const onMessage = (ev: MessageEvent) => {
    if (isTallyLiveSelectionMessage(ev.data)) {
      setTallyLiveSelection({
        fromDate: ev.data.fromDate,
        toDate: ev.data.toDate,
        focus: ev.data.focus,
        company: ev.data.company,
      });
      return;
    }
    void (async () => {
      const response = await handleTallyLiveRequest(ev.data);
      if (!response) return;

      const path = options?.artifactPath?.trim();
      if (
        path &&
        response.ok &&
        (response.kind === "daybook" ||
          response.kind === "outstanding" ||
          response.kind === "trial_balance")
      ) {
        disconnectNotified = false;
        const focus =
          response.kind === "daybook" ||
          response.kind === "outstanding" ||
          response.kind === "trial_balance"
            ? response.kind
            : undefined;
        const req = isTallyLiveRequest(ev.data) ? ev.data : null;
        void recordLiveTallyReportSuccess({
          artifactPath: path,
          liveHtml: options?.liveHtml,
          kind: response.kind,
          data: response.data,
          meta: response.meta,
          fromDate: req?.fromDate,
          toDate: req?.toDate,
          focus,
        }).then((html) => {
          if (html) options?.onSnapshotCached?.(html);
        });
      }

      if (
        !response.ok &&
        isDisconnectError(response.meta?.connected, response.error)
      ) {
        notifyDisconnected(response.error);
      }

      try {
        const win = getTargetWindow();
        win?.postMessage(response, "*");
      } catch {
        /* iframe gone */
      }
    })();
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
