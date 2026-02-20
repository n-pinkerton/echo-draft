import { Mic, Shield } from "lucide-react";

import MicPermissionWarning from "../../ui/MicPermissionWarning";
import PasteToolsInfo from "../../ui/PasteToolsInfo";
import PermissionCard from "../../ui/PermissionCard";
import { SectionHeader, SettingsPanel, SettingsPanelRow } from "../SettingsPanels";
import { SettingsRow } from "../../ui/SettingsSection";
import { Button } from "../../ui/button";
import type { ConfirmDialogState } from "../../../hooks/useDialogs";

type PermissionsHook = {
  micPermissionGranted: boolean;
  micPermissionError: string | null;
  accessibilityPermissionGranted: boolean;
  pasteToolsInfo: any;
  isCheckingPasteTools: boolean;
  requestMicPermission: () => void | Promise<void>;
  openMicPrivacySettings: () => void;
  openSoundInputSettings: () => void;
  testAccessibilityPermission: () => void | Promise<void>;
  openAccessibilitySettings: () => void;
  checkPasteToolsAvailability: () => unknown | Promise<unknown>;
};

type Props = {
  platform: string;
  permissionsHook: PermissionsHook;
  showConfirmDialog: (options: Omit<ConfirmDialogState, "open">) => void;
};

export default function PermissionsSection(props: Props) {
  const { platform, permissionsHook, showConfirmDialog } = props;

  const resetAccessibilityPermissions = () => {
    const message = `To fix accessibility permissions:\n\n1. Open System Settings > Privacy & Security > Accessibility\n2. Remove any old EchoDraft or Electron entries\n3. Click (+) and add the current EchoDraft app\n4. Make sure the checkbox is enabled\n5. Restart EchoDraft\n\nClick OK to open System Settings.`;

    showConfirmDialog({
      title: "Reset Accessibility Permissions",
      description: message,
      onConfirm: () => {
        permissionsHook.openAccessibilitySettings();
      },
    });
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Permissions"
        description="Test and manage system permissions required for EchoDraft to function correctly"
      />

      {/* Permission Cards - matching onboarding style */}
      <div className="space-y-3">
        <PermissionCard
          icon={Mic}
          title="Microphone"
          description="Required for voice recording and dictation"
          granted={permissionsHook.micPermissionGranted}
          onRequest={permissionsHook.requestMicPermission}
          buttonText="Test"
          onOpenSettings={permissionsHook.openMicPrivacySettings}
        />

        {platform === "darwin" && (
          <PermissionCard
            icon={Shield}
            title="Accessibility"
            description="Required for auto-paste to work after transcription"
            granted={permissionsHook.accessibilityPermissionGranted}
            onRequest={permissionsHook.testAccessibilityPermission}
            buttonText="Test & Grant"
            onOpenSettings={permissionsHook.openAccessibilitySettings}
          />
        )}
      </div>

      {/* Error state for microphone */}
      {!permissionsHook.micPermissionGranted && permissionsHook.micPermissionError && (
        <MicPermissionWarning
          error={permissionsHook.micPermissionError}
          onOpenSoundSettings={permissionsHook.openSoundInputSettings}
          onOpenPrivacySettings={permissionsHook.openMicPrivacySettings}
        />
      )}

      {/* Linux paste tools info */}
      {platform === "linux" &&
        permissionsHook.pasteToolsInfo &&
        !permissionsHook.pasteToolsInfo.available && (
          <PasteToolsInfo
            pasteToolsInfo={permissionsHook.pasteToolsInfo}
            isChecking={permissionsHook.isCheckingPasteTools}
            onCheck={permissionsHook.checkPasteToolsAvailability}
          />
        )}

      {/* Troubleshooting section for macOS */}
      {platform === "darwin" && (
        <div>
          <p className="text-[13px] font-medium text-foreground mb-3">Troubleshooting</p>
          <SettingsPanel>
            <SettingsPanelRow>
              <SettingsRow
                label="Reset accessibility permissions"
                description="Fix issues after reinstalling or rebuilding the app by removing and re-adding EchoDraft in System Settings"
              >
                <Button
                  onClick={resetAccessibilityPermissions}
                  variant="ghost"
                  size="sm"
                  className="text-foreground/70 hover:text-foreground"
                >
                  Troubleshoot
                </Button>
              </SettingsRow>
            </SettingsPanelRow>
          </SettingsPanel>
        </div>
      )}
    </div>
  );
}
