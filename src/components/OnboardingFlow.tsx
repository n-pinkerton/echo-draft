import { useCallback, useState } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { ChevronRight, ChevronLeft, Check } from "lucide-react";
import TitleBar from "./TitleBar";
import SupportDropdown from "./ui/SupportDropdown";
import StepProgress from "./ui/StepProgress";
import { AlertDialog, ConfirmDialog } from "./ui/dialog";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useDialogs } from "../hooks/useDialogs";
import { usePermissions } from "../hooks/usePermissions";
import { useClipboard } from "../hooks/useClipboard";
import { useSettings } from "../hooks/useSettings";
import { getAgentName, setAgentNameIfEmpty } from "../utils/agentName";
import { formatHotkeyLabel, getDefaultHotkey } from "../utils/hotkeys";
import { useAuth } from "../hooks/useAuth";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { getValidationMessage } from "../utils/hotkeyValidator";
import { getPlatform } from "../utils/platform";
import { canProceed } from "./onboardingFlow/canProceed";
import { OnboardingStepContent } from "./onboardingFlow/OnboardingStepContent";
import { getActivationStepIndex, getOnboardingSteps } from "./onboardingFlow/onboardingSteps";
import { useAutoRegisterDefaultHotkey } from "./onboardingFlow/useAutoRegisterDefaultHotkey";
import { useGnomeHotkeyMode } from "./onboardingFlow/useGnomeHotkeyMode";
import { useGoogleFont } from "./onboardingFlow/useGoogleFont";
import { useGuestTranscriptionPickerProps } from "./onboardingFlow/useGuestTranscriptionPickerProps";
import { useLocalModelDownloadedStatus } from "./onboardingFlow/useLocalModelDownloadedStatus";

