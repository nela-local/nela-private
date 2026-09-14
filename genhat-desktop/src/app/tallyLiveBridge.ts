/**
 * Host bridge: artifact iframe postMessage → Api.tally* → response.
 */

import { Api } from "../api";
import {
  NELA_TALLY_REQUEST,
  NELA_TALLY_RESPONSE,
  type TallyLiveRequestMessage,
  type TallyLiveResponseMessage,
  type TallyLiveRequestKind,
} from "./tallyLiveDashboard";

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
    default:
      throw new Error(`Unknown Tally live kind: ${kind}`);
  }
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

  try {
    const status = await Api.tallyStatus();
    meta = {
      host: status.host ?? null,
      port: status.port ?? null,
      company: status.company ?? null,
      connected: Boolean(status.connected),
    };

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

/** Attach a window message listener that bridges Tally live requests to a target iframe. */
export function attachTallyLiveBridge(
  getTargetWindow: () => Window | null | undefined
): () => void {
  const onMessage = (ev: MessageEvent) => {
    void (async () => {
      const response = await handleTallyLiveRequest(ev.data);
      if (!response) return;
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
