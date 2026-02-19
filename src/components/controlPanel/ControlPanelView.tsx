import { Settings } from "lucide-react";

import SettingsModal, { SettingsSectionType } from "../SettingsModal";
import TitleBar from "../TitleBar";
import SupportDropdown from "../ui/SupportDropdown";
import UpgradePrompt from "../UpgradePrompt";
import { AlertDialog, ConfirmDialog } from "../ui/dialog";
import { Button } from "../ui/button";
import type { TranscriptionItem as TranscriptionItemType } from "../../types/electron";
import FileTranscribeDialog from "./FileTranscribeDialog";
import UpdateActionButton from "./UpdateActionButton";
import ControlPanelBanners from "./ControlPanelBanners";
import TranscriptionsHeader from "./TranscriptionsHeader";
import HistoryPanel from "./HistoryPanel";
import type { AlertDialogState, ConfirmDialogState } from "../../hooks/useDialogs";

type UpdateStatus = {
  updateAvailable: boolean;
  updateDownloaded: boolean;
  isDevelopment: boolean;
};

type Props = {
  confirmDialog: ConfirmDialogState;
  alertDialog: AlertDialogState;
  hideConfirmDialog: () => void;
  hideAlertDialog: () => void;

  showFileTranscribeDialog: boolean;
  handleFileTranscribeDialogOpenChange: (open: boolean) => void;
  fileCleanupEnabled: boolean;
  setFileCleanupEnabled: (next: boolean) => void;
  isFileTranscribing: boolean;
  fileTranscribeStageLabel: string | null;
  fileTranscribeMessage: string | null;
  fileTranscribeFileName: string | null;
  transcribeAudioFile: () => Promise<void>;

  showUpgradePrompt: boolean;
  setShowUpgradePrompt: (next: boolean) => void;
  limitData: { wordsUsed: number; limit: number } | null;

  updateStatus: UpdateStatus;
  downloadProgress: number;
  isDownloading: boolean;
  isInstalling: boolean;
  handleUpdateClick: () => Promise<void>;

  showSettings: boolean;
  setShowSettings: (next: boolean) => void;
  settingsSection: SettingsSectionType | undefined;
  setSettingsSection: (next: SettingsSectionType | undefined) => void;

  history: TranscriptionItemType[];
  filteredHistory: TranscriptionItemType[];
  providerOptions: string[];
  isLoading: boolean;
  hotkey: string;

  searchQuery: string;
  setSearchQuery: (next: string) => void;
  modeFilter: "all" | "insert" | "clipboard" | "file";
  setModeFilter: (next: "all" | "insert" | "clipboard" | "file") => void;
  statusFilter: "all" | "success" | "error" | "cancelled";
  setStatusFilter: (next: "all" | "success" | "error" | "cancelled") => void;
  providerFilter: string;
  setProviderFilter: (next: string) => void;

  showCloudMigrationBanner: boolean;
  setShowCloudMigrationBanner: (next: boolean) => void;
  useReasoningModel: boolean;
  aiCTADismissed: boolean;
  setAiCTADismissed: (next: boolean) => void;

  clearHistory: () => Promise<void>;
  exportTranscriptions: (format: "csv" | "json") => Promise<void>;
  isExporting: boolean;

  copyToClipboard: (text: string, options?: { title?: string; description?: string }) => Promise<void>;
  copyDiagnostics: (item: TranscriptionItemType) => Promise<void>;
  deleteTranscription: (id: number) => Promise<void>;
};

