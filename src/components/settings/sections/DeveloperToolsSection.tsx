import { useCallback, useState } from "react";
import { FolderOpen } from "lucide-react";

import DeveloperSection from "../../DeveloperSection";
import { Button } from "../../ui/button";
import { SettingsRow } from "../../ui/SettingsSection";
import { SectionHeader, SettingsPanel, SettingsPanelRow } from "../SettingsPanels";
import type { AlertDialogState, ConfirmDialogState } from "../../../hooks/useDialogs";

type Props = {
  showConfirmDialog: (options: Omit<ConfirmDialogState, "open">) => void;
  showAlertDialog: (options: Omit<AlertDialogState, "open">) => void;
};

export default function DeveloperToolsSection(props: Props) {
  const { showConfirmDialog, showAlertDialog } = props;
  const [isRemovingModels, setIsRemovingModels] = useState(false);
  const cachePathHint =
    typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
      ? "%USERPROFILE%\\.cache\\openwhispr\\whisper-models"
      : "~/.cache/openwhispr/whisper-models";

  const handleRemoveModels = useCallback(() => {
    if (isRemovingModels) return;

    showConfirmDialog({
      title: "Remove downloaded models?",
      description: `This deletes all locally cached Whisper models (${cachePathHint}) and frees disk space. You can download them again from the model picker.`,
      confirmText: "Delete Models",
      variant: "destructive",
      onConfirm: () => {
        setIsRemovingModels(true);
        window.electronAPI
          ?.deleteAllWhisperModels?.()
          .then((result) => {
            if (!result?.success) {
              showAlertDialog({
                title: "Unable to Remove Models",
                description:
                  result?.error || "Something went wrong while deleting the cached models.",
              });
              return;
            }

            window.dispatchEvent(new Event("openwhispr-models-cleared"));

            showAlertDialog({
              title: "Models Removed",
              description:
                "All downloaded Whisper models were deleted. You can re-download any model from the picker when needed.",
            });
          })
          .catch((error) => {
            showAlertDialog({
              title: "Unable to Remove Models",
              description: error?.message || "An unknown error occurred.",
            });
          })
          .finally(() => {
            setIsRemovingModels(false);
          });
      },
    });
  }, [cachePathHint, isRemovingModels, showAlertDialog, showConfirmDialog]);

  return (
    <div className="space-y-6">
      <DeveloperSection />

      {/* Data Management — moved from General */}
      <div className="border-t border-border/40 pt-8">
        <SectionHeader title="Data Management" description="Manage cached models and app data" />

        <div className="space-y-4">
          <SettingsPanel>
            <SettingsPanelRow>
              <SettingsRow label="Model cache" description={cachePathHint}>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => window.electronAPI?.openWhisperModelsFolder?.()}
                  >
                    <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                    Open
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleRemoveModels}
                    disabled={isRemovingModels}
                  >
                    {isRemovingModels ? "Removing..." : "Clear Cache"}
                  </Button>
                </div>
              </SettingsRow>
            </SettingsPanelRow>
          </SettingsPanel>

          <SettingsPanel>
            <SettingsPanelRow>
              <SettingsRow
                label="Reset app data"
                description="Permanently delete all settings, transcriptions, and cached data"
              >
                <Button
                  onClick={() => {
                    showConfirmDialog({
                      title: "Reset All App Data",
                      description:
                        "This will permanently delete ALL EchoDraft data including:\n\n- Database and transcriptions\n- Local storage settings\n- Downloaded models\n- Environment files\n\nYou will need to manually remove app permissions in System Settings.\n\nThis action cannot be undone.",
                      onConfirm: () => {
                        window.electronAPI
                          ?.cleanupApp()
                          .then(() => {
                            showAlertDialog({
                              title: "Reset Complete",
                              description: "All app data has been removed. The app will reload.",
                            });
                            setTimeout(() => {
                              window.location.reload();
                            }, 1000);
                          })
                          .catch((error) => {
                            showAlertDialog({
                              title: "Reset Failed",
                              description: `Failed to reset: ${error.message}`,
                            });
                          });
                      },
                      variant: "destructive",
                      confirmText: "Delete Everything",
                    });
                  }}
                  variant="outline"
                  size="sm"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:border-destructive"
                >
                  Reset
                </Button>
              </SettingsRow>
            </SettingsPanelRow>
          </SettingsPanel>
        </div>
      </div>
    </div>
  );
}

