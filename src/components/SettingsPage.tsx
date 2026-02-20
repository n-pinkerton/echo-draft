import { useMemo } from "react";

import { useAuth } from "../hooks/useAuth";
import { useClipboard } from "../hooks/useClipboard";
import { useDialogs } from "../hooks/useDialogs";
import { usePermissions } from "../hooks/usePermissions";
import { useSettings } from "../hooks/useSettings";
import { useToast } from "./ui/toastContext";
import { AlertDialog, ConfirmDialog } from "./ui/dialog";
import { useAgentName } from "../utils/agentName";

import type { SettingsSectionType } from "./settings/types";
export type { SettingsSectionType } from "./settings/types";

import AccountSection from "./settings/sections/AccountSection";
import AgentConfigSection from "./settings/sections/AgentConfigSection";
import AiModelsSection from "./settings/sections/AiModelsSection";
import DeveloperToolsSection from "./settings/sections/DeveloperToolsSection";
import DictionarySection from "./settings/sections/DictionarySection";
import GeneralSection from "./settings/sections/GeneralSection";
import PermissionsSection from "./settings/sections/PermissionsSection";
import PrivacySection from "./settings/sections/PrivacySection";
import PromptsSection from "./settings/sections/PromptsSection";
import TranscriptionSection from "./settings/sections/TranscriptionSection";

interface SettingsPageProps {
  activeSection?: SettingsSectionType;
}

