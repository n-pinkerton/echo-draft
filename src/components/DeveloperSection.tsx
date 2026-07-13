import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui/button";
import { FolderOpen, Copy, Check, ShieldAlert, Trash2 } from "lucide-react";
import { useToast } from "./ui/toastContext";
import { Toggle } from "./ui/toggle";
import { ConfirmDialog } from "./ui/dialog";
import logger from "../utils/logger";
import { DEBUG_MODE_STORAGE_KEY } from "../utils/branding";

export default function DeveloperSection() {
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [logsDir, setLogsDir] = useState<string | null>(null);
  const [logsDirSource, setLogsDirSource] = useState<string | null>(null);
  const [fileLoggingEnabled, setFileLoggingEnabled] = useState<boolean | null>(null);
  const [fileLoggingError, setFileLoggingError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isToggling, setIsToggling] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [enableDialogOpen, setEnableDialogOpen] = useState(false);
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const { toast } = useToast();

  const loadDebugState = useCallback(async () => {
    try {
      setIsLoading(true);
      const state = await window.electronAPI.getDebugState();
      setDebugEnabled(state.enabled);
      localStorage.setItem(DEBUG_MODE_STORAGE_KEY, String(Boolean(state.enabled)));
      setLogPath(state.logPath);
      setLogsDir(state.logsDir || null);
      setLogsDirSource(state.logsDirSource || null);
      setFileLoggingEnabled(
        typeof state.fileLoggingEnabled === "boolean" ? state.fileLoggingEnabled : null
      );
      setFileLoggingError(
        typeof state.fileLoggingError === "string" ? state.fileLoggingError : null
      );
    } catch (error) {
      console.error("Failed to load debug state:", error);
      toast({
        title: "Error loading debug state",
        description: `Could not retrieve debug logging status: ${error}`,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadDebugState();
  }, [loadDebugState]);

  const setDebugLogging = async (newState: boolean) => {
    if (isToggling) return;

    try {
      setIsToggling(true);
      const result = await window.electronAPI.setDebugLogging(newState);

      if (!result.success) {
        throw new Error(result.error || "Failed to update debug logging");
      }

      setDebugEnabled(newState);
      localStorage.setItem(DEBUG_MODE_STORAGE_KEY, String(newState));
      logger.refreshLogLevel();
      await loadDebugState();

      toast({
        title: newState ? "Debug Logging Enabled" : "Debug Logging Disabled",
        description: newState
          ? "Detailed logs are now being written to disk"
          : "Debug logging has been turned off",
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to toggle debug logging: ${error}`,
        variant: "destructive",
      });
    } finally {
      setIsToggling(false);
    }
  };

  const handleToggleDebug = (nextState: boolean) => {
    if (nextState) {
      setEnableDialogOpen(true);
      return;
    }
    void setDebugLogging(false);
  };

  const handleOpenLogsFolder = async () => {
    try {
      const result = await window.electronAPI.openLogsFolder();
      if (!result.success) {
        throw new Error(result.error || "Failed to open folder");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to open logs folder: ${error}`,
        variant: "destructive",
      });
    }
  };

  const handleCopyPath = async () => {
    if (!logPath) return;

    try {
      await navigator.clipboard.writeText(logPath);
      setCopiedPath(true);
      toast({
        title: "Copied",
        description: "Log file path copied to clipboard",
        variant: "success",
        duration: 2000,
      });
      setTimeout(() => setCopiedPath(false), 2000);
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Could not copy path to clipboard",
        variant: "destructive",
      });
    }
  };

  const handlePurgeDebugArtifacts = async () => {
    if (isPurging) return;

    try {
      setIsPurging(true);
      const result = await window.electronAPI.purgeDebugArtifacts();
      if (!result.success) {
        throw new Error(result.error || "Some debug artifacts could not be deleted");
      }

      const filesDeleted = result.filesDeleted || 0;
      const bytesDeleted = result.bytesDeleted || 0;
      const formattedBytes =
        bytesDeleted >= 1024 * 1024
          ? `${(bytesDeleted / (1024 * 1024)).toFixed(1)} MB`
          : bytesDeleted >= 1024
            ? `${Math.ceil(bytesDeleted / 1024)} KB`
            : `${bytesDeleted} bytes`;

      await loadDebugState();
      toast({
        title: "Diagnostic data deleted",
        description:
          filesDeleted > 0
            ? `Deleted ${filesDeleted} file${filesDeleted === 1 ? "" : "s"} (${formattedBytes}).${
                result.freshLogStarted ? " A fresh log was started because debug mode is on." : ""
              }`
            : "No EchoDraft diagnostic files were found.",
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Cleanup incomplete",
        description: `Could not delete all diagnostic data: ${error}`,
        variant: "destructive",
      });
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="mb-5">
        <h3 className="text-[15px] font-semibold text-foreground tracking-tight">Debug Logging</h3>
        <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
          Capture detailed logs to help diagnose issues
        </p>
      </div>

      {/* Debug Toggle */}
      <div className="rounded-xl border border-border/60 dark:border-border-subtle bg-card dark:bg-surface-2 divide-y divide-border/40 dark:divide-border-subtle">
        <div className="px-5 py-4">
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p id="debug-mode-label" className="text-[13px] font-medium text-foreground">
                  Debug mode
                </p>
                <div
                  className={`h-1.5 w-1.5 rounded-full transition-colors ${
                    debugEnabled ? "bg-success" : "bg-muted-foreground/30"
                  }`}
                />
              </div>
              <p
                id="debug-mode-description"
                className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed"
              >
                {debugEnabled
                  ? "Capturing detailed diagnostics and up to 10 recent input recordings on this computer"
                  : "Enable to capture detailed diagnostic information (writes to disk)"}
              </p>
            </div>
            <div className="shrink-0">
              <Toggle
                checked={debugEnabled}
                onChange={handleToggleDebug}
                disabled={isLoading || isToggling}
                ariaLabel="Enable debug logging and voice recording capture"
                ariaDescribedBy="debug-mode-description debug-privacy-warning"
              />
            </div>
          </div>
        </div>

        {/* Privacy warning is intentionally visible before debug capture is enabled. */}
        <div className="px-5 py-4">
          <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 dark:bg-warning/10 p-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <div id="debug-privacy-warning">
              <p className="text-[12px] font-medium text-warning-text">
                Stores sensitive diagnostic data
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                Debug mode stores logs that may include dictated text and up to 10 recent input
                recordings containing your voice. Delete this data when troubleshooting is finished.
              </p>
            </div>
          </div>
        </div>

        {debugEnabled && (
          <div className="px-5 py-4 space-y-3">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-2">
                Logs folder
              </p>
              <code className="block text-[11px] text-muted-foreground font-mono break-all leading-relaxed bg-muted/30 dark:bg-surface-raised/30 px-3 py-2 rounded-lg border border-border/30">
                {logsDir || "(not available)"}
                {logsDirSource ? ` (${logsDirSource})` : ""}
              </code>
            </div>

            <div>
              <p className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-2">
                Current log file
              </p>
              {logPath ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[11px] text-muted-foreground font-mono break-all leading-relaxed bg-muted/30 dark:bg-surface-raised/30 px-3 py-2 rounded-lg border border-border/30">
                    {logPath}
                  </code>
                  <Button
                    onClick={handleCopyPath}
                    aria-label="Copy current log file path"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 h-8 w-8 p-0"
                  >
                    {copiedPath ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground leading-relaxed">
                  No daily log file has been created yet.
                </p>
              )}
            </div>

            {fileLoggingError && (
              <div className="rounded-lg border border-warning/20 bg-warning/5 dark:bg-warning/10 p-3">
                <p className="text-[12px] font-medium text-warning-text">Log file error</p>
                <p className="text-[12px] text-muted-foreground mt-1 break-words">
                  {fileLoggingError}
                </p>
              </div>
            )}

            {fileLoggingEnabled === false && !fileLoggingError && (
              <div className="rounded-lg border border-warning/20 bg-warning/5 dark:bg-warning/10 p-3">
                <p className="text-[12px] font-medium text-warning-text">Log file status</p>
                <p className="text-[12px] text-muted-foreground mt-1 break-words">
                  Debug mode is enabled, but file logging is not active yet.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button
            onClick={handleOpenLogsFolder}
            variant="outline"
            size="sm"
            className="w-full"
            disabled={!logsDir}
          >
            <FolderOpen className="mr-2 h-3.5 w-3.5" />
            Open Logs Folder
          </Button>
          <Button
            onClick={() => setPurgeDialogOpen(true)}
            variant="outline"
            size="sm"
            className="w-full text-destructive hover:text-destructive"
            disabled={isPurging}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            {isPurging ? "Deleting…" : "Delete Diagnostic Data"}
          </Button>
        </div>
      </div>

      {/* What gets logged */}
      <div>
        <div className="mb-5">
          <h3 className="text-[15px] font-semibold text-foreground tracking-tight">
            What gets logged
          </h3>
        </div>
        <div className="rounded-xl border border-border/60 dark:border-border-subtle bg-card dark:bg-surface-2">
          <div className="px-5 py-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {[
                "Audio processing",
                "API requests",
                "Recent input audio (up to 10)",
                "FFmpeg operations",
                "System diagnostics",
                "Transcription pipeline",
                "Error details",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <div className="h-1 w-1 rounded-full bg-muted-foreground/30 shrink-0" />
                  <span className="text-[12px] text-muted-foreground">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Performance note — conditional */}
      {debugEnabled && (
        <div className="rounded-xl border border-warning/20 bg-warning/5 dark:bg-warning/10">
          <div className="px-5 py-4">
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              <span className="font-medium text-warning-text">Note</span> — Debug logging writes to
              disk continuously and may slightly affect performance. Disable when not
              troubleshooting.
            </p>
          </div>
        </div>
      )}

      {/* Sharing instructions — conditional */}
      {debugEnabled && (
        <div>
          <div className="mb-5">
            <h3 className="text-[15px] font-semibold text-foreground tracking-tight">
              Sharing logs for support
            </h3>
          </div>
          <div className="rounded-xl border border-border/60 dark:border-border-subtle bg-card dark:bg-surface-2">
            <div className="px-5 py-4">
              <div className="space-y-2">
                {[
                  "Reproduce the issue while debug mode is enabled",
                  'Click "Open Logs Folder" above',
                  "Attach the most recent log file to your bug report",
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="shrink-0 text-[11px] font-mono text-muted-foreground/40 mt-0.5 w-4 text-right">
                      {i + 1}
                    </span>
                    <p className="text-[12px] text-muted-foreground leading-relaxed">{step}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground/40 mt-4 pt-3 border-t border-border/20">
                Logs may contain transcribed text and other sensitive data. Share only with trusted
                support.
              </p>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={enableDialogOpen}
        onOpenChange={setEnableDialogOpen}
        title="Enable sensitive diagnostics?"
        description="Debug mode writes detailed logs and keeps up to 10 recent input recordings containing your voice on this computer. Enable it only while troubleshooting, then turn it off and delete the diagnostic data."
        confirmText="Enable Debug Mode"
        cancelText="Cancel"
        onConfirm={() => void setDebugLogging(true)}
      />

      <ConfirmDialog
        open={purgeDialogOpen}
        onOpenChange={setPurgeDialogOpen}
        title="Delete diagnostic data?"
        description="This permanently deletes EchoDraft daily logs and captured debug recordings from its verified logs folders. Other files are left untouched. If debug mode remains on, EchoDraft starts a fresh log."
        confirmText="Delete Data"
        cancelText="Keep Data"
        variant="destructive"
        onConfirm={() => void handlePurgeDebugArtifacts()}
      />
    </div>
  );
}
