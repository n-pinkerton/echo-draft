import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Trash2,
  Settings,
  FileText,
  Mic,
  Download,
  RefreshCw,
  Loader2,
  Sparkles,
  Cloud,
  X,
} from "lucide-react";
import SettingsModal, { SettingsSectionType } from "./SettingsModal";
import TitleBar from "./TitleBar";
import SupportDropdown from "./ui/SupportDropdown";
import TranscriptionItem from "./ui/TranscriptionItem";
import UpgradePrompt from "./UpgradePrompt";
import {
  AlertDialog,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Toggle } from "./ui/toggle";
import { useDialogs } from "../hooks/useDialogs";
import { useHotkey } from "../hooks/useHotkey";
import { useToast } from "./ui/Toast";
import { useUpdater } from "../hooks/useUpdater";
import { useSettings } from "../hooks/useSettings";
import { useAuth } from "../hooks/useAuth";
import AudioManager from "../helpers/audioManager";
import logger from "../utils/logger";
import {
  useTranscriptions,
  initializeTranscriptions,
  removeTranscription as removeFromStore,
  clearTranscriptions as clearStoreTranscriptions,
} from "../stores/transcriptionStore";
import { formatHotkeyLabel } from "../utils/hotkeys";
import type { TranscriptionItem as TranscriptionItemType } from "../types/electron";

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
  const [showFileTranscribeDialog, setShowFileTranscribeDialog] = useState(false);
  const [fileCleanupEnabled, setFileCleanupEnabled] = useState(
    () => localStorage.getItem("useReasoningModel") === "true"
  );
  const [fileTranscribeStageLabel, setFileTranscribeStageLabel] = useState<string | null>(null);
  const [fileTranscribeMessage, setFileTranscribeMessage] = useState<string | null>(null);
  const [fileTranscribeFileName, setFileTranscribeFileName] = useState<string | null>(null);
  const [isFileTranscribing, setIsFileTranscribing] = useState(false);
  const [showCloudMigrationBanner, setShowCloudMigrationBanner] = useState(false);
  const cloudMigrationProcessed = useRef(false);
  const { hotkey } = useHotkey();
  const { toast } = useToast();
  const { useReasoningModel, setUseLocalWhisper, setCloudTranscriptionMode } = useSettings();
  const { isSignedIn, isLoaded: authLoaded } = useAuth();

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

  const createSessionId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const transcribeAudioFile = async () => {
    if (isFileTranscribing) return;
    if (!window.electronAPI?.selectAudioFileForTranscription) {
      toast({
        title: "Unavailable",
        description: "This build does not support file transcription yet.",
        variant: "destructive",
      });
      return;
    }

    setFileTranscribeStageLabel(null);
    setFileTranscribeMessage(null);
    setFileTranscribeFileName(null);

    const selection = await window.electronAPI.selectAudioFileForTranscription();
    if (selection?.canceled) {
      return;
    }
    if (!selection?.success) {
      toast({
        title: "File Selection Failed",
        description: selection?.error || "Could not read the selected file.",
        variant: "destructive",
      });
      return;
    }
    if (!selection.data || selection.data.byteLength === 0) {
      toast({
        title: "File Selection Failed",
        description: "Selected file was empty or could not be read.",
        variant: "destructive",
      });
      return;
    }

    const fileName = selection.fileName || "audio";
    const mimeType = selection.mimeType || "application/octet-stream";
    const bytes = new Uint8Array(selection.data.byteLength);
    bytes.set(selection.data);
    const audioBlob = new Blob([bytes.buffer], { type: mimeType });

    const sessionId = createSessionId();
    const triggeredAt = Date.now();
    const startedAt = Date.now();
    const context = {
      sessionId,
      outputMode: "file",
      triggeredAt,
      cleanupEnabled: fileCleanupEnabled,
      file: {
        fileName,
        extension: selection.extension ?? null,
        mimeType,
        sizeBytes: selection.sizeBytes ?? null,
      },
    };

    logger.info(
      "File transcription started",
      {
        sessionId,
        fileName,
        mimeType,
        sizeBytes: selection.sizeBytes ?? null,
        cleanupEnabled: fileCleanupEnabled,
      },
      "file"
    );

    setFileTranscribeFileName(fileName);
    setIsFileTranscribing(true);

    const manager = new AudioManager();
    const providerRef = { current: null as null | string };
    const modelRef = { current: null as null | string };
    const lastStageRef = { current: null as null | string };

    const finalize = () => {
      try {
        manager.cleanup();
      } catch {
        // Ignore cleanup errors
      }
    };

    manager.setCallbacks({
      onStateChange: (state) => {
        logger.trace("File transcription state change", { sessionId, ...state }, "file");
      },
      onProgress: (event) => {
        if (event?.provider) {
          providerRef.current = String(event.provider);
        }
        if (event?.model) {
          modelRef.current = String(event.model);
        }
        if (
          typeof event?.stage === "string" &&
          event.stage &&
          event.stage !== lastStageRef.current
        ) {
          lastStageRef.current = event.stage;
          setFileTranscribeStageLabel(event.stageLabel || event.stage);
          setFileTranscribeMessage(typeof event.message === "string" ? event.message : null);
          logger.trace(
            "File transcription stage",
            {
              sessionId,
              stage: event.stage,
              stageLabel: event.stageLabel || null,
              message: event.message || null,
              provider: event.provider || null,
              model: event.model || null,
            },
            "file"
          );
        }
      },
      onPartialTranscript: () => {},
      onError: (error) => {
        logger.error("File transcription error", { sessionId, error }, "file");
        toast({
          title: error?.title || "Transcription Error",
          description: error?.description || "Failed to transcribe audio file.",
          variant: "destructive",
          duration: 7000,
        });
        setIsFileTranscribing(false);
        finalize();
      },
      onTranscriptionComplete: async (result) => {
        try {
          if (!result?.success) {
            throw new Error("Transcription failed");
          }

          const provider = providerRef.current || result.source || null;
          const model = modelRef.current || null;
          const totalDurationMs = Math.max(0, Date.now() - startedAt);

          const saveResult = await window.electronAPI.saveTranscription({
            text: result.text,
            rawText: result.rawText ?? result.text,
            meta: {
              sessionId,
              outputMode: "file",
              status: "success",
              source: result.source,
              provider,
              model,
              cleanupEnabled: fileCleanupEnabled,
              file: context.file,
              timings: {
                ...(result.timings || {}),
                totalDurationMs,
              },
            },
          });

          if (!saveResult?.success) {
            throw new Error("Saved transcription to history failed");
          }

          toast({
            title: "Transcribed",
            description: "Saved to history.",
            variant: "success",
            duration: 2500,
          });

          logger.info(
            "File transcription saved",
            {
              sessionId,
              transcriptionId: saveResult.id ?? null,
              provider,
              model,
              textLength: result.text?.length ?? null,
              rawTextLength: result.rawText?.length ?? null,
              totalDurationMs,
            },
            "file"
          );
        } catch (error) {
          toast({
            title: "Transcription Failed",
            description: (error as Error)?.message || "An unexpected error occurred.",
            variant: "destructive",
            duration: 7000,
          });
          logger.error(
            "File transcription completion handler failed",
            { sessionId, error: (error as Error)?.message || String(error) },
            "file"
          );
        } finally {
          setIsFileTranscribing(false);
          setShowFileTranscribeDialog(false);
          setFileTranscribeStageLabel(null);
          setFileTranscribeMessage(null);
          setFileTranscribeFileName(null);
          finalize();
        }
      },
    });

    manager.enqueueProcessingJob(audioBlob, {}, context);
  };

  const providerOptions = useMemo(() => {
    const providers = new Set<string>();
    for (const item of history) {
      const meta = item.meta || {};
      const provider = meta.provider || meta.source;
      if (provider) {
        providers.add(String(provider));
      }
    }
    return Array.from(providers).sort((a, b) => a.localeCompare(b));
  }, [history]);

  const filteredHistory = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return history.filter((item) => {
      const meta = item.meta || {};
      const provider = String(meta.provider || meta.source || "").toLowerCase();
      const model = String(meta.model || "").toLowerCase();
      const outputMode = String(meta.outputMode || "insert").toLowerCase();
      const status = String(meta.status || "success").toLowerCase();
      const haystack = [item.text || "", item.raw_text || "", provider, model, status, outputMode]
        .join(" ")
        .toLowerCase();

      if (normalizedQuery && !haystack.includes(normalizedQuery)) {
        return false;
      }
      if (modeFilter !== "all" && outputMode !== modeFilter) {
        return false;
      }
      if (statusFilter !== "all" && status !== statusFilter) {
        return false;
      }
      if (providerFilter !== "all" && provider !== providerFilter.toLowerCase()) {
        return false;
      }
      return true;
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

  const getUpdateButtonContent = () => {
    if (isInstalling) {
      return (
        <>
          <Loader2 size={14} className="animate-spin" />
          <span>Installing...</span>
        </>
      );
    }
    if (isDownloading) {
      return (
        <>
          <Loader2 size={14} className="animate-spin" />
          <span>{Math.round(downloadProgress)}%</span>
        </>
      );
    }
    if (updateStatus.updateDownloaded) {
      return (
        <>
          <RefreshCw size={14} />
          <span>Install Update</span>
        </>
      );
    }
    if (updateStatus.updateAvailable) {
      return (
        <>
          <Download size={14} />
          <span>Update Available</span>
        </>
      );
    }
    return null;
  };

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

      <Dialog
        open={showFileTranscribeDialog}
        onOpenChange={(open) => {
          setShowFileTranscribeDialog(open);
          if (open) {
            setFileCleanupEnabled(useReasoningModel);
            setFileTranscribeStageLabel(null);
            setFileTranscribeMessage(null);
            setFileTranscribeFileName(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Transcribe audio file</DialogTitle>
            <DialogDescription>
              Uses your current transcription settings (local or cloud). The result is saved to
              history.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-6">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-foreground">Cleanup (AI enhancement)</p>
                <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
                  Runs the cleanup model after transcription.
                </p>
              </div>
              <div className="shrink-0">
                <Toggle
                  checked={fileCleanupEnabled}
                  onChange={setFileCleanupEnabled}
                  disabled={isFileTranscribing}
                />
              </div>
            </div>

            {isFileTranscribing && (
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <p className="text-[13px] font-medium text-foreground">
                  {fileTranscribeFileName
                    ? `Transcribing ${fileTranscribeFileName}`
                    : "Transcribing…"}
                </p>
                {fileTranscribeStageLabel && (
                  <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
                    {fileTranscribeStageLabel}
                    {fileTranscribeMessage ? ` — ${fileTranscribeMessage}` : ""}
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowFileTranscribeDialog(false)}
              disabled={isFileTranscribing}
            >
              Close
            </Button>
            <Button variant="default" onClick={transcribeAudioFile} disabled={isFileTranscribing}>
              {isFileTranscribing ? (
                <>
                  <Loader2 size={14} className="mr-2 animate-spin" />
                  Working…
                </>
              ) : (
                "Choose file…"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UpgradePrompt
        open={showUpgradePrompt}
        onOpenChange={setShowUpgradePrompt}
        wordsUsed={limitData?.wordsUsed}
        limit={limitData?.limit}
      />

      <TitleBar
        actions={
          <>
            {!updateStatus.isDevelopment &&
              (updateStatus.updateAvailable ||
                updateStatus.updateDownloaded ||
                isDownloading ||
                isInstalling) && (
                <Button
                  variant={updateStatus.updateDownloaded ? "default" : "outline"}
                  size="sm"
                  onClick={handleUpdateClick}
                  disabled={isInstalling || isDownloading}
                  className="gap-1.5 text-xs"
                >
                  {getUpdateButtonContent()}
                </Button>
              )}
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
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Transcriptions</h2>
              {history.length > 0 && (
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  ({filteredHistory.length}
                  {filteredHistory.length !== history.length ? ` / ${history.length}` : ""})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setShowFileTranscribeDialog(true)}
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px]"
                disabled={isFileTranscribing}
              >
                Transcribe Audio File…
              </Button>
              {history.length > 0 && (
                <Button
                  onClick={clearHistory}
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 size={12} className="mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          {showCloudMigrationBanner && (
            <div className="mb-3 relative rounded-lg border border-primary/20 bg-primary/5 dark:bg-primary/10 p-3">
              <button
                onClick={() => {
                  setShowCloudMigrationBanner(false);
                  localStorage.setItem("cloudMigrationShown", "true");
                }}
                className="absolute top-2 right-2 p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <X size={14} />
              </button>
              <div className="flex items-start gap-3 pr-6">
                <div className="shrink-0 w-8 h-8 rounded-md bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
                  <Cloud size={16} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-foreground mb-0.5">
                    Welcome to OpenWhispr Pro
                  </p>
                  <p className="text-[12px] text-muted-foreground mb-2">
                    Your 7-day free trial is active! We've switched your transcription to OpenWhispr
                    Cloud for faster, more accurate results. Your previous settings are saved —
                    switch back anytime in Settings.
                  </p>
                  <Button
                    variant="default"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => {
                      setShowCloudMigrationBanner(false);
                      localStorage.setItem("cloudMigrationShown", "true");
                      setSettingsSection("transcription");
                      setShowSettings(true);
                    }}
                  >
                    View Settings
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!useReasoningModel && !aiCTADismissed && (
            <div className="mb-3 relative rounded-lg border border-primary/20 bg-primary/5 dark:bg-primary/10 p-3">
              <button
                onClick={() => {
                  localStorage.setItem("aiCTADismissed", "true");
                  setAiCTADismissed(true);
                }}
                className="absolute top-2 right-2 p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <X size={14} />
              </button>
              <div className="flex items-start gap-3 pr-6">
                <div className="shrink-0 w-8 h-8 rounded-md bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
                  <Sparkles size={16} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-foreground mb-0.5">
                    Enhance your transcriptions with AI
                  </p>
                  <p className="text-[12px] text-muted-foreground mb-2">
                    Automatically fix grammar, punctuation, and formatting as you speak.
                  </p>
                  <Button
                    variant="default"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => {
                      setSettingsSection("aiModels");
                      setShowSettings(true);
                    }}
                  >
                    Enable AI Enhancement
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border bg-card/50 dark:bg-card/30 backdrop-blur-sm">
            <div className="border-b border-border/50 p-3 space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <Input
                  data-testid="history-search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search text, provider, model…"
                  className="h-8 text-xs"
                />
                <select
                  data-testid="history-filter-mode"
                  value={modeFilter}
                  onChange={(event) => setModeFilter(event.target.value as typeof modeFilter)}
                  className="h-8 px-2 rounded-md border border-border bg-background text-xs text-foreground"
                >
                  <option value="all">All modes</option>
                  <option value="insert">Insert</option>
                  <option value="clipboard">Clipboard</option>
                  <option value="file">File</option>
                </select>
                <select
                  data-testid="history-filter-status"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                  className="h-8 px-2 rounded-md border border-border bg-background text-xs text-foreground"
                >
                  <option value="all">All statuses</option>
                  <option value="success">Success</option>
                  <option value="error">Error</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <select
                  data-testid="history-filter-provider"
                  value={providerFilter}
                  onChange={(event) => setProviderFilter(event.target.value)}
                  className="h-8 px-2 rounded-md border border-border bg-background text-xs text-foreground"
                >
                  <option value="all">All providers</option>
                  {providerOptions.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  Workspace view with raw/clean copy and per-session diagnostics.
                </p>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => exportTranscriptions("json")}
                    disabled={isExporting || history.length === 0}
                  >
                    <Download size={12} className="mr-1" />
                    Export JSON
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => exportTranscriptions("csv")}
                    disabled={isExporting || history.length === 0}
                  >
                    <Download size={12} className="mr-1" />
                    Export CSV
                  </Button>
                </div>
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 size={14} className="animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Loading…</span>
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4">
                <div className="w-10 h-10 rounded-md bg-muted/50 dark:bg-white/4 flex items-center justify-center mb-3">
                  <Mic size={18} className="text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground mb-3">No transcriptions yet</p>
                <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <span>Press</span>
                  <kbd className="inline-flex items-center h-5 px-1.5 rounded-sm bg-surface-1 dark:bg-white/6 border border-border text-[11px] font-mono font-medium">
                    {formatHotkeyLabel(hotkey)}
                  </kbd>
                  <span>to start</span>
                </div>
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4">
                <p className="text-sm text-muted-foreground">No matching dictations.</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-7 px-2 text-[11px]"
                  onClick={() => {
                    setSearchQuery("");
                    setModeFilter("all");
                    setStatusFilter("all");
                    setProviderFilter("all");
                  }}
                >
                  Reset filters
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border/50 max-h-[calc(100vh-240px)] overflow-y-auto">
                {filteredHistory.map((item, index) => (
                  <TranscriptionItem
                    key={item.id}
                    item={item}
                    index={index}
                    total={filteredHistory.length}
                    onCopyClean={(text) => copyToClipboard(text)}
                    onCopyRaw={(text) =>
                      copyToClipboard(text, {
                        title: "Raw Transcript Copied",
                        description: "Raw transcript copied to clipboard.",
                      })
                    }
                    onCopyDiagnostics={copyDiagnostics}
                    onDelete={deleteTranscription}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
