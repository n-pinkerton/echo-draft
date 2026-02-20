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
    isChecking: checkingForUpdates,
    isDownloading: downloadingUpdate,
    isInstalling: installInitiated,
    checkForUpdates,
    downloadUpdate,
    installUpdate: installUpdateAction,
    getAppVersion,
    error: updateError,
  } = useUpdater();

  const isUpdateAvailable =
    !updateStatus.isDevelopment && (updateStatus.updateAvailable || updateStatus.updateDownloaded);

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
    if (updateError) {
      showAlertDialog({
        title: "Update Error",
        description:
          updateError.message ||
          "The updater encountered a problem. Please try again or download the latest release manually.",
      });
    }
  }, [updateError, showAlertDialog]);

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
              updateStatus.isDevelopment
                ? "Running in development mode"
                : isUpdateAvailable
                  ? "A newer version is available"
                  : "You're on the latest version"
            }
          >
            <div className="flex items-center gap-2.5">
              <span className="text-[13px] tabular-nums text-muted-foreground font-mono">
                {currentVersion || "..."}
              </span>
              {updateStatus.isDevelopment ? (
                <Badge variant="warning">Dev</Badge>
              ) : isUpdateAvailable ? (
                <Badge variant="success">Update</Badge>
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
                } catch (error: any) {
                  showAlertDialog({
                    title: "Update Check Failed",
                    description: `Error checking for updates: ${error.message}`,
                  });
                }
              }}
              disabled={checkingForUpdates || updateStatus.isDevelopment}
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
                    } catch (error: any) {
                      showAlertDialog({
                        title: "Download Failed",
                        description: `Failed to download update: ${error.message}`,
                      });
                    }
                  }}
                  disabled={downloadingUpdate}
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
                      } catch (error: any) {
                        showAlertDialog({
                          title: "Install Failed",
                          description: `Failed to install update: ${error.message}`,
                        });
                      }
                    },
                  });
                }}
                disabled={installInitiated}
                className="w-full"
                size="sm"
              >
                <RefreshCw
                  size={14}
                  className={`mr-2 ${installInitiated ? "animate-spin" : ""}`}
                />
                {installInitiated ? "Restarting..." : "Install & Restart"}
              </Button>
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

