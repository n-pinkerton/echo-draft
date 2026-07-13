import { useEffect, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";

import { useUpdater } from "../../../../hooks/useUpdater";
import { Badge } from "../../../ui/badge";
import { Button } from "../../../ui/button";
import MarkdownRenderer from "../../../ui/MarkdownRenderer";
import { SettingsRow } from "../../../ui/SettingsSection";
import type { AlertDialogState, ConfirmDialogState } from "../../../../hooks/useDialogs";
import { SectionHeader, SettingsPanel, SettingsPanelRow } from "../../SettingsPanels";

type Props = {
  showConfirmDialog: (options: Omit<ConfirmDialogState, "open">) => void;
  showAlertDialog: (options: Omit<AlertDialogState, "open">) => void;
};

export default function UpdatesSection(props: Props) {
  const { showAlertDialog, showConfirmDialog } = props;
  const installTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>("");

  const {
    status: updateStatus,
    info: updateInfo,
    downloadProgress: updateDownloadProgress,
    isChecking: hookCheckingForUpdates,
    isDownloading: downloadingUpdate,
    isInstalling: installInitiated,
    isInitialized: updateStatusInitialized,
    isInitializing: updateStatusLoading,
    checkForUpdates,
    downloadUpdate,
    installUpdate: installUpdateAction,
    getAppVersion,
    error: updateError,
  } = useUpdater();

  const isUpdateAvailable =
    updateStatus.updatesEnabled &&
    !updateStatus.isDevelopment &&
    (updateStatus.updateAvailable || updateStatus.updateDownloaded);
  const checkingForUpdates = hookCheckingForUpdates || updateStatus.isChecking;
  const hasCheckedForUpdates = updateStatus.hasCheckedForUpdates === true;

  useEffect(() => {
    let mounted = true;

    const timer = setTimeout(async () => {
      if (!mounted) return;
      const version = await getAppVersion();
      if (version && mounted) setCurrentVersion(version);
    }, 100);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [getAppVersion]);

  useEffect(() => {
    if (installInitiated) {
      if (installTimeoutRef.current) {
        clearTimeout(installTimeoutRef.current);
      }
      installTimeoutRef.current = setTimeout(() => {
        showAlertDialog({
          title: "Still Running",
          description:
            "EchoDraft didn't restart automatically. Please quit the app manually to finish installing the update.",
        });
      }, 10000);
    } else if (installTimeoutRef.current) {
      clearTimeout(installTimeoutRef.current);
      installTimeoutRef.current = null;
    }

    return () => {
      if (installTimeoutRef.current) {
        clearTimeout(installTimeoutRef.current);
        installTimeoutRef.current = null;
      }
    };
  }, [installInitiated, showAlertDialog]);

  return (
    <div>
      <SectionHeader title="Updates" />
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow
            label="Current version"
            description={
              updateStatusLoading || !updateStatusInitialized
                ? "Checking update status..."
                : updateError
                  ? "Update status is unavailable. Try again later or download updates manually."
                  : updateStatus.isDevelopment
                    ? "Running in development mode"
                    : !updateStatus.updatesEnabled
                      ? updateStatus.disabledReason || "Automatic updates are unavailable"
                      : checkingForUpdates
                        ? "Checking for updates..."
                        : isUpdateAvailable
                          ? "A newer version is available"
                          : !hasCheckedForUpdates
                            ? "Updates have not been checked yet"
                            : "You're on the latest version"
            }
          >
            <div className="flex items-center gap-2.5">
              <span className="text-[13px] tabular-nums text-muted-foreground font-mono">
                {currentVersion || "..."}
              </span>
              {updateStatusLoading || !updateStatusInitialized ? (
                <Badge variant="outline">Loading</Badge>
              ) : updateError ? (
                <Badge variant="warning">Unavailable</Badge>
              ) : updateStatus.isDevelopment ? (
                <Badge variant="warning">Dev</Badge>
              ) : !updateStatus.updatesEnabled ? (
                <Badge variant="warning">Manual</Badge>
              ) : checkingForUpdates ? (
                <Badge variant="outline">Checking</Badge>
              ) : isUpdateAvailable ? (
                <Badge variant="success">Update</Badge>
              ) : !hasCheckedForUpdates ? (
                <Badge variant="outline">Not checked</Badge>
              ) : (
                <Badge variant="outline">Latest</Badge>
              )}
            </div>
          </SettingsRow>
        </SettingsPanelRow>

        <SettingsPanelRow>
          <div className="space-y-2.5">
            <Button
              onClick={async () => {
                try {
                  const result = await checkForUpdates();
                  if (result?.updateAvailable) {
                    showAlertDialog({
                      title: "Update Available",
                      description: `Update available: v${result.version || "new version"}`,
                    });
                  } else {
                    showAlertDialog({
                      title: "No Updates",
                      description: result?.message || "No updates available",
                    });
                  }
                } catch {
                  // The control panel owns the single update-error presentation.
                }
              }}
              disabled={
                updateStatusLoading ||
                !updateStatusInitialized ||
                checkingForUpdates ||
                updateStatus.isDevelopment ||
                !updateStatus.updatesEnabled
              }
              variant="outline"
              className="w-full"
              size="sm"
            >
              <RefreshCw
                size={13}
                className={`mr-1.5 ${checkingForUpdates ? "animate-spin" : ""}`}
              />
              {checkingForUpdates ? "Checking..." : "Check for Updates"}
            </Button>

            {isUpdateAvailable && !updateStatus.updateDownloaded && (
              <div className="space-y-2">
                <Button
                  onClick={async () => {
                    try {
                      await downloadUpdate();
                    } catch {
                      // The control panel owns the single update-error presentation.
                    }
                  }}
                  disabled={updateStatusLoading || downloadingUpdate}
                  variant="success"
                  className="w-full"
                  size="sm"
                >
                  <Download
                    size={13}
                    className={`mr-1.5 ${downloadingUpdate ? "animate-pulse" : ""}`}
                  />
                  {downloadingUpdate
                    ? `Downloading... ${Math.round(updateDownloadProgress)}%`
                    : `Download Update${updateInfo?.version ? ` v${updateInfo.version}` : ""}`}
                </Button>

                {downloadingUpdate && (
                  <div className="h-1 w-full overflow-hidden rounded-full bg-muted/50">
                    <div
                      className="h-full bg-success transition-all duration-200 rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(0, updateDownloadProgress))}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {updateStatus.updateDownloaded && (
              <Button
                onClick={() => {
                  showConfirmDialog({
                    title: "Install Update",
                    description: `Ready to install update${updateInfo?.version ? ` v${updateInfo.version}` : ""}. The app will restart to complete installation.`,
                    confirmText: "Install & Restart",
                    onConfirm: async () => {
                      try {
                        await installUpdateAction();
                      } catch {
                        // The control panel owns the single update-error presentation.
                      }
                    },
                  });
                }}
                disabled={updateStatusLoading || installInitiated}
                className="w-full"
                size="sm"
              >
                <RefreshCw size={14} className={`mr-2 ${installInitiated ? "animate-spin" : ""}`} />
                {installInitiated ? "Restarting..." : "Install & Restart"}
              </Button>
            )}

            {(!updateStatus.updatesEnabled || updateError) && (
              <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
                <p>
                  Use the Windows <strong>Setup</strong> download for a normal upgrade. The portable
                  build runs separately and does not replace an installed copy.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full"
                  onClick={async () => {
                    try {
                      await window.electronAPI.openVerifiedReleases();
                    } catch {
                      showAlertDialog({
                        title: "Could Not Open Releases",
                        description:
                          "Open GitHub and go to n-pinkerton/echo-draft/releases to download the verified Setup file.",
                      });
                    }
                  }}
                >
                  Open verified releases
                </Button>
              </div>
            )}
          </div>

          {updateInfo?.releaseNotes && (
            <div className="mt-4 pt-4 border-t border-border/30">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                What's new in v{updateInfo.version}
              </p>
              <div className="text-[12px] text-muted-foreground">
                <MarkdownRenderer content={updateInfo.releaseNotes} />
              </div>
            </div>
          )}
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}
