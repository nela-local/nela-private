/**
 * Host-side telegram_read: confirm in chat, then fetch recent chats.
 */

import { Api } from "../../api";
import {
  cancelTelegramReadConfirm,
  openTelegramReadConfirm,
} from "../../stores/telegramReadConfirmStore";
import type { TelegramReadResult } from "../../types";

const MAX_RESULTS = 5;

export function parseTelegramReadArgs(args: Record<string, unknown>): {
  maxResults: number;
  purpose: string;
} {
  const rawMax = args.max_results ?? args.maxResults;
  let maxResults = 1;
  if (typeof rawMax === "number" && Number.isFinite(rawMax)) {
    maxResults = Math.max(1, Math.min(MAX_RESULTS, Math.floor(rawMax)));
  } else if (typeof rawMax === "string" && rawMax.trim()) {
    const n = Number.parseInt(rawMax, 10);
    if (Number.isFinite(n)) maxResults = Math.max(1, Math.min(MAX_RESULTS, n));
  }

  const purposeRaw = args.purpose;
  const purpose =
    typeof purposeRaw === "string" && purposeRaw.trim()
      ? purposeRaw.trim()
      : maxResults === 1
        ? "Read your latest Telegram chat"
        : `Read your ${maxResults} most recent Telegram chats`;

  return { maxResults, purpose };
}

export async function executeTelegramRead(
  args: Record<string, unknown>,
  options?: {
    signal?: AbortSignal;
    onStatus?: (message: string | null) => void;
  }
): Promise<TelegramReadResult> {
  const parsed = parseTelegramReadArgs(args);

  if (options?.signal?.aborted) {
    return { ok: false, reason: "user_cancelled" };
  }

  options?.onStatus?.("Waiting for you to allow Telegram read…");
  const onAbort = () => {
    cancelTelegramReadConfirm();
  };
  options?.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const decision = await openTelegramReadConfirm({
      purpose: parsed.purpose,
      maxResults: parsed.maxResults,
    });
    if (!decision.confirmed) {
      options?.onStatus?.(null);
      return { ok: false, reason: "user_cancelled" };
    }

    options?.onStatus?.("Reading Telegram…");
    const result = await Api.telegramRead({
      maxResults: decision.request.maxResults,
    });
    options?.onStatus?.(null);
    return result;
  } catch (err) {
    options?.onStatus?.(null);
    const message =
      typeof err === "string"
        ? err
        : err instanceof Error
          ? err.message
          : "Could not read Telegram.";
    return { ok: false, reason: message };
  } finally {
    options?.signal?.removeEventListener("abort", onAbort);
  }
}
