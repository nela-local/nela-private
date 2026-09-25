/**
 * Former regex heuristics for “looks like email” were removed — they false-positive
 * on any mention of the word “email” (e.g. signup / temp-mail prompts) and forced
 * the Gmail connect card + gmail_* tools.
 *
 * Gmail tools are still available when the user has Gmail connected and the model
 * chooses gmail_send / gmail_read; we no longer auto-detect intent from text.
 */

export function looksLikeEmailRequest(_text: string): boolean {
  return false;
}

export function looksLikeEmailReadRequest(_text: string): boolean {
  return false;
}
