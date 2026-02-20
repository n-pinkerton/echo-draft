import type { UsePermissionsReturn } from "../../hooks/usePermissions";

type OnboardingCanProceedParams = {
  currentStep: number;
  isSignedIn: boolean;
  skipAuth: boolean;
  useLocalWhisper: boolean;
  localTranscriptionProvider: "whisper" | "nvidia" | string;
  whisperModel: string;
  parakeetModel: string;
  isModelDownloaded: boolean;
  cloudTranscriptionProvider: string;
  openaiApiKey: string;
  groqApiKey: string;
  mistralApiKey: string;
  hotkey: string;
  permissions: UsePermissionsReturn;
};

const canProceedOnPermissions = (permissions: UsePermissionsReturn): boolean => {
  if (!permissions.micPermissionGranted) {
    return false;
  }

  const currentPlatform = permissions.pasteToolsInfo?.platform;
  if (currentPlatform === "darwin") {
    return permissions.accessibilityPermissionGranted;
  }

  return true;
};

const canProceedOnGuestSetup = ({
  useLocalWhisper,
  localTranscriptionProvider,
  whisperModel,
  parakeetModel,
  isModelDownloaded,
  cloudTranscriptionProvider,
  openaiApiKey,
  groqApiKey,
  mistralApiKey,
}: Pick<
  OnboardingCanProceedParams,
  | "useLocalWhisper"
  | "localTranscriptionProvider"
  | "whisperModel"
  | "parakeetModel"
  | "isModelDownloaded"
  | "cloudTranscriptionProvider"
  | "openaiApiKey"
  | "groqApiKey"
  | "mistralApiKey"
>): boolean => {
  if (useLocalWhisper) {
    const modelToCheck = localTranscriptionProvider === "nvidia" ? parakeetModel : whisperModel;
    return modelToCheck.trim() !== "" && isModelDownloaded;
  }

  if (cloudTranscriptionProvider === "openai") {
    return openaiApiKey.trim().length > 0;
  }

  if (cloudTranscriptionProvider === "groq") {
    return groqApiKey.trim().length > 0;
  }

  if (cloudTranscriptionProvider === "mistral") {
    return mistralApiKey.trim().length > 0;
  }

  if (cloudTranscriptionProvider === "custom") {
    return true;
  }

  return openaiApiKey.trim().length > 0;
};

export const canProceed = (params: OnboardingCanProceedParams): boolean => {
  const {
    currentStep,
    isSignedIn,
    skipAuth,
    useLocalWhisper,
    localTranscriptionProvider,
    whisperModel,
    parakeetModel,
    isModelDownloaded,
    cloudTranscriptionProvider,
    openaiApiKey,
    groqApiKey,
    mistralApiKey,
    hotkey,
    permissions,
  } = params;

  switch (currentStep) {
    case 0:
      return isSignedIn || skipAuth;
    case 1:
      if (isSignedIn && !skipAuth) {
        return canProceedOnPermissions(permissions);
      }
      return canProceedOnGuestSetup({
        useLocalWhisper,
        localTranscriptionProvider,
        whisperModel,
        parakeetModel,
        isModelDownloaded,
        cloudTranscriptionProvider,
        openaiApiKey,
        groqApiKey,
        mistralApiKey,
      });
    case 2:
      if (isSignedIn && !skipAuth) {
        return hotkey.trim() !== "";
      }
      return canProceedOnPermissions(permissions);
    case 3:
      return hotkey.trim() !== "";
    default:
      return false;
  }
};

