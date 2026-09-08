/** Detect a user turn that wants Google Drive (for the in-chat Connect card). */

const DRIVE_REQUEST =
  /(?:\bgoogle\s*drive\b|\b(?:my\s+)?drive\b|\bgdrive\b|\bdocs?\b[\s\S]{0,24}\b(?:drive|google)\b|\b(?:find|search|locate|open|share|link|summarize|read|fetch|show|list)\b[\s\S]{0,48}\b(?:drive|google\s*doc|spreadsheet|slides?)\b|\brecent\b[\s\S]{0,24}\b(?:drive|files?\s+on\s+drive)\b)/i;

export function looksLikeDriveRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return DRIVE_REQUEST.test(trimmed);
}
