import { Cloud, Key } from "lucide-react";

import ReasoningModelSelector from "../../ReasoningModelSelector";
import type { CleanupReasoningEffort } from "../../../services/BaseReasoningService";
import { SettingsRow } from "../../ui/SettingsSection";
import { Toggle } from "../../ui/toggle";
import { ECHO_DRAFT_CLOUD_MODE } from "../../../utils/branding";
import { SectionHeader, SettingsPanel, SettingsPanelRow } from "../SettingsPanels";

export interface AiModelsSectionProps {
  isSignedIn: boolean;
  cloudReasoningMode: string;
  setCloudReasoningMode: (mode: string) => void;
  useReasoningModel: boolean;
  setUseReasoningModel: (value: boolean) => void;
  reasoningModel: string;
  setReasoningModel: (model: string) => void;
  reasoningProvider: string;
  setReasoningProvider: (provider: string) => void;
  cleanupReasoningEffort: CleanupReasoningEffort;
  setCleanupReasoningEffort: (effort: CleanupReasoningEffort) => void;
  cloudReasoningBaseUrl: string;
  setCloudReasoningBaseUrl: (url: string) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (key: string) => void;
  anthropicApiKey: string;
  setAnthropicApiKey: (key: string) => void;
  geminiApiKey: string;
  setGeminiApiKey: (key: string) => void;
  groqApiKey: string;
  setGroqApiKey: (key: string) => void;
  customReasoningApiKey: string;
  setCustomReasoningApiKey: (key: string) => void;
  showAlertDialog: (dialog: { title: string; description: string }) => void;
  toast: (opts: {
    title: string;
    description: string;
    variant?: "default" | "destructive" | "success";
    duration?: number;
  }) => void;
}

