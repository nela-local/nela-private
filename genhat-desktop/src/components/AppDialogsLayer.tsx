import { useEffect } from "react";
import { 
  refreshModels,
  handleDownloadModel,
  handleCancelDownload,
  handleUninstall,
  downloadMissingOptionalModels,
} from "../app/modelActions";
import { Api } from "../api";
import { buildFrontendDiagnosticsPayload } from "../app/clientErrorCapture";
import { useUIStore } from "../stores/uiStore";
import { useModelStore } from "../stores/modelStore";
import { useDownloadStore } from "../stores/downloadStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useAuthStore } from "../stores/authStore";
import { useCloudStore } from "../stores/cloudStore";
import { useSessionStore } from "../stores/sessionStore";
import AppModal from "./AppModal";
import HuggingFaceModal from "./HuggingFaceModal";
import ModelsSettingsModal from "./ModelsSettingsModal";
import StartupModal from "./StartupModal";
import ToursModal from "./ToursModal";
import ProfileModal from "./ProfileModal";
import OnboardingModal from "./OnboardingModal";
import CloudSettingsModal from "./CloudSettingsModal";
import PremiumUpgradeModal from "./PremiumUpgradeModal";
import RagSourcePickerModal from "./RagSourcePickerModal";
import FollowUpModal from "./FollowUpModal";
import DocGraphIndexModal from "./DocGraphIndexModal";
import DocGraphQueryModal from "./DocGraphQueryModal";
import FileIndexerSetupWizard from "./FileIndexerSetupWizard";
import ConnectorsModal from "./ConnectorsModal";
import TelegramConnectModal from "./TelegramConnectModal";
import TallyConnectModal from "./TallyConnectModal";
interface AppDialogsLayerProps {
  showStartupModal: boolean;
  showFileIndexerSetup: boolean;
  fileIndexerModelDir: string;
  onFileIndexerSetupComplete: () => void;
  onContinueWorkspace: () => void;
  canContinueWorkspace: boolean;
  continueWorkspaceName: string | null;
  onNewProject: () => void;
  onImportProject: () => void;
  onStartTour: () => void;
}

export default function AppDialogsLayer({
  showStartupModal,
  showFileIndexerSetup,
  fileIndexerModelDir,
  onFileIndexerSetupComplete,
  onContinueWorkspace,
  canContinueWorkspace,
  continueWorkspaceName,
  onNewProject,
  onImportProject,
  onStartTour,
}: AppDialogsLayerProps) {
  // Subscribe to stores
  const workspaceBusy = useWorkspaceStore(s => s.workspaceBusy);
  const activeWorkspace = useWorkspaceStore(s => s.activeWorkspace);
  
  const appModal = useUIStore(s => s.appModal);
  const handleModalConfirm = useUIStore(s => s.handleModalConfirm);
  const handleModalCancel = useUIStore(s => s.handleModalCancel);
  const settingsOpen = useUIStore(s => s.settingsOpen);
  const setSettingsOpen = useUIStore(s => s.setSettingsOpen);
  const hfModalOpen = useUIStore(s => s.hfModalOpen);
  const setHfModalOpen = useUIStore(s => s.setHfModalOpen);
  const hfModalPreset = useUIStore(s => s.hfModalPreset);
  const toursOpen = useUIStore(s => s.toursOpen);
  const setToursOpen = useUIStore(s => s.setToursOpen);
  const profileOpen = useUIStore(s => s.profileOpen);
  const setProfileOpen = useUIStore(s => s.setProfileOpen);
  const cloudSettingsOpen = useUIStore(s => s.cloudSettingsOpen);
  const setCloudSettingsOpen = useUIStore(s => s.setCloudSettingsOpen);
  const confirmAction = useUIStore(s => s.confirmAction);
  const showModal = useUIStore(s => s.showModal);
  const showError = useUIStore(s => s.showError);
  const hydrateAuth = useAuthStore(s => s.hydrate);
  const preferredMode = useCloudStore(s => s.preferredMode);
  const sessionCount = useSessionStore(s => s.sessions.length);

  useEffect(() => {
    void hydrateAuth();
  }, [hydrateAuth]);

  const exportSupportBundleFromModal = async () => {
    try {
      const payload = buildFrontendDiagnosticsPayload({
        preferred_mode: preferredMode,
        active_workspace_id: activeWorkspace?.id ?? null,
        open_session_count: sessionCount,
        from_error_modal: true,
        error_modal_title: appModal.title,
        error_modal_message: appModal.message,
      });
      const path = await Api.exportSupportBundle(payload);
      try {
        await Api.revealInExplorer(path);
      } catch {
        /* best-effort */
      }
      showModal(
        "info",
        "Support bundle ready",
        `Saved a sanitized diagnostics zip:\n\n${path}\n\nEmail it to genaihasteeth@gmail.com with a short description of what failed.`
      );
    } catch (err) {
      showError(
        err instanceof Error ? err.message : String(err),
        "Couldn't export support bundle"
      );
    }
  };
  
  const registeredModels = useModelStore(s => s.registeredModels);
  const modelCatalog = useModelStore(s => s.modelCatalog);
  
  const downloads = useDownloadStore(s => s.downloads);
  return (
    <>
      <DocGraphIndexModal />
      <DocGraphQueryModal />
      <ConnectorsModal />
      <TelegramConnectModal />
      <TallyConnectModal />

      {showFileIndexerSetup && (
        <FileIndexerSetupWizard
          modelDir={fileIndexerModelDir}
          onComplete={onFileIndexerSetupComplete}
        />
      )}

      {showStartupModal && (
        <StartupModal
          onContinueWorkspace={onContinueWorkspace}
          canContinueWorkspace={canContinueWorkspace}
          continueWorkspaceName={continueWorkspaceName}
          onNewProject={onNewProject}
          onImportProject={onImportProject}
          onStartTour={onStartTour}
          busy={workspaceBusy}
        />
      )}

      <AppModal
        isOpen={appModal.open}
        kind={appModal.kind}
        title={appModal.title}
        message={appModal.message}
        confirmLabel={appModal.confirmLabel}
        cancelLabel={appModal.cancelLabel}
        showCancel={appModal.showCancel}
        onConfirm={handleModalConfirm}
        onCancel={handleModalCancel}
        onExportSupportBundle={
          appModal.kind === "error" ? exportSupportBundleFromModal : undefined
        }
      />

      <ModelsSettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        models={registeredModels}
        modelCatalog={modelCatalog}
        onModelsUpdated={refreshModels}
        downloads={downloads}
        onDownload={handleDownloadModel}
        onCancelDownload={handleCancelDownload}
        onUninstall={handleUninstall}
        onDownloadMissingOptional={downloadMissingOptionalModels}
        onConfirm={confirmAction}
        workspaceId={activeWorkspace?.id}
      />

      <HuggingFaceModal
        isOpen={hfModalOpen}
        onClose={() => setHfModalOpen(false)}
        onModelImported={refreshModels}
        defaultFolder={hfModalPreset.folder}
        defaultImportProfile={hfModalPreset.profile}
      />

      <ToursModal isOpen={toursOpen} onClose={() => setToursOpen(false)} />

      <ProfileModal isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
      <OnboardingModal />

      <CloudSettingsModal
        isOpen={cloudSettingsOpen}
        onClose={() => setCloudSettingsOpen(false)}
      />

      <PremiumUpgradeModal />

      <RagSourcePickerModal />
      <FollowUpModal />
    </>
  );
}
