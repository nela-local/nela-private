/**
 * Keep in-flight chat generations alive across workspace switches.
 * Sessions are parked (with their originating workspace id); updates route here
 * when the live session store no longer holds that chat; completion persists
 * back into that workspace's frontend_state.json.
 */

import { Api } from "../api";
import type { ChatSession } from "../types";
import { sessionForPersistence } from "./sessionUtils";

type ParkedGeneration = {
  workspaceId: string;
  session: ChatSession;
  /** Debounce disk writes while tokens still stream. */
  persistTimer: ReturnType<typeof setTimeout> | null;
};

const park = new Map<string, ParkedGeneration>();

function cloneSession(session: ChatSession): ChatSession {
  return structuredClone(session);
}

/** Snapshot a generating session before the live store is cleared. */
export function parkGeneratingSession(
  workspaceId: string,
  session: ChatSession
): void {
  const ws = workspaceId.trim();
  if (!ws) return;
  const existing = park.get(session.id);
  if (existing?.persistTimer) clearTimeout(existing.persistTimer);
  park.set(session.id, {
    workspaceId: ws,
    session: cloneSession(session),
    persistTimer: null,
  });
}

export function isParkedSession(sessionId: string): boolean {
  return park.has(sessionId);
}

export function getParkedWorkspaceId(sessionId: string): string | null {
  return park.get(sessionId)?.workspaceId ?? null;
}

/** Apply a patch to a parked session. Returns true if the session was parked. */
export function patchParkedSession(
  sessionId: string,
  patch: Partial<ChatSession> | ((session: ChatSession) => Partial<ChatSession>)
): boolean {
  const entry = park.get(sessionId);
  if (!entry) return false;

  const nextPatch = typeof patch === "function" ? patch(entry.session) : patch;
  entry.session = { ...entry.session, ...nextPatch };

  const finished = entry.session.loading === false;
  if (entry.persistTimer) clearTimeout(entry.persistTimer);
  entry.persistTimer = setTimeout(
    () => {
      entry.persistTimer = null;
      void persistParkedSession(sessionId, finished);
    },
    finished ? 0 : 800
  );

  return true;
}

/** Merge parked sessions for a workspace into a freshly loaded session list. */
export function mergeParkedIntoSessions(
  workspaceId: string,
  sessions: ChatSession[]
): ChatSession[] {
  const ws = workspaceId.trim();
  if (!ws) return sessions;

  const byId = new Map(sessions.map((s) => [s.id, s]));
  for (const entry of park.values()) {
    if (entry.workspaceId !== ws) continue;
    byId.set(entry.session.id, cloneSession(entry.session));
  }
  return Array.from(byId.values());
}

/** Drop park entries that belong to a workspace (e.g. after successful merge). */
export function releaseParkedForWorkspace(workspaceId: string): void {
  const ws = workspaceId.trim();
  for (const [sid, entry] of park.entries()) {
    if (entry.workspaceId !== ws) continue;
    if (entry.persistTimer) clearTimeout(entry.persistTimer);
    park.delete(sid);
  }
}

async function persistParkedSession(
  sessionId: string,
  removeIfFinished: boolean
): Promise<void> {
  const entry = park.get(sessionId);
  if (!entry) return;

  const workspaceId = entry.workspaceId;
  try {
    const raw = await Api.getWorkspaceFrontendState(workspaceId);
    let parsed: {
      sessions?: ChatSession[];
      activeSessionId?: string;
      openSessionIds?: string[];
      mindmapsBySession?: Record<string, unknown>;
      selectedModel?: string;
      selectedTtsEngine?: string;
      selectedVisionModel?: string;
    } = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        parsed = {};
      }
    }

    const sessions = Array.isArray(parsed.sessions) ? [...parsed.sessions] : [];
    const idx = sessions.findIndex((s) => s?.id === sessionId);
    const persisted = sessionForPersistence(entry.session);
    if (idx >= 0) sessions[idx] = persisted as ChatSession;
    else sessions.push(persisted as ChatSession);

    const activeSessionId =
      parsed.activeSessionId && sessions.some((s) => s?.id === parsed.activeSessionId)
        ? parsed.activeSessionId
        : sessions[0]?.id ?? sessionId;
    const openSessionIds = Array.isArray(parsed.openSessionIds)
      ? parsed.openSessionIds.filter((id) => sessions.some((s) => s?.id === id))
      : [];
    if (!openSessionIds.includes(sessionId)) openSessionIds.push(sessionId);

    await Api.saveWorkspaceFrontendState(
      workspaceId,
      JSON.stringify({
        ...parsed,
        sessions,
        activeSessionId,
        openSessionIds: openSessionIds.length > 0 ? openSessionIds : [sessionId],
      })
    );
  } catch (err) {
    console.warn("Failed to persist background generation:", err);
    return;
  }

  if (removeIfFinished && !entry.session.loading) {
    if (entry.persistTimer) clearTimeout(entry.persistTimer);
    park.delete(sessionId);
  }
}