export default function AiModelsSection(props: AiModelsSectionProps) {
  const {
    isSignedIn,
    cloudReasoningMode,
    setCloudReasoningMode,
    useReasoningModel,
    setUseReasoningModel,
    reasoningModel,
    setReasoningModel,
    reasoningProvider,
    setReasoningProvider,
    cleanupReasoningEffort,
    setCleanupReasoningEffort,
    cloudReasoningBaseUrl,
    setCloudReasoningBaseUrl,
    openaiApiKey,
    setOpenaiApiKey,
    anthropicApiKey,
    setAnthropicApiKey,
    geminiApiKey,
    setGeminiApiKey,
    groqApiKey,
    setGroqApiKey,
    customReasoningApiKey,
    setCustomReasoningApiKey,
    showAlertDialog,
    toast,
  } = props;

  const isCustomMode = cloudReasoningMode === "byok";
  const isCloudMode = isSignedIn && cloudReasoningMode === ECHO_DRAFT_CLOUD_MODE;
  const supportsCleanupReasoningEffort =
    reasoningProvider === "openai" && reasoningModel.startsWith("gpt-5");

  return (
    <div className="space-y-4">
      <SectionHeader
        title="AI Text Enhancement"
        description="Clean up transcriptions and fix errors while preserving your tone."
      />

      {/* Enable toggle — always at top */}
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow label="Enable text cleanup" description="AI improves transcription quality">
            <Toggle checked={useReasoningModel} onChange={setUseReasoningModel} />
          </SettingsRow>
        </SettingsPanelRow>
      </SettingsPanel>

      {useReasoningModel && (
        <>
          {/* Mode selector */}
          {isSignedIn && (
            <SettingsPanel>
              <SettingsPanelRow>
                <button
                  onClick={() => {
                    if (!isCloudMode) {
                      setCloudReasoningMode(ECHO_DRAFT_CLOUD_MODE);
                      toast({
                        title: "Switched to EchoDraft Cloud",
                        description: "AI text enhancement will use EchoDraft's cloud service.",
                        variant: "success",
                        duration: 3000,
                      });
                    }
                  }}
                  className="w-full flex items-center gap-3 text-left cursor-pointer group"
                >
                  <div
                    className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                      isCloudMode
                        ? "bg-primary/10 dark:bg-primary/15"
                        : "bg-muted/60 dark:bg-surface-raised group-hover:bg-muted dark:group-hover:bg-surface-3"
                    }`}
                  >
                    <Cloud
                      className={`w-4 h-4 transition-colors ${
                        isCloudMode ? "text-primary" : "text-muted-foreground"
                      }`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-foreground">
                        EchoDraft Cloud
                      </span>
                      {isCloudMode && (
                        <span className="text-[10px] font-medium text-primary bg-primary/10 dark:bg-primary/15 px-1.5 py-px rounded-sm">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                      Just works. No configuration needed.
                    </p>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-full border-2 shrink-0 transition-colors ${
                      isCloudMode
                        ? "border-primary bg-primary"
                        : "border-border-hover dark:border-border-subtle"
                    }`}
                  >
                    {isCloudMode && (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />
                      </div>
                    )}
                  </div>
                </button>
              </SettingsPanelRow>
              <SettingsPanelRow>
                <button
                  onClick={() => {
                    if (!isCustomMode) {
                      setCloudReasoningMode("byok");
                      toast({
                        title: "Switched to Custom Setup",
                        description: "Configure your own provider and API key.",
                        variant: "success",
                        duration: 3000,
                      });
                    }
                  }}
                  className="w-full flex items-center gap-3 text-left cursor-pointer group"
                >
                  <div
                    className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                      isCustomMode
                        ? "bg-accent/10 dark:bg-accent/15"
                        : "bg-muted/60 dark:bg-surface-raised group-hover:bg-muted dark:group-hover:bg-surface-3"
                    }`}
                  >
                    <Key
                      className={`w-4 h-4 transition-colors ${
                        isCustomMode ? "text-accent" : "text-muted-foreground"
                      }`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-foreground">Custom Setup</span>
                      {isCustomMode && (
                        <span className="text-[10px] font-medium text-accent bg-accent/10 dark:bg-accent/15 px-1.5 py-px rounded-sm">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                      Use your own provider and API key.
                    </p>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-full border-2 shrink-0 transition-colors ${
                      isCustomMode
                        ? "border-accent bg-accent"
                        : "border-border-hover dark:border-border-subtle"
                    }`}
                  >
                    {isCustomMode && (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-accent-foreground" />
                      </div>
                    )}
                  </div>
                </button>
              </SettingsPanelRow>
            </SettingsPanel>
          )}

          {/* Custom Setup model picker — shown when Custom Setup is active or not signed in */}
          {(isCustomMode || !isSignedIn) && (
            <>
              <ReasoningModelSelector
                showEnableToggle={false}
                useReasoningModel={useReasoningModel}
                setUseReasoningModel={setUseReasoningModel}
                reasoningModel={reasoningModel}
                setReasoningModel={setReasoningModel}
                localReasoningProvider={reasoningProvider}
                setLocalReasoningProvider={setReasoningProvider}
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
              />
              {supportsCleanupReasoningEffort && (
                <SettingsPanel>
                  <SettingsPanelRow>
                    <SettingsRow
                      label="Cleanup reasoning"
                      description="Controls cleanup and its one possible safety retry. Low is recommended for reliability; None is faster but may preserve the original more often. A safety retry is a second request using the same selected model and effort, so it can add latency and BYOK API usage."
                      controlId="cleanup-reasoning-effort"
                    >
                      <select
                        id="cleanup-reasoning-effort"
                        aria-label="Cleanup reasoning effort"
                        aria-describedby="cleanup-reasoning-effort-description"
                        value={cleanupReasoningEffort}
                        onChange={(event) =>
                          setCleanupReasoningEffort(event.target.value as CleanupReasoningEffort)
                        }
                        className="h-9 min-w-[150px] rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground outline-none transition-colors focus:border-primary focus:ring-[3px] focus:ring-primary/15"
                      >
                        <option value="none">None — fastest first pass</option>
                        <option value="low">Low — recommended</option>
                        <option value="medium">Medium — most thorough</option>
                      </select>
                    </SettingsRow>
                  </SettingsPanelRow>
                </SettingsPanel>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
