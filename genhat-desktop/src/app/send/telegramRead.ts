/**
 * Host-side telegram_read: confirm in chat, then fetch chats or a thread.
 */

import { Api } from "../../api";
import {
  cancelTelegramReadConfirm,
  openTelegramReadConfirm,
} from "../../stores/telegramReadConfirmStore";
import type { TelegramReadResult } from "../../types";

const MAX_DIALOG_LIST = 10;
const DEFAULT_DIALOG_LIST = 5;
const MAX_HISTORY = 20;
const DEFAULT_HISTORY = 10;

export function parseTelegramReadArgs(args: Record<string, unknown>): {
  chat: string | null;
  maxResults: number;
  purpose: string;
} {
  const chatRaw = args.chat ?? args.to ?? args.name;
  const chat =
    typeof chatRaw === "string" && chatRaw.trim() ? chatRaw.trim() : null;

  const cap = chat ? MAX_HISTORY : MAX_DIALOG_LIST;
  const fallback = chat ? DEFAULT_HISTORY : DEFAULT_DIALOG_LIST;
  const rawMax = args.max_results ?? args.maxResults;
  let maxResults = fallback;
  if (typeof rawMax === "number" && Number.isFinite(rawMax)) {
    maxResults = Math.max(1, Math.min(cap, Math.floor(rawMax)));
  } else if (typeof rawMax === "string" && rawMax.trim()) {
    const n = Number.parseInt(rawMax, 10);
    if (Number.isFinite(n)) maxResults = Math.max(1, Math.min(cap, n));
  }

  const purposeRaw = args.purpose;
  const purpose =
    typeof purposeRaw === "string" && purposeRaw.trim()
      ? purposeRaw.trim()
      : chat
        ? `Read recent messages with ${chat}`
        : maxResults === 1
          ? "Read your latest Telegram chat"
          : `Read your ${maxResults} most recent Telegram chats`;

  return { chat, maxResults, purpose };
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
      chat: parsed.chat,
    });
    if (!decision.confirmed) {
      options?.onStatus?.(null);
      return { ok: false, reason: "user_cancelled" };
    }

    options?.onStatus?.("Reading Telegram…");
    const result = await Api.telegramRead({
      chat: decision.request.chat ?? undefined,
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