export default function SettingsPage({ activeSection = "general" }: SettingsPageProps) {
  const {
    confirmDialog,
    alertDialog,
    showConfirmDialog,
    showAlertDialog,
    hideConfirmDialog,
    hideAlertDialog,
  } = useDialogs();

  const { toast } = useToast();
  const { isSignedIn } = useAuth();
  const permissionsHook = usePermissions(showAlertDialog);
  useClipboard(showAlertDialog);
  const { agentName, setAgentName } = useAgentName();

  const {
    useLocalWhisper,
    whisperModel,
    localTranscriptionProvider,
    parakeetModel,
    cloudTranscriptionProvider,
    cloudTranscriptionModel,
    cloudTranscriptionBaseUrl,
    cloudReasoningBaseUrl,
    customDictionary,
    useReasoningModel,
    reasoningModel,
    reasoningProvider,
    openaiApiKey,
    anthropicApiKey,
    geminiApiKey,
    groqApiKey,
    mistralApiKey,
    customTranscriptionApiKey,
    customReasoningApiKey,
    setUseLocalWhisper,
    setWhisperModel,
    setLocalTranscriptionProvider,
    setParakeetModel,
    setCloudTranscriptionProvider,
    setCloudTranscriptionModel,
    setCloudTranscriptionBaseUrl,
    setCloudReasoningBaseUrl,
    setCustomDictionary,
    setUseReasoningModel,
    setReasoningModel,
    setReasoningProvider,
    setOpenaiApiKey,
    setAnthropicApiKey,
    setGeminiApiKey,
    setGroqApiKey,
    setMistralApiKey,
    setCustomTranscriptionApiKey,
    setCustomReasoningApiKey,
    updateTranscriptionSettings,
    updateReasoningSettings,
    cloudTranscriptionMode,
    setCloudTranscriptionMode,
    cloudReasoningMode,
    setCloudReasoningMode,
    cloudBackupEnabled,
    setCloudBackupEnabled,
    telemetryEnabled,
    setTelemetryEnabled,
  } = useSettings();

  const platform = useMemo(() => {
    if (typeof window !== "undefined" && window.electronAPI?.getPlatform) {
      return window.electronAPI.getPlatform();
    }
    return "linux";
  }, []);

  const renderSectionContent = () => {
    switch (activeSection) {
      case "account":
        return <AccountSection showAlertDialog={showAlertDialog} />;

      case "general":
        return (
          <GeneralSection showAlertDialog={showAlertDialog} showConfirmDialog={showConfirmDialog} />
        );

      case "transcription":
        return (
          <TranscriptionSection
            isSignedIn={isSignedIn ?? false}
            cloudTranscriptionMode={cloudTranscriptionMode}
            setCloudTranscriptionMode={setCloudTranscriptionMode}
            useLocalWhisper={useLocalWhisper}
            setUseLocalWhisper={setUseLocalWhisper}
            updateTranscriptionSettings={updateTranscriptionSettings}
            cloudTranscriptionProvider={cloudTranscriptionProvider}
            setCloudTranscriptionProvider={setCloudTranscriptionProvider}
            cloudTranscriptionModel={cloudTranscriptionModel}
            setCloudTranscriptionModel={setCloudTranscriptionModel}
            localTranscriptionProvider={localTranscriptionProvider}
            setLocalTranscriptionProvider={setLocalTranscriptionProvider}
            whisperModel={whisperModel}
            setWhisperModel={setWhisperModel}
            parakeetModel={parakeetModel}
            setParakeetModel={setParakeetModel}
            openaiApiKey={openaiApiKey}
            setOpenaiApiKey={setOpenaiApiKey}
            groqApiKey={groqApiKey}
            setGroqApiKey={setGroqApiKey}
            mistralApiKey={mistralApiKey}
            setMistralApiKey={setMistralApiKey}
            customTranscriptionApiKey={customTranscriptionApiKey}
            setCustomTranscriptionApiKey={setCustomTranscriptionApiKey}
            cloudTranscriptionBaseUrl={cloudTranscriptionBaseUrl}
            setCloudTranscriptionBaseUrl={setCloudTranscriptionBaseUrl}
            toast={toast}
          />
        );

      case "dictionary":
        return (
          <DictionarySection
            customDictionary={customDictionary}
            setCustomDictionary={setCustomDictionary}
            showConfirmDialog={showConfirmDialog}
            toast={toast}
          />
        );

      case "aiModels":
        return (
          <AiModelsSection
            isSignedIn={isSignedIn ?? false}
            cloudReasoningMode={cloudReasoningMode}
            setCloudReasoningMode={setCloudReasoningMode}
            useReasoningModel={useReasoningModel}
            setUseReasoningModel={(value) => {
              setUseReasoningModel(value);
              updateReasoningSettings({ useReasoningModel: value });
            }}
            reasoningModel={reasoningModel}
            setReasoningModel={setReasoningModel}
            reasoningProvider={reasoningProvider}
            setReasoningProvider={setReasoningProvider}
            cloudReasoningBaseUrl={cloudReasoningBaseUrl}
            setCloudReasoningBaseUrl={setCloudReasoningBaseUrl}
            openaiApiKey={openaiApiKey}
            setOpenaiApiKey={setOpenaiApiKey}
            anthropicApiKey={anthropicApiKey}
            setAnthropicApiKey={setAnthropicApiKey}
            geminiApiKey={geminiApiKey}
            setGeminiApiKey={setGeminiApiKey}
            groqApiKey={groqApiKey}
            setGroqApiKey={setGroqApiKey}
            customReasoningApiKey={customReasoningApiKey}
            setCustomReasoningApiKey={setCustomReasoningApiKey}
            showAlertDialog={showAlertDialog}
            toast={toast}
          />
        );

      case "agentConfig":
        return (
          <AgentConfigSection
            agentName={agentName}
            setAgentName={setAgentName}
            showAlertDialog={showAlertDialog}
          />
        );

      case "prompts":
        return <PromptsSection />;

      case "privacy":
        return (
          <PrivacySection
            isSignedIn={isSignedIn ?? false}
            cloudBackupEnabled={cloudBackupEnabled}
            setCloudBackupEnabled={setCloudBackupEnabled}
            telemetryEnabled={telemetryEnabled}
            setTelemetryEnabled={setTelemetryEnabled}
          />
        );

      case "permissions":
        return (
          <PermissionsSection
            platform={platform}
            permissionsHook={permissionsHook}
            showConfirmDialog={showConfirmDialog}
          />
        );

      case "developer":
        return (
          <DeveloperToolsSection showConfirmDialog={showConfirmDialog} showAlertDialog={showAlertDialog} />
        );

      default:
        return null;
    }
  };

  return (
    <>
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => !open && hideConfirmDialog()}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={(open) => !open && hideAlertDialog()}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      {renderSectionContent()}
    </>
  );
}
