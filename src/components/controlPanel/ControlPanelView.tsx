import { Settings } from "lucide-react";

import SettingsModal, { SettingsSectionType } from "../SettingsModal";
import TitleBar from "../TitleBar";
import SupportDropdown from "../ui/SupportDropdown";
import UpgradePrompt from "../UpgradePrompt";
import { AlertDialog, ConfirmDialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import type { TodoItem, TranscriptionItem as TranscriptionItemType } from "../../types/electron";
import type { MobileInboxStatus } from "../../types/electronApi/mobileInbox";
import FileTranscribeDialog from "./FileTranscribeDialog";
import UpdateActionButton from "./UpdateActionButton";
import ControlPanelBanners from "./ControlPanelBanners";
import TranscriptionsHeader from "./TranscriptionsHeader";
import HistoryPanel from "./HistoryPanel";
import DictationQuickStart from "./DictationQuickStart";
import TodoPanel from "./TodoPanel";
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
  settingsTarget: string | undefined;
  setSettingsTarget: (next: string | undefined) => void;

  history: TranscriptionItemType[];
  todos: TodoItem[];
  mobileInboxStatus: MobileInboxStatus | null;
  isChoosingInboxFolder: boolean;
  chooseMobileInboxFolder: () => Promise<void>;
  filteredHistory: TranscriptionItemType[];
  providerOptions: string[];
  isLoading: boolean;
  hotkey: string;
  clipboardHotkey: string;
  activationMode: "tap" | "push";
  cleanupModel: string;
  cleanupManagedByCloud: boolean;
  preferBuiltInMic: boolean;
  selectedMicDeviceId: string;
  setPreferBuiltInMic: (next: boolean) => void;
  setSelectedMicDeviceId: (next: string) => void;

  searchQuery: string;
  setSearchQuery: (next: string) => void;
  modeFilter: "all" | "insert" | "clipboard" | "file";
  setModeFilter: (next: "all" | "insert" | "clipboard" | "file") => void;
  statusFilter: "all" | "success" | "delivery_issue" | "error" | "cancelled";
  setStatusFilter: (next: "all" | "success" | "delivery_issue" | "error" | "cancelled") => void;
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

  copyToClipboard: (
    text: string,
    options?: { title?: string; description?: string }
  ) => Promise<void>;
  copyDiagnostics: (item: TranscriptionItemType) => Promise<void>;
  deleteTranscription: (id: number) => Promise<void>;
  markTodoActioned: (id: number) => Promise<void>;
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
    settingsTarget,
    setSettingsTarget,
    history,
    todos,
    mobileInboxStatus,
    isChoosingInboxFolder,
    chooseMobileInboxFolder,
    filteredHistory,
    providerOptions,
    isLoading,
    hotkey,
    clipboardHotkey,
    activationMode,
    cleanupModel,
    cleanupManagedByCloud,
    preferBuiltInMic,
    selectedMicDeviceId,
    setPreferBuiltInMic,
    setSelectedMicDeviceId,
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
    markTodoActioned,
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
                setSettingsTarget(undefined);
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
          if (!open) {
            setSettingsSection(undefined);
            setSettingsTarget(undefined);
          }
        }}
        initialSection={settingsSection}
        initialTarget={settingsTarget}
      />

      <div className="p-4">
        <div className="max-w-3xl mx-auto">
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

          <DictationQuickStart
            insertHotkey={hotkey}
            clipboardHotkey={clipboardHotkey}
            activationMode={activationMode}
            cleanupEnabled={useReasoningModel}
            cleanupModel={cleanupModel}
            cleanupManagedByCloud={cleanupManagedByCloud}
            preferBuiltInMic={preferBuiltInMic}
            selectedMicDeviceId={selectedMicDeviceId}
            onPreferBuiltInChange={setPreferBuiltInMic}
            onDeviceSelect={setSelectedMicDeviceId}
            latestCleanup={
              history[0]?.meta?.cleanup && typeof history[0].meta.cleanup === "object"
                ? history[0].meta.cleanup
                : null
            }
            onOpenHotkeySettings={() => {
              setSettingsSection("hotkeys");
              setSettingsTarget(undefined);
              setShowSettings(true);
            }}
            onOpenMicrophoneSettings={() => {
              setSettingsSection("general");
              setSettingsTarget("microphone-settings");
              setShowSettings(true);
            }}
            onOpenCleanupSettings={() => {
              setSettingsSection("aiModels");
              setSettingsTarget(undefined);
              setShowSettings(true);
            }}
          />

          <Tabs defaultValue="history" className="mt-4">
            <TabsList aria-label="Dictation views" className="h-9">
              <TabsTrigger value="history" className="h-7 px-3 text-xs">
                History
              </TabsTrigger>
              <TabsTrigger value="todo" className="h-7 gap-1.5 px-3 text-xs">
                To Do
                {todos.length > 0 ? (
                  <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground">
                    {todos.length}
                  </span>
                ) : null}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="history">
              <TranscriptionsHeader
                historyLength={history.length}
                filteredHistoryLength={filteredHistory.length}
                isFileTranscribing={isFileTranscribing}
                onOpenFileTranscribeDialog={() => handleFileTranscribeDialogOpenChange(true)}
                onClearHistory={clearHistory}
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
            </TabsContent>

            <TabsContent value="todo">
              <TodoPanel
                items={todos}
                isLoading={isLoading}
                mobileInboxStatus={mobileInboxStatus}
                isChoosingInboxFolder={isChoosingInboxFolder}
                chooseMobileInboxFolder={chooseMobileInboxFolder}
                copyToClipboard={copyToClipboard}
                markActioned={markTodoActioned}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
