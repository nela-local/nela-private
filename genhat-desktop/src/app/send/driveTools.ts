/**
 * Host-side Google Drive tools: confirm in chat, then search / recent / get.
 */

import { Api } from "../../api";
import {
  cancelDriveAccessConfirm,
  openDriveAccessConfirm,
  type DriveAccessKind,
} from "../../stores/driveAccessConfirmStore";
import type { DriveGetResult, DriveListResult } from "../../types";

const MAX_RESULTS = 10;

function clampMax(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(1, Math.min(MAX_RESULTS, Math.floor(raw)));
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return Math.max(1, Math.min(MAX_RESULTS, n));
  }
  return fallback;
}

function purposeOf(args: Record<string, unknown>, fallback: string): string {
  const raw = args.purpose;
  return typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
}

async function withConfirm<T>(
  kind: DriveAccessKind,
  request: {
    purpose: string;
    query?: string | null;
    maxResults?: number;
    fileId?: string | null;
    fileNameHint?: string | null;
  },
  run: () => Promise<T>,
  options?: {
    signal?: AbortSignal;
    onStatus?: (message: string | null) => void;
    waitingLabel: string;
    runningLabel: string;
  }
): Promise<T | { ok: false; reason: string }> {
  if (options?.signal?.aborted) {
    return { ok: false, reason: "user_cancelled" };
  }

  options?.onStatus?.(options.waitingLabel);
  const onAbort = () => {
    cancelDriveAccessConfirm();
  };
  options?.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const decision = await openDriveAccessConfirm({
      kind,
      purpose: request.purpose,
      query: request.query ?? null,
      maxResults: request.maxResults,
      fileId: request.fileId ?? null,
      fileNameHint: request.fileNameHint ?? null,
    });
    if (!decision.confirmed) {
      options?.onStatus?.(null);
      return { ok: false, reason: "user_cancelled" };
    }

    options?.onStatus?.(options.runningLabel);
    const result = await run();
    options?.onStatus?.(null);
    return result;
  } catch (err) {
    options?.onStatus?.(null);
    const message =
      typeof err === "string"
        ? err
        : err instanceof Error
          ? err.message
          : "Google Drive request failed.";
    return { ok: false, reason: message };
  } finally {
    options?.signal?.removeEventListener("abort", onAbort);
  }
}

export async function executeDriveSearch(
  args: Record<string, unknown>,
  options?: {
    signal?: AbortSignal;
    onStatus?: (message: string | null) => void;
  }
): Promise<DriveListResult | { ok: false; reason: string }> {
  const queryRaw = args.query;
  const query =
    typeof queryRaw === "string" && queryRaw.trim() ? queryRaw.trim() : "";
  if (!query) {
    return { ok: false, reason: "query is required" };
  }
  const maxResults = clampMax(args.max_results ?? args.maxResults, 5);
  const purpose = purposeOf(args, `Search Drive for “${query}”`);

  return withConfirm(
    "search",
    { purpose, query, maxResults },
    () => Api.driveSearch({ query, maxResults }),
    {
      ...options,
      waitingLabel: "Waiting for you to allow Drive search…",
      runningLabel: "Searching Google Drive…",
    }
  );
}

export async function executeDriveListRecent(
  args: Record<string, unknown>,
  options?: {
    signal?: AbortSignal;
    onStatus?: (message: string | null) => void;
  }
): Promise<DriveListResult | { ok: false; reason: string }> {
  const maxResults = clampMax(args.max_results ?? args.maxResults, 5);
  const purpose = purposeOf(args, "List your recent Google Drive files");

  return withConfirm(
    "list_recent",
    { purpose, maxResults },
    () => Api.driveListRecent({ maxResults }),
    {
      ...options,
      waitingLabel: "Waiting for you to allow Drive access…",
      runningLabel: "Listing recent Drive files…",
    }
  );
}

export async function executeDriveGet(
  args: Record<string, unknown>,
  options?: {
    signal?: AbortSignal;
    onStatus?: (message: string | null) => void;
  }
): Promise<DriveGetResult | { ok: false; reason: string }> {
  const idRaw = args.file_id ?? args.fileId;
  const fileId = typeof idRaw === "string" && idRaw.trim() ? idRaw.trim() : "";
  if (!fileId) {
    return { ok: false, reason: "file_id is required" };
  }
  const nameHintRaw = args.file_name ?? args.fileName;
  const fileNameHint =
    typeof nameHintRaw === "string" && nameHintRaw.trim()
      ? nameHintRaw.trim()
      : null;
  const purpose = purposeOf(
    args,
    fileNameHint
      ? `Open / summarize “${fileNameHint}” from Drive`
      : "Open / summarize a Google Drive file"
  );

  return withConfirm(
    "get",
    { purpose, fileId, fileNameHint },
    () => Api.driveGet({ fileId }),
    {
      ...options,
      waitingLabel: "Waiting for you to allow Drive file access…",
      runningLabel: "Reading Google Drive file…",
    }
  );
}
