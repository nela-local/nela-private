/**
 * Collect artifacts referenced by the current workspace's chat sessions.
 * Workspace scoping comes from sessionStore (loaded from frontend_state.json).
 */

import { useMemo } from "react";
import { looksLikePresentationTitle } from "./artifactDownload";
import type { ChatSession } from "../types";
import { useSessionStore } from "../stores/sessionStore";

export type ArtifactKind = "dashboard" | "presentation" | "spreadsheet" | "page";

export type WorkspaceArtifactItem = {
  key: string;
  path: string;
  title: string;
  kind: ArtifactKind;
  sessionId: string;
  /** User prompt that led to this artifact. */
  prompt: string;
  /** Best-effort sort key (message order ≈ recency within session). */
  sortIndex: number;
};

export function filenameTitle(path: string): string {
  const base = path.split(/[/\\]/).pop() || "Artifact";
  return (
    base
      .replace(/\.(html?|csv|xlsx?)$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Artifact"
  );
}

function precedingUserPrompt(
  messages: { role: string; content?: string }[],
  assistantIdx: number
): string {
  for (let i = assistantIdx - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role === "user") {
      const text = (m.content ?? "").replace(/\s+/g, " ").trim();
      return text || "No prompt";
    }
  }
  return "No prompt";
}

export function detectArtifactKind(path: string, title: string): ArtifactKind {
  const lowerPath = path.toLowerCase();
  const lowerTitle = title.toLowerCase();
  if (/\.(csv|xlsx?)$/i.test(lowerPath)) return "spreadsheet";
  if (looksLikePresentationTitle(title, path)) return "presentation";
  if (
    /tally|day[\s_-]?book|dashboard|live\s+dashboard|trial\s+balance|outstanding/i.test(
      `${lowerTitle} ${lowerPath}`
    )
  ) {
    return "dashboard";
  }
  return "page";
}

export function artifactKindLabel(kind: ArtifactKind): string {
  switch (kind) {
    case "dashboard":
      return "Dashboard";
    case "presentation":
      return "Presentation";
    case "spreadsheet":
      return "Spreadsheet";
    default:
      return "Page";
  }
}

/** True for HTML dashboards / pages shown in the main Dashboard gallery. */
export function isGalleryDashboardArtifact(item: WorkspaceArtifactItem): boolean {
  if (item.kind === "spreadsheet" || item.kind === "presentation") return false;
  if (/\.(csv|xlsx?)$/i.test(item.path)) return false;
  // Sidecar caches are not separate gallery entries.
  if (/\.snapshot\.html?$/i.test(item.path)) return false;
  // Prefer HTML; unknown extensions that were classified as dashboard/page still qualify.
  if (/\.html?$/i.test(item.path)) return true;
  return item.kind === "dashboard" || item.kind === "page";
}

/** Walk sessions and return unique artifacts (newest first). */
export function collectWorkspaceArtifacts(
  sessions: ChatSession[]
): WorkspaceArtifactItem[] {
  const byPath = new Map<string, WorkspaceArtifactItem>();
  let globalIndex = 0;

  for (const session of sessions) {
    const push = (
      path: string | null | undefined,
      titleHint: string | null | undefined,
      prompt: string
    ) => {
      const trimmed = path?.trim();
      if (!trimmed) return;
      const title = (titleHint && titleHint.trim()) || filenameTitle(trimmed);
      const kind = detectArtifactKind(trimmed, title);
      const existing = byPath.get(trimmed);
      const item: WorkspaceArtifactItem = {
        key: trimmed,
        path: trimmed,
        title,
        kind,
        sessionId: session.id,
        prompt,
        sortIndex: globalIndex++,
      };
      // Prefer a later occurrence (newer message / session-level update).
      if (!existing || item.sortIndex >= existing.sortIndex) {
        byPath.set(trimmed, item);
      }
    };

    for (let i = 0; i < session.messages.length; i += 1) {
      const msg = session.messages[i]!;
      if (msg.role !== "assistant") continue;
      const prompt = precedingUserPrompt(session.messages, i);
      const refs =
        msg.artifacts && msg.artifacts.length > 0
          ? msg.artifacts
          : msg.artifactPath
            ? [{ path: msg.artifactPath, title: msg.artifactTitle }]
            : [];
      for (const ref of refs) {
        push(ref.path, ref.title || msg.artifactTitle, prompt);
      }
    }

    // Session-level path only if not already covered by a message.
    const sessionPath = session.artifactPath?.trim();
    if (sessionPath && !byPath.has(sessionPath)) {
      let prompt = "No prompt";
      for (let i = session.messages.length - 1; i >= 0; i -= 1) {
        const m = session.messages[i];
        if (m?.role === "user") {
          prompt =
            (m.content ?? "").replace(/\s+/g, " ").trim() || "No prompt";
          break;
        }
      }
      push(sessionPath, session.streamingArtifactTitle, prompt);
    }
  }

  return [...byPath.values()].sort((a, b) => b.sortIndex - a.sortIndex);
}

/** All artifacts in the active workspace (any kind). */
export function useWorkspaceArtifacts(): WorkspaceArtifactItem[] {
  const sessions = useSessionStore((s) => s.sessions);
  return useMemo(() => collectWorkspaceArtifacts(sessions), [sessions]);
}

/** HTML dashboards / pages for the main Dashboard gallery. */
export function useWorkspaceDashboards(): WorkspaceArtifactItem[] {
  const artifacts = useWorkspaceArtifacts();
  return useMemo(
    () => artifacts.filter(isGalleryDashboardArtifact),
    [artifacts]
  );
}

/**
 * Rename a dashboard/artifact display title across all workspace sessions
 * that reference this path (message titles + session streaming title).
 */
export function renameWorkspaceArtifact(
  path: string,
  newTitle: string
): boolean {
  const trimmed = newTitle.trim();
  if (!trimmed) return false;
  const target = path.trim();
  if (!target) return false;

  const { sessions, setSessions } = useSessionStore.getState();
  let anyChanged = false;

  const nextSessions = sessions.map((session) => {
    let sessionChanged = false;
    const messages = session.messages.map((msg) => {
      if (msg.role !== "assistant") return msg;
      let next = msg;
      const pathMatch = msg.artifactPath?.trim() === target;
      const arts = msg.artifacts;
      const artsMatch = arts?.some((a) => a.path?.trim() === target);

      if (!pathMatch && !artsMatch) return msg;

      sessionChanged = true;
      anyChanged = true;

      if (pathMatch) {
        next = { ...next, artifactTitle: trimmed };
      }
      if (artsMatch && arts) {
        next = {
          ...next,
          artifacts: arts.map((a) =>
            a.path?.trim() === target ? { ...a, title: trimmed } : a
          ),
        };
        if (pathMatch || arts[0]?.path?.trim() === target) {
          next = { ...next, artifactTitle: trimmed };
        }
      }
      return next;
    });

    let result = sessionChanged ? { ...session, messages } : session;
    if (session.artifactPath?.trim() === target) {
      anyChanged = true;
      result = {
        ...result,
        messages: sessionChanged ? messages : session.messages,
        streamingArtifactTitle: trimmed,
      };
    }
    return result;
  });

  if (anyChanged) {
    setSessions(nextSessions);
  }
  return anyChanged;
}
