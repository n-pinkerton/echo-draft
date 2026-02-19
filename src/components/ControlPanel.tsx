import { useState, useEffect, useRef, useMemo } from "react";
import type { SettingsSectionType } from "./SettingsModal";
import { useDialogs } from "../hooks/useDialogs";
import { useHotkey } from "../hooks/useHotkey";
import { useToast } from "./ui/Toast";
import { useUpdater } from "../hooks/useUpdater";
import { useSettings } from "../hooks/useSettings";
import { useAuth } from "../hooks/useAuth";
import {
  useTranscriptions,
  initializeTranscriptions,
  removeTranscription as removeFromStore,
  clearTranscriptions as clearStoreTranscriptions,
} from "../stores/transcriptionStore";
import type { TranscriptionItem as TranscriptionItemType } from "../types/electron";
import { filterHistory, getProviderOptions } from "./controlPanel/historyFilterUtils";
import ControlPanelView from "./controlPanel/ControlPanelView";
import { useFileTranscription } from "./controlPanel/useFileTranscription";

export default function ControlPanel() {
  const history = useTranscriptions();
  const [isLoading, setIsLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [limitData, setLimitData] = useState<{ wordsUsed: number; limit: number } | null>(null);
  const hasShownUpgradePrompt = useRef(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionType | undefined>();
  const [aiCTADismissed, setAiCTADismissed] = useState(
    () => localStorage.getItem("aiCTADismissed") === "true"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [modeFilter, setModeFilter] = useState<"all" | "insert" | "clipboard" | "file">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "error" | "cancelled">(
    "all"
  );
  const [providerFilter, setProviderFilter] = useState("all");
  const [isExporting, setIsExporting] = useState(false);
  const [showCloudMigrationBanner, setShowCloudMigrationBanner] = useState(false);
  const cloudMigrationProcessed = useRef(false);
  const { hotkey } = useHotkey();
  const { toast } = useToast();
  const { useReasoningModel, setUseLocalWhisper, setCloudTranscriptionMode } = useSettings();
  const { isSignedIn, isLoaded: authLoaded } = useAuth();

  const {
    showFileTranscribeDialog,
    handleDialogOpenChange: handleFileTranscribeDialogOpenChange,
    fileCleanupEnabled,
    setFileCleanupEnabled,
    fileTranscribeStageLabel,
    fileTranscribeMessage,
    fileTranscribeFileName,
    isFileTranscribing,
    transcribeAudioFile,
  } = useFileTranscription(toast, useReasoningModel);

  const {
    status: updateStatus,
    downloadProgress,
    isDownloading,
    isInstalling,
    downloadUpdate,
    installUpdate,
    error: updateError,
  } = useUpdater();

  const {
    confirmDialog,
    alertDialog,
    showConfirmDialog,
    showAlertDialog,
    hideConfirmDialog,
    hideAlertDialog,
  } = useDialogs();

  useEffect(() => {
    loadTranscriptions();
  }, []);

  useEffect(() => {
    if (updateStatus.updateDownloaded && !isDownloading) {
      toast({
        title: "Update Ready",
        description: "Click 'Install Update' to restart and apply the update.",
        variant: "success",
      });
    }
  }, [updateStatus.updateDownloaded, isDownloading, toast]);

  useEffect(() => {
    if (updateError) {
      toast({
        title: "Update Error",
        description: "Failed to update. Please try again later.",
        variant: "destructive",
      });
    }
  }, [updateError, toast]);

  useEffect(() => {
    const dispose = window.electronAPI?.onWindowsPushToTalkUnavailable?.((data) => {
      const reason = typeof data?.reason === "string" ? data.reason : "";
      const message = typeof data?.message === "string" ? data.message : "";
      toast({
        title: "Windows Key Listener Unavailable",
        description:
          message ||
          (reason === "binary_not_found"
            ? "Push-to-Talk native listener is missing. Modifier-only hotkeys may not work. Choose a non-modifier hotkey (e.g., F9) or reinstall."
            : "Push-to-Talk native listener is unavailable. Modifier-only hotkeys may not work. Choose a non-modifier hotkey (e.g., F9) or reinstall."),
        duration: 12000,
      });
    });

    return () => {
      dispose?.();
    };
  }, [toast]);

  useEffect(() => {
    const dispose = window.electronAPI?.onLimitReached?.(
      (data: { wordsUsed: number; limit: number }) => {
        if (!hasShownUpgradePrompt.current) {
          hasShownUpgradePrompt.current = true;
          setLimitData(data);
          setShowUpgradePrompt(true);
        } else {
          toast({
            title: "Daily Limit Reached",
            description: "Resets at midnight UTC. Use your own API key or switch to local.",
            duration: 5000,
          });
        }
      }
    );

    return () => {
      dispose?.();
    };
  }, [toast]);

  useEffect(() => {
    if (!authLoaded || !isSignedIn || cloudMigrationProcessed.current) return;
    const isPending = localStorage.getItem("pendingCloudMigration") === "true";
    const alreadyShown = localStorage.getItem("cloudMigrationShown") === "true";
    if (!isPending || alreadyShown) return;

    cloudMigrationProcessed.current = true;
    setUseLocalWhisper(false);
    setCloudTranscriptionMode("openwhispr");
    localStorage.removeItem("pendingCloudMigration");
    setShowCloudMigrationBanner(true);
  }, [authLoaded, isSignedIn, setUseLocalWhisper, setCloudTranscriptionMode]);

  const loadTranscriptions = async () => {
    try {
      setIsLoading(true);
      await initializeTranscriptions(250);
    } catch (error) {
      showAlertDialog({
        title: "Unable to load history",
        description: "Please try again in a moment.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (
    text: string,
    options: { title?: string; description?: string } = {}
  ) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: options.title || "Copied!",
        description: options.description || "Text copied to your clipboard",
        variant: "success",
        duration: 2000,
      });
    } catch (err) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy text to clipboard",
        variant: "destructive",
      });
    }
  };

  const copyDiagnostics = async (item: TranscriptionItemType) => {
    const diagnostics = {
      id: item.id,
      timestamp: item.timestamp,
      textLength: item.text?.length || 0,
      rawTextLength: item.raw_text?.length || item.text?.length || 0,
      meta: item.meta || {},
    };
    await copyToClipboard(JSON.stringify(diagnostics, null, 2), {
      title: "Diagnostics Copied",
      description: "Diagnostic JSON copied to clipboard.",
    });
  };

  const providerOptions = useMemo(() => {
    return getProviderOptions(history);
  }, [history]);

  const filteredHistory = useMemo(() => {
    return filterHistory(history, {
      searchQuery,
      modeFilter,
      statusFilter,
      providerFilter,
    });
  }, [history, modeFilter, providerFilter, searchQuery, statusFilter]);

  const exportTranscriptions = async (format: "csv" | "json") => {
    if (!window.electronAPI?.exportTranscriptions) {
      toast({
        title: "Export Unavailable",
        description: "This build does not support history export yet.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsExporting(true);
      const result = await window.electronAPI.exportTranscriptions(format);
      if (result?.success) {
        toast({
          title: `Exported ${format.toUpperCase()}`,
          description: `${result.count || 0} items exported.`,
          variant: "success",
        });
      } else if (!result?.canceled) {
        toast({
          title: "Export Failed",
          description: "Could not export history. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Could not export history. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const clearHistory = async () => {
    showConfirmDialog({
      title: "Clear History",
      description: "Are you sure you want to clear all transcriptions? This cannot be undone.",
      onConfirm: async () => {
        try {
          const result = await window.electronAPI.clearTranscriptions();
          clearStoreTranscriptions();
          toast({
            title: "History cleared",
            description: `${result.cleared} transcription${result.cleared !== 1 ? "s" : ""} removed`,
            variant: "success",
            duration: 3000,
          });
        } catch (error) {
          toast({
            title: "Failed to clear",
            description: "Please try again",
            variant: "destructive",
          });
        }
      },
      variant: "destructive",
    });
  };

  const deleteTranscription = async (id: number) => {
    showConfirmDialog({
      title: "Delete Transcription",
      description: "Are you certain you wish to remove this inscription from your records?",
      onConfirm: async () => {
        try {
          const result = await window.electronAPI.deleteTranscription(id);
          if (result.success) {
            removeFromStore(id);
          } else {
            showAlertDialog({
              title: "Delete Failed",
              description: "Failed to delete transcription. It may have already been removed.",
            });
          }
        } catch (error) {
          showAlertDialog({
            title: "Delete Failed",
            description: "Failed to delete transcription. Please try again.",
          });
        }
      },
      variant: "destructive",
    });
  };

  const handleUpdateClick = async () => {
    if (updateStatus.updateDownloaded) {
      showConfirmDialog({
        title: "Install Update",
        description:
          "The update will be installed and the app will restart. Make sure you've saved any work.",
        onConfirm: async () => {
          try {
            await installUpdate();
          } catch (error) {
            toast({
              title: "Install Failed",
              description: "Failed to install update. Please try again.",
              variant: "destructive",
            });
          }
        },
      });
    } else if (updateStatus.updateAvailable && !isDownloading) {
      try {
        await downloadUpdate();
      } catch (error) {
        toast({
          title: "Download Failed",
          description: "Failed to download update. Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  return (
    <ControlPanelView
      confirmDialog={confirmDialog}
      alertDialog={alertDialog}
      hideConfirmDialog={hideConfirmDialog}
      hideAlertDialog={hideAlertDialog}
      showFileTranscribeDialog={showFileTranscribeDialog}
      handleFileTranscribeDialogOpenChange={handleFileTranscribeDialogOpenChange}
      fileCleanupEnabled={fileCleanupEnabled}
      setFileCleanupEnabled={setFileCleanupEnabled}
      isFileTranscribing={isFileTranscribing}
      fileTranscribeStageLabel={fileTranscribeStageLabel}
      fileTranscribeMessage={fileTranscribeMessage}
      fileTranscribeFileName={fileTranscribeFileName}
      transcribeAudioFile={transcribeAudioFile}
      showUpgradePrompt={showUpgradePrompt}
      setShowUpgradePrompt={setShowUpgradePrompt}
      limitData={limitData}
      updateStatus={updateStatus}
      downloadProgress={downloadProgress}
      isDownloading={isDownloading}
      isInstalling={isInstalling}
      handleUpdateClick={handleUpdateClick}
      showSettings={showSettings}
      setShowSettings={setShowSettings}
      settingsSection={settingsSection}
      setSettingsSection={setSettingsSection}
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
      showCloudMigrationBanner={showCloudMigrationBanner}
      setShowCloudMigrationBanner={setShowCloudMigrationBanner}
      useReasoningModel={useReasoningModel}
      aiCTADismissed={aiCTADismissed}
      setAiCTADismissed={setAiCTADismissed}
      clearHistory={clearHistory}
      exportTranscriptions={exportTranscriptions}
      isExporting={isExporting}
      copyToClipboard={copyToClipboard}
      copyDiagnostics={copyDiagnostics}
      deleteTranscription={deleteTranscription}
    />
  );
}
