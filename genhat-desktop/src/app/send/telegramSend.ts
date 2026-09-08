/**
 * Host-side telegram_send: parse tool args, confirm in chat, then send.
 */

import { Api } from "../../api";
import {
  cancelTelegramSendConfirm,
  openTelegramSendConfirm,
  type TelegramDraft,
} from "../../stores/telegramSendConfirmStore";
import type { TelegramSendResult } from "../../types";

const MAX_BODY_CHARS = 4096;

export function parseTelegramSendArgs(
  args: Record<string, unknown>
): TelegramDraft | { error: string } {
  const toRaw = args.to ?? args.chat ?? args.username;
  let to = "";
  if (typeof toRaw === "string") to = toRaw.trim();
  else if (Array.isArray(toRaw) && typeof toRaw[0] === "string") {
    to = toRaw[0].trim();
  }
  const bodyRaw = args.body ?? args.text ?? args.message;
  const body = typeof bodyRaw === "string" ? bodyRaw : "";

  if (!to) return { error: "telegram_send requires a chat in `to` (saved name or @username)." };
  if (!body.trim()) return { error: "telegram_send requires a message body." };
  if (body.length > MAX_BODY_CHARS) {
    return { error: "The Telegram message is too long." };
  }
  return { to, body };
}

export async function executeTelegramSend(
  args: Record<string, unknown>,
  options?: {
    signal?: AbortSignal;
    onStatus?: (message: string | null) => void;
  }
): Promise<TelegramSendResult> {
  const parsed = parseTelegramSendArgs(args);
  if ("error" in parsed) {
    return { sent: false, reason: parsed.error };
  }

  if (options?.signal?.aborted) {
    return { sent: false, reason: "user_cancelled" };
  }

  options?.onStatus?.("Waiting for you to confirm the Telegram message…");
  const onAbort = () => {
    cancelTelegramSendConfirm();
  };
  options?.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const decision = await openTelegramSendConfirm(parsed);
    if (!decision.confirmed) {
      options?.onStatus?.(null);
      return { sent: false, reason: "user_cancelled" };
    }

    options?.onStatus?.("Sending Telegram message…");
    const result = await Api.telegramSend({
      to: decision.draft.to,
      body: decision.draft.body,
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
          : "Could not send the Telegram message.";
    return { sent: false, reason: message };
  } finally {
    options?.signal?.removeEventListener("abort", onAbort);
  }
}
