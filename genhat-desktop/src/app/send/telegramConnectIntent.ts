/** Detect a user turn that wants to send or read Telegram. */

const TELEGRAM_REQUEST =
  /(?:\btelegram\b|\btg\b|\bsend\b[\s\S]{0,40}\b(?:telegram|tg)\b|\bmessage\b[\s\S]{0,24}\bon\s+telegram\b|\btext\b[\s\S]{0,24}\bon\s+telegram\b)/i;

export function looksLikeTelegramRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return TELEGRAM_REQUEST.test(trimmed);
}
