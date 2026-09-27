/**
 * Shared helpers for artifact preview / micro-edits.
 * Host-routed surgical chat edits were removed — keep only helpers still used
 * by generation preview and panel element-select paths.
 */

import type { ChatSession } from "../types";

/** Last assistant message with a live artifact path in this session. */
export function findSessionArtifactPath(session: ChatSession): string | null {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i];
    if (msg.role === "assistant" && msg.artifactPath && msg.artifactStage === "LivePreview") {
      return msg.artifactPath;
    }
  }
  if (session.artifactPath && session.artifactStage === "LivePreview") {
    return session.artifactPath;
  }
  return null;
}

export function editedOutputName(originalPath: string): string {
  const base = originalPath.split(/[/\\]/).pop() ?? "artifact";
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const cleaned = stem.replace(/[^a-zA-Z0-9._\- ]+/g, " ").trim().slice(0, 72);
  return cleaned ? `${cleaned}_edited` : "nela_artifact_edited";
}

/** NELA slide decks are HTML files with a recognizable deck shell. */
export function isNelaPresentationDeckHtml(content: string): boolean {
  return (
    content.includes("deck-container") &&
    content.includes("slide-stage") &&
    content.includes('class="slide')
  );
}
