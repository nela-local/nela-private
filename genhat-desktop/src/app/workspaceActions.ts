import { open, save } from "@tauri-apps/plugin-dialog";
import type { Dispatch, SetStateAction } from "react";
import { Api } from "../api";
import { releaseLlamaSlotsForWorkspaceExcept } from "./llamaSlotAffinity";
import { useArtifactStreamStore } from "../stores/artifactStreamStore";
import { useChatModeStore } from "../stores/chatModeStore";
import { abortControllers, useSessionStore } from "../stores/sessionStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { parkGeneratingSession } from "./backgroundGenerationPark";
import { cancelFollowUp } from "../stores/followUpStore";
import {
  cancelTallyAccessConfirm,
  clearTallySessionTrust,
} from "../stores/tallyAccessConfirmStore";
import { clearTallyLiveSelection } from "./tallyLiveSelection";
import { clearTallyLiveDrafts } from "./tallyDashboardSnapshotCache";
import { useTallyStore } from "../stores/tallyStore";
import { useConnectorStore } from "../stores/connectorStore";
import { cancelGmailReadConfirm } from "../stores/gmailReadConfirmStore";
import { cancelGmailSendConfirm } from "../stores/gmailSendConfirmStore";
import { useGmailConnectPromptStore } from "../stores/gmailConnectPromptStore";
import { cancelDriveAccessConfirm } from "../stores/driveAccessConfirmStore";
import { useDriveConnectPromptStore } from "../stores/driveConnectPromptStore";
import { cancelTelegramReadConfirm } from "../stores/telegramReadConfirmStore";
import { cancelTelegramSendConfirm } from "../stores/telegramSendConfirmStore";
import { useTelegramConnectPromptStore } from "../stores/telegramConnectPromptStore";
import type {
  ChatSession,
  IngestionStatus,
  MindMapGraph,
  WorkspaceRecord,
} from "../types";

type SetState<T> = Dispatch<SetStateAction<T>>;

interface LoadRagDocsContext {
  setRagDocs: SetState<IngestionStatus[]>;
}

export async function loadRagDocsAction({ setRagDocs }: LoadRagDocsContext): Promise<void> {
  try {
    const docs = await Api.listRagDocuments();
    setRagDocs((prev) => {
      const completedPaths = new Set(docs.map((d) => d.file_path));
      const remainingPlaceholders = prev.filter(
        (d) => d.doc_id < 0 && !completedPaths.has(d.file_path)
      );
      return [...remainingPlaceholders, ...docs];
    });
  } catch (e) {
    console.error("Failed to load RAG docs:", e);
  }
}

interface RefreshWorkspaceRegistryContext {
  setWorkspaces: SetState<WorkspaceRecord[]>;
  setActiveWorkspace: SetState<WorkspaceRecord | null>;
}

export async function refreshWorkspaceRegistryAction({
  setWorkspaces,
  setActiveWorkspace,
}: RefreshWorkspaceRegistryContext): Promise<void> {
  try {
    const [all, active] = await Promise.all([
      Api.listWorkspaces(),
      Api.getActiveWorkspace(),
    ]);
    setWorkspaces(all);
    setActiveWorkspace(active);
  } catch (err) {
    console.warn("Failed to refresh workspace registry:", err);
  }
}

export interface WorkspaceMutationContext {
  workspaceBusy: boolean;
  setWorkspaceBusy: SetState<boolean>;
  setSessionStoreReady: SetState<boolean>;
  setRagDocs: SetState<IngestionStatus[]>;
  setSessions: SetState<ChatSession[]>;
  setOpenSessionIds: SetState<string[]>;
  setActiveSessionId: SetState<string>;
  setMindmapsBySession: SetState<Record<string, MindMapGraph[]>>;
  setActiveMindmapOverlay: SetState<{
    sessionId: string;
    mindmapId: string | null;
    isGenerating?: boolean;
    query?: string;
  } | null>;
  setActiveWorkspace: SetState<WorkspaceRecord | null>;
  setWorkspaceScope: SetState<string | null>;
  setStartupContinueWorkspace: SetState<WorkspaceRecord | null>;
  refreshWorkspaceRegistry: () => Promise<void>;
  refreshWorkspaceListOnly: () => Promise<void>;
  loadRagDocs: () => Promise<void>;
}

