import type { UsePermissionsReturn } from "../../hooks/usePermissions";
import { Check, Mic, Shield } from "lucide-react";
import LanguageSelector from "../ui/LanguageSelector";
import PermissionCard from "../ui/PermissionCard";
import MicPermissionWarning from "../ui/MicPermissionWarning";
import PasteToolsInfo from "../ui/PasteToolsInfo";

export function SignedInSetupStep({
  preferredLanguage,
  onPreferredLanguageChange,
  permissions,
}: {
  preferredLanguage: string;
  onPreferredLanguageChange: (value: string) => void;
  permissions: UsePermissionsReturn;
}) {
  const platform = permissions.pasteToolsInfo?.platform;
  const isMacOS = platform === "darwin";

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Check className="w-7 h-7 text-emerald-600" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">Setup</h2>
        <p className="text-muted-foreground">Choose your language and grant permissions</p>
      </div>

      {/* Language Selector */}
      <div className="space-y-2.5 p-3 bg-muted/50 border border-border/60 rounded">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">Language</label>
          <LanguageSelector
            value={preferredLanguage}
            onChange={onPreferredLanguageChange}
            className="w-full"
          />
        </div>
      </div>

      {/* Permissions */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Permissions</h3>
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
    </div>
  );
}