interface OnboardingFlowProps {
  onComplete: () => void;
}

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const { isSignedIn } = useAuth();
  const settings = useSettings();

  const [skipAuth, setSkipAuth] = useState(false);
  const isSignedInFlow = isSignedIn && !skipAuth;
  const steps = getOnboardingSteps(isSignedInFlow);

  const [currentStep, setCurrentStep, removeCurrentStep] = useLocalStorage(
    "onboardingCurrentStep",
    0,
    {
      serialize: String,
      deserialize: (value) => {
        const parsed = parseInt(value, 10);
        // Clamp to valid range to handle users upgrading from older versions
        // with different step counts
        if (isNaN(parsed) || parsed < 0) return 0;
        const maxStep = Math.max(0, steps.length - 1);
        if (parsed > maxStep) {
          return maxStep;
        }
        return parsed;
      },
    }
  );

  const [hotkey, setHotkey] = useState(settings.dictationKey || getDefaultHotkey());
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const readableHotkey = formatHotkeyLabel(hotkey);
  const { alertDialog, confirmDialog, showAlertDialog, hideAlertDialog, hideConfirmDialog } =
    useDialogs();

  const { registerHotkey, isRegistering: isHotkeyRegistering } = useHotkeyRegistration({
    onSuccess: (registeredHotkey) => {
      setHotkey(registeredHotkey);
      settings.setDictationKey(registeredHotkey);
    },
    showSuccessToast: false,
    showErrorToast: false,
  });

  const validateHotkeyForInput = useCallback(
    (hotkey: string) => getValidationMessage(hotkey, getPlatform()),
    []
  );

  const handleActivationHotkeyChange = useCallback(
    async (newHotkey: string) => {
      const success = await registerHotkey(newHotkey);
      if (success) {
        setHotkey(newHotkey);
      }
    },
    [registerHotkey]
  );

  const permissionsHook = usePermissions(showAlertDialog);
  useClipboard(showAlertDialog); // Initialize clipboard hook for permission checks

  // Only show progress for signed-up users after account creation step
  const showProgress = currentStep > 0;

  const isUsingGnomeHotkeys = useGnomeHotkeyMode(settings.setActivationMode);

  const isModelDownloaded = useLocalModelDownloadedStatus({
    useLocalWhisper: settings.useLocalWhisper,
    whisperModel: settings.whisperModel,
    parakeetModel: settings.parakeetModel,
    localTranscriptionProvider: settings.localTranscriptionProvider,
  });

  const activationStepIndex = getActivationStepIndex(isSignedInFlow);

  useAutoRegisterDefaultHotkey({
    currentStep,
    activationStepIndex,
    hotkey,
    registerHotkey,
    setHotkey,
  });

  const guestTranscriptionPickerProps = useGuestTranscriptionPickerProps({
    useLocalWhisper: settings.useLocalWhisper,
    whisperModel: settings.whisperModel,
    parakeetModel: settings.parakeetModel,
    localTranscriptionProvider: settings.localTranscriptionProvider,
    cloudTranscriptionProvider: settings.cloudTranscriptionProvider,
    cloudTranscriptionModel: settings.cloudTranscriptionModel,
    cloudTranscriptionBaseUrl: settings.cloudTranscriptionBaseUrl,
    openaiApiKey: settings.openaiApiKey,
    setOpenaiApiKey: settings.setOpenaiApiKey,
    groqApiKey: settings.groqApiKey,
    setGroqApiKey: settings.setGroqApiKey,
    mistralApiKey: settings.mistralApiKey,
    setMistralApiKey: settings.setMistralApiKey,
    customTranscriptionApiKey: settings.customTranscriptionApiKey,
    setCustomTranscriptionApiKey: settings.setCustomTranscriptionApiKey,
    updateTranscriptionSettings: settings.updateTranscriptionSettings,
  });

  const ensureHotkeyRegistered = useCallback(async () => {
    if (!window.electronAPI?.updateHotkey) {
      return true;
    }

    try {
      const result = await window.electronAPI.updateHotkey(hotkey);
      if (result && !result.success) {
        showAlertDialog({
          title: "Hotkey Not Registered",
          description:
            result.message || "We couldn't register that key. Please choose another hotkey.",
        });
        return false;
      }
      return true;
    } catch (error) {
      console.error("Failed to register onboarding hotkey", error);
      showAlertDialog({
        title: "Hotkey Error",
        description: "We couldn't register that key. Please choose another hotkey.",
      });
      return false;
    }
  }, [hotkey, showAlertDialog]);

  const saveSettings = useCallback(async () => {
    const hotkeyRegistered = await ensureHotkeyRegistered();
    if (!hotkeyRegistered) {
      return false;
    }
    settings.setDictationKey(hotkey);
    setAgentNameIfEmpty(getAgentName());

    const skippedAuth = skipAuth;
    localStorage.setItem("authenticationSkipped", skippedAuth.toString());
    localStorage.setItem("onboardingCompleted", "true");
    localStorage.setItem("skipAuth", skippedAuth.toString());

    try {
      await window.electronAPI?.saveAllKeysToEnv?.();
    } catch (error) {
      console.error("Failed to persist API keys:", error);
    }

    return true;
  }, [ensureHotkeyRegistered, hotkey, settings, skipAuth]);

  const nextStep = useCallback(async () => {
    if (currentStep >= steps.length - 1) {
      return;
    }

    const newStep = currentStep + 1;
    setCurrentStep(newStep);

    // Show dictation panel when entering activation step
    if (newStep === activationStepIndex) {
      if (window.electronAPI?.showDictationPanel) {
        window.electronAPI.showDictationPanel();
      }
    }
  }, [currentStep, setCurrentStep, steps.length, activationStepIndex]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      const newStep = currentStep - 1;
      setCurrentStep(newStep);
    }
  }, [currentStep, setCurrentStep]);

  const finishOnboarding = useCallback(async () => {
    const saved = await saveSettings();
    if (!saved) {
      return;
    }
    removeCurrentStep();
    onComplete();
  }, [saveSettings, removeCurrentStep, onComplete]);

  useGoogleFont(
    "https://fonts.googleapis.com/css2?family=Noto+Sans:wght@300;400;500;600;700&display=swap"
  );

  const canProceedToNextStep = canProceed({
    currentStep,
    isSignedIn,
    skipAuth,
    useLocalWhisper: settings.useLocalWhisper,
    localTranscriptionProvider: settings.localTranscriptionProvider,
    whisperModel: settings.whisperModel,
    parakeetModel: settings.parakeetModel,
    isModelDownloaded,
    cloudTranscriptionProvider: settings.cloudTranscriptionProvider,
    openaiApiKey: settings.openaiApiKey,
    groqApiKey: settings.groqApiKey,
    mistralApiKey: settings.mistralApiKey,
    hotkey,
    permissions: permissionsHook,
  });

  return (
    <div
      className="h-screen flex flex-col bg-background"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => !open && hideConfirmDialog()}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
        onConfirm={confirmDialog.onConfirm}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={(open) => !open && hideAlertDialog()}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      {/* Title Bar */}
      <div className="shrink-0 z-10">
        <TitleBar
          showTitle={true}
          className="bg-background backdrop-blur-xl border-b border-border shadow-sm"
          actions={isSignedIn ? <SupportDropdown /> : undefined}
        ></TitleBar>
      </div>

      {/* Progress Bar - hidden on welcome/auth step */}
      {showProgress && (
        <div className="shrink-0 bg-background/80 backdrop-blur-2xl border-b border-white/5 px-6 md:px-12 py-3 z-10">
          <div className="max-w-3xl mx-auto">
            <StepProgress steps={steps.slice(1)} currentStep={currentStep - 1} />
          </div>
        </div>
      )}

      {/* Content - This will grow to fill available space */}
      <div
        className={`flex-1 px-6 md:px-12 overflow-y-auto ${currentStep === 0 ? "flex items-center" : "py-6"}`}
      >
        <div className={`w-full ${currentStep === 0 ? "max-w-sm" : "max-w-3xl"} mx-auto`}>
          <Card className="bg-card/90 backdrop-blur-2xl border border-border/50 dark:border-white/5 shadow-lg rounded-xl overflow-hidden">
            <CardContent className={currentStep === 0 ? "p-6" : "p-6 md:p-8"}>
              <OnboardingStepContent
                currentStep={currentStep}
                isSignedIn={isSignedIn}
                skipAuth={skipAuth}
                pendingVerificationEmail={pendingVerificationEmail}
                setPendingVerificationEmail={setPendingVerificationEmail}
                nextStep={nextStep}
                permissions={permissionsHook}
                signedInSetup={{
                  preferredLanguage: settings.preferredLanguage,
                  onPreferredLanguageChange: (value) =>
                    settings.updateTranscriptionSettings({ preferredLanguage: value }),
                }}
                guestSetup={{
                  transcriptionPickerProps: guestTranscriptionPickerProps,
                  preferredLanguage: settings.preferredLanguage,
                  onPreferredLanguageChange: (value) =>
                    settings.updateTranscriptionSettings({ preferredLanguage: value }),
                }}
                activation={{
                  hotkey,
                  onHotkeyChange: handleActivationHotkeyChange,
                  isHotkeyRegistering,
                  validateHotkey: validateHotkeyForInput,
                  activationMode: settings.activationMode,
                  setActivationMode: settings.setActivationMode,
                  isUsingGnomeHotkeys,
                  readableHotkey,
                }}
                onContinueWithoutAccount={() => {
                  setSkipAuth(true);
                  nextStep();
                }}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer Navigation - hidden on welcome/auth step */}
      {showProgress && (
        <div className="shrink-0 bg-background/80 backdrop-blur-2xl border-t border-white/5 px-6 md:px-12 py-3 z-10">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            {/* Hide back button on first step for signed-in users */}
            {!(currentStep === 1 && isSignedIn && !skipAuth) && (
              <Button
                onClick={prevStep}
                variant="outline"
                disabled={currentStep === 0}
                className="h-8 px-5 rounded-full text-xs"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Back
              </Button>
            )}

            {/* Spacer to push next button to the right when back button is hidden */}
            {currentStep === 1 && isSignedIn && !skipAuth && <div />}

            <div className="flex items-center gap-2">
              {currentStep === steps.length - 1 ? (
                <Button
                  onClick={finishOnboarding}
                  disabled={!canProceedToNextStep}
                  variant="success"
                  className="h-8 px-6 rounded-full text-xs"
                >
                  <Check className="w-3.5 h-3.5" />
                  Complete
                </Button>
              ) : (
                <Button
                  onClick={nextStep}
                  disabled={!canProceedToNextStep}
                  className="h-8 px-6 rounded-full text-xs"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