function resetSessionState(ctx: WorkspaceMutationContext): void {
  // Park in-flight generations so they finish in the background for the
  // workspace they started in — do not abort.
  const leavingWorkspaceId = useWorkspaceStore.getState().activeWorkspace?.id;
  const liveSessions = useSessionStore.getState().sessions;
  if (leavingWorkspaceId) {
    for (const session of liveSessions) {
      const ctrl = abortControllers.get(session.id);
      const stillRunning =
        session.loading || Boolean(ctrl && !ctrl.signal.aborted);
      if (stillRunning) {
        parkGeneratingSession(leavingWorkspaceId, session);
      }
    }
    releaseLlamaSlotsForWorkspaceExcept(
      leavingWorkspaceId,
      new Set(
        [...abortControllers.entries()]
          .filter(([, ctrl]) => !ctrl.signal.aborted)
          .map(([id]) => id)
      )
    );
  }

  ctx.setSessionStoreReady(false);
  ctx.setRagDocs([]);
  ctx.setSessions([]);
  ctx.setOpenSessionIds([]);
  ctx.setActiveSessionId("");
  ctx.setMindmapsBySession({});
  ctx.setActiveMindmapOverlay(null);
  useSessionStore.getState().setStreamingThinking("");

  // Composer / stream / confirm state must not spill into the next workspace.
  const chatMode = useChatModeStore.getState();
  chatMode.clearDirectDocuments();
  chatMode.clearImage();
  chatMode.setGeneralGenerating(false);
  chatMode.setTtsGenerating(false);
  useArtifactStreamStore.getState().clear();
  cancelFollowUp();
  cancelTallyAccessConfirm();
  clearTallySessionTrust();
  clearTallyLiveSelection();
  clearTallyLiveDrafts();
  // Drop in-memory Tally UI until the new workspace config is rebound + refreshed.
  useTallyStore.setState({
    connected: false,
    wizardOpen: false,
    error: null,
    loading: false,
    scanning: false,
  });
  cancelGmailReadConfirm();
  cancelGmailSendConfirm();
  useGmailConnectPromptStore.getState().hide();
  cancelDriveAccessConfirm();
  useDriveConnectPromptStore.getState().hide();
  cancelTelegramReadConfirm();
  cancelTelegramSendConfirm();
  useTelegramConnectPromptStore.getState().hide();
}

function hydrateWorkspaceScopedStores(): void {
  void useTallyStore.getState().refresh();
  void useConnectorStore.getState().refresh();
}

export async function switchWorkspaceByIdAction(
  workspaceId: string,
  ctx: WorkspaceMutationContext
): Promise<void> {
  if (ctx.workspaceBusy) return;
  try {
    ctx.setWorkspaceBusy(true);
    resetSessionState(ctx);
    const opened = await Api.openWorkspace(workspaceId);
    const scope = await Api.getWorkspaceScope();
    ctx.setActiveWorkspace(opened);
    ctx.setWorkspaceScope(scope || `workspace:${opened.id}`);
    await ctx.refreshWorkspaceRegistry();
    await ctx.loadRagDocs();
    hydrateWorkspaceScopedStores();
  } catch (err) {
    console.error("Failed to switch workspace:", err);
    ctx.setSessionStoreReady(true);
  } finally {
    ctx.setWorkspaceBusy(false);
  }
}

export async function createNewWorkspaceAction(
  ctx: WorkspaceMutationContext
): Promise<void> {
  if (ctx.workspaceBusy) return;
  try {
    ctx.setWorkspaceBusy(true);
    resetSessionState(ctx);
    const created = await Api.createWorkspace();
    const scope = await Api.getWorkspaceScope();
    ctx.setActiveWorkspace(created);
    ctx.setWorkspaceScope(scope || `workspace:${created.id}`);
    await ctx.refreshWorkspaceRegistry();
    await ctx.loadRagDocs();
    hydrateWorkspaceScopedStores();
  } catch (err) {
    console.error("Failed to create workspace:", err);
    ctx.setSessionStoreReady(true);
  } finally {
    ctx.setWorkspaceBusy(false);
  }
}

interface SaveWorkspaceBaseContext {
  workspaceBusy: boolean;
  activeSession: ChatSession | null;
  activeWorkspace: WorkspaceRecord | null;
  sessions: ChatSession[];
  activeSessionId: string;
  buildWorkspaceFrontendState: (safeActive: string) => string;
  setWorkspaceBusy: SetState<boolean>;
  setActiveWorkspace: SetState<WorkspaceRecord | null>;
  refreshWorkspaceRegistry: () => Promise<void>;
}

export async function saveWorkspaceAsFileAction(
  ctx: SaveWorkspaceBaseContext
): Promise<void> {
  if (ctx.workspaceBusy || !ctx.activeSession) return;
  try {
    ctx.setWorkspaceBusy(true);
    const path = await save({
      title: "Save NELA Workspace As",
      filters: [{ name: "NELA Workspace", extensions: ["nela"] }],
      defaultPath: `${ctx.activeWorkspace?.name ?? "workspace"}.nela`,
    });
    if (!path) return;

    const safeActive = ctx.sessions.some((s) => s.id === ctx.activeSessionId)
      ? ctx.activeSessionId
      : ctx.sessions[0]?.id ?? "";
    const frontendState = ctx.buildWorkspaceFrontendState(safeActive);
    const savedWorkspace = await Api.saveWorkspaceAsNela(path, frontendState);
    ctx.setActiveWorkspace(savedWorkspace);
    await ctx.refreshWorkspaceRegistry();
  } catch (err) {
    console.error("Failed to save workspace as .nela:", err);
  } finally {
    ctx.setWorkspaceBusy(false);
  }
}

