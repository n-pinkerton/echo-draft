import type { UsePermissionsReturn } from "../../hooks/usePermissions";
import { Mic, Shield } from "lucide-react";
import PermissionCard from "../ui/PermissionCard";
import MicPermissionWarning from "../ui/MicPermissionWarning";
import PasteToolsInfo from "../ui/PasteToolsInfo";

export function OnboardingPermissionsStep({ permissions }: { permissions: UsePermissionsReturn }) {
  const platform = permissions.pasteToolsInfo?.platform;
  const isMacOS = platform === "darwin";

  return (
    <div className="space-y-4">
      {/* Header - compact */}
      <div className="text-center">
        <h2 className="text-lg font-semibold text-foreground tracking-tight">Permissions</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {isMacOS ? "Required for EchoDraft to work" : "Microphone access required"}
        </p>
      </div>

      {/* Permission cards - tight stack */}
      <div className="space-y-1.5">
        <PermissionCard
          icon={Mic}
          title="Microphone"
          description="To capture your voice"
          granted={permissions.micPermissionGranted}
          onRequest={permissions.requestMicPermission}
          buttonText="Grant"
        />

        {isMacOS && (
          <PermissionCard
            icon={Shield}
            title="Accessibility"
            description="To paste text into apps"
            granted={permissions.accessibilityPermissionGranted}
            onRequest={permissions.testAccessibilityPermission}
            buttonText="Test & Grant"
            onOpenSettings={permissions.openAccessibilitySettings}
          />
        )}
      </div>

      {/* Error state - only show when there's actually an issue */}
      {!permissions.micPermissionGranted && permissions.micPermissionError && (
        <MicPermissionWarning
          error={permissions.micPermissionError}
          onOpenSoundSettings={permissions.openSoundInputSettings}
          onOpenPrivacySettings={permissions.openMicPrivacySettings}
        />
      )}

      {/* Linux paste tools - only when needed */}
      {platform === "linux" && permissions.pasteToolsInfo && !permissions.pasteToolsInfo.available && (
        <PasteToolsInfo
          pasteToolsInfo={permissions.pasteToolsInfo}
          isChecking={permissions.isCheckingPasteTools}
          onCheck={permissions.checkPasteToolsAvailability}
        />
      )}
    </div>
  );
}