export default function ControlPanelView(props: Props) {
  const {
    confirmDialog,
    alertDialog,
    hideConfirmDialog,
    hideAlertDialog,
    showFileTranscribeDialog,
    handleFileTranscribeDialogOpenChange,
    fileCleanupEnabled,
    setFileCleanupEnabled,
    isFileTranscribing,
    fileTranscribeStageLabel,
    fileTranscribeMessage,
    fileTranscribeFileName,
    transcribeAudioFile,
    showUpgradePrompt,
    setShowUpgradePrompt,
    limitData,
    updateStatus,
    downloadProgress,
    isDownloading,
    isInstalling,
    handleUpdateClick,
    showSettings,
    setShowSettings,
    settingsSection,
    setSettingsSection,
    history,
    filteredHistory,
    providerOptions,
    isLoading,
    hotkey,
    searchQuery,
    setSearchQuery,
    modeFilter,
    setModeFilter,
    statusFilter,
    setStatusFilter,
    providerFilter,
    setProviderFilter,
    showCloudMigrationBanner,
    setShowCloudMigrationBanner,
    useReasoningModel,
    aiCTADismissed,
    setAiCTADismissed,
    clearHistory,
    exportTranscriptions,
    isExporting,
    copyToClipboard,
    copyDiagnostics,
    deleteTranscription,
  } = props;

  return (
    <div className="min-h-screen bg-background">
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={hideConfirmDialog}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={hideAlertDialog}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      <FileTranscribeDialog
        open={showFileTranscribeDialog}
        onOpenChange={handleFileTranscribeDialogOpenChange}
        fileCleanupEnabled={fileCleanupEnabled}
        onCleanupEnabledChange={setFileCleanupEnabled}
        isFileTranscribing={isFileTranscribing}
        fileTranscribeStageLabel={fileTranscribeStageLabel}
        fileTranscribeMessage={fileTranscribeMessage}
        fileTranscribeFileName={fileTranscribeFileName}
        onChooseFile={transcribeAudioFile}
      />

      <UpgradePrompt
        open={showUpgradePrompt}
        onOpenChange={setShowUpgradePrompt}
        wordsUsed={limitData?.wordsUsed}
        limit={limitData?.limit}
      />

      <TitleBar
        actions={
          <>
            <UpdateActionButton
              updateStatus={updateStatus}
              downloadProgress={downloadProgress}
              isDownloading={isDownloading}
              isInstalling={isInstalling}
              onClick={handleUpdateClick}
            />
            <SupportDropdown />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open settings"
              onClick={() => {
                setSettingsSection(undefined);
                setShowSettings(true);
              }}
              className="text-foreground/70 hover:text-foreground hover:bg-foreground/10"
            >
              <Settings size={16} />
            </Button>
          </>
        }
      />

      <SettingsModal
        open={showSettings}
        onOpenChange={(open) => {
          setShowSettings(open);
          if (!open) setSettingsSection(undefined);
        }}
        initialSection={settingsSection}
      />

      <div className="p-4">
        <div className="max-w-3xl mx-auto">
          <TranscriptionsHeader
            historyLength={history.length}
            filteredHistoryLength={filteredHistory.length}
            isFileTranscribing={isFileTranscribing}
            onOpenFileTranscribeDialog={() => handleFileTranscribeDialogOpenChange(true)}
            onClearHistory={clearHistory}
          />

          <ControlPanelBanners
            showCloudMigrationBanner={showCloudMigrationBanner}
            onDismissCloudMigration={() => {
              setShowCloudMigrationBanner(false);
              localStorage.setItem("cloudMigrationShown", "true");
            }}
            onViewCloudSettings={() => {
              setShowCloudMigrationBanner(false);
              localStorage.setItem("cloudMigrationShown", "true");
              setSettingsSection("transcription");
              setShowSettings(true);
            }}
            useReasoningModel={useReasoningModel}
            aiCTADismissed={aiCTADismissed}
            onDismissAiCTA={() => {
              localStorage.setItem("aiCTADismissed", "true");
              setAiCTADismissed(true);
            }}
            onEnableAiEnhancement={() => {
              setSettingsSection("aiModels");
              setShowSettings(true);
            }}
          />

          <HistoryPanel
            history={history}
            filteredHistory={filteredHistory}
            providerOptions={providerOptions}
            isLoading={isLoading}
            hotkey={hotkey}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            modeFilter={modeFilter}
            setModeFilter={setModeFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            providerFilter={providerFilter}
            setProviderFilter={setProviderFilter}
            exportTranscriptions={exportTranscriptions}
            isExporting={isExporting}
            copyToClipboard={copyToClipboard}
            copyDiagnostics={copyDiagnostics}
            deleteTranscription={deleteTranscription}
          />
        </div>
      </div>
    </div>
  );
}