export async function saveWorkspaceFileAction(
  ctx: SaveWorkspaceBaseContext & { saveWorkspaceAsFile: () => Promise<void> }
): Promise<void> {
  if (ctx.workspaceBusy || !ctx.activeWorkspace) return;
  try {
    if (!ctx.activeWorkspace.nela_path) {
      await ctx.saveWorkspaceAsFile();
      return;
    }

    ctx.setWorkspaceBusy(true);
    const safeActive = ctx.sessions.some((s) => s.id === ctx.activeSessionId)
      ? ctx.activeSessionId
      : ctx.sessions[0]?.id ?? "";
    const frontendState = ctx.buildWorkspaceFrontendState(safeActive);
    const savedWorkspace = await Api.saveWorkspaceNela(frontendState);
    ctx.setActiveWorkspace(savedWorkspace);
    await ctx.refreshWorkspaceRegistry();
  } catch (err) {
    console.error("Failed to save workspace .nela:", err);
  } finally {
    ctx.setWorkspaceBusy(false);
  }
}

export async function openWorkspaceFromFileAction(
  ctx: WorkspaceMutationContext
): Promise<void> {
  if (ctx.workspaceBusy) return;
  try {
    ctx.setWorkspaceBusy(true);
    resetSessionState(ctx);
    const selected = await open({
      title: "Open NELA Workspace",
      multiple: false,
      filters: [{ name: "NELA Workspace", extensions: ["nela"] }],
    });
    if (!selected || Array.isArray(selected)) return;

    const result = await Api.openWorkspaceNela(selected);
    const scope = await Api.getWorkspaceScope();
    ctx.setActiveWorkspace(result.workspace);
    ctx.setWorkspaceScope(scope || `workspace:${result.workspace.id}`);
    await ctx.refreshWorkspaceRegistry();
    await ctx.loadRagDocs();
    hydrateWorkspaceScopedStores();
  } catch (err) {
    console.error("Failed to open .nela workspace:", err);
    ctx.setSessionStoreReady(true);
  } finally {
    ctx.setWorkspaceBusy(false);
  }
}

interface RefreshListContext {
  setWorkspaces: SetState<WorkspaceRecord[]>;
}

export async function refreshWorkspaceListOnlyAction({
  setWorkspaces,
}: RefreshListContext): Promise<void> {
  try {
    const all = await Api.listWorkspaces();
    setWorkspaces(all);
  } catch (err) {
    console.warn("Failed to refresh workspace list:", err);
  }
}

interface RenameWorkspaceContext {
  workspaceBusy: boolean;
  activeWorkspace: WorkspaceRecord | null;
  setWorkspaceBusy: SetState<boolean>;
  refreshWorkspaceRegistry: () => Promise<void>;
  refreshWorkspaceListOnly: () => Promise<void>;
}

export async function renameWorkspaceByIdAction(
  workspaceId: string,
  newName: string,
  ctx: RenameWorkspaceContext
): Promise<void> {
  if (ctx.workspaceBusy) return;
  const trimmed = newName.trim();
  if (!trimmed) return;

  try {
    ctx.setWorkspaceBusy(true);
    await Api.renameWorkspace(workspaceId, trimmed);

    if (ctx.activeWorkspace) {
      await ctx.refreshWorkspaceRegistry();
    } else {
      await ctx.refreshWorkspaceListOnly();
    }
  } catch (err) {
    console.error("Failed to rename workspace:", err);
  } finally {
    ctx.setWorkspaceBusy(false);
  }
}

export async function deleteWorkspaceByIdAction(
  workspaceId: string,
  ctx: WorkspaceMutationContext
): Promise<void> {
  if (ctx.workspaceBusy) return;
  let deletingActive = false;

  try {
    const active = await Api.getActiveWorkspace().catch(() => null);
    deletingActive = active?.id === workspaceId;

    ctx.setWorkspaceBusy(true);
    const nextActiveFromBackend = await Api.deleteWorkspace(workspaceId);

    if (!deletingActive) {
      await ctx.refreshWorkspaceListOnly();
      return;
    }

    resetSessionState(ctx);

    if (nextActiveFromBackend) {
      const scope = await Api.getWorkspaceScope();
      ctx.setActiveWorkspace(nextActiveFromBackend);
      ctx.setWorkspaceScope(scope || `workspace:${nextActiveFromBackend.id}`);
      await ctx.refreshWorkspaceRegistry();
      await ctx.loadRagDocs();
      hydrateWorkspaceScopedStores();
    } else {
      ctx.setActiveWorkspace(null);
      ctx.setStartupContinueWorkspace(null);
      ctx.setWorkspaceScope("workspace:none");
      await ctx.refreshWorkspaceListOnly();
      ctx.setSessionStoreReady(true);
    }
  } catch (err) {
    console.error("Failed to delete workspace:", err);
    ctx.setSessionStoreReady(true);
  } finally {
    ctx.setWorkspaceBusy(false);
  }
}
