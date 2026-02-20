import { Input } from "../../ui/input";
import { ProviderTabs } from "../../ui/ProviderTabs";
import ApiKeyInput from "../../ui/ApiKeyInput";
import ModelCardList from "../../ui/ModelCardList";
import { createExternalLinkHandler } from "../../../utils/externalLinks";
import { CLOUD_PROVIDER_TABS } from "../constants";
import type { ModelPickerStyles } from "../../../utils/modelPickerStyles";

type CloudModelOption = {
  value: string;
  label: string;
  description?: string;
  icon?: any;
  invertInDark?: boolean;
};

type Props = {
  styles: ModelPickerStyles;
  tabColorScheme: "purple" | "indigo";
  selectedCloudProvider: string;
  selectedCloudModel: string;
  onCloudProviderChange: (providerId: string) => void;
  onCloudModelSelect: (modelId: string) => void;
  cloudModelOptions: CloudModelOption[];
  cloudTranscriptionBaseUrl: string;
  setCloudTranscriptionBaseUrl?: (url: string) => void;
  onBaseUrlBlur: () => void;
  openaiApiKey: string;
  setOpenaiApiKey: (key: string) => void;
  groqApiKey: string;
  setGroqApiKey: (key: string) => void;
  mistralApiKey: string;
  setMistralApiKey: (key: string) => void;
  customTranscriptionApiKey: string;
  setCustomTranscriptionApiKey?: (key: string) => void;
};

export default function CloudModePanel(props: Props) {
  const {
    styles,
    tabColorScheme,
    selectedCloudProvider,
    selectedCloudModel,
    onCloudProviderChange,
    onCloudModelSelect,
    cloudModelOptions,
    cloudTranscriptionBaseUrl,
    setCloudTranscriptionBaseUrl,
    onBaseUrlBlur,
    openaiApiKey,
    setOpenaiApiKey,
    groqApiKey,
    setGroqApiKey,
    mistralApiKey,
    setMistralApiKey,
    customTranscriptionApiKey,
    setCustomTranscriptionApiKey,
  } = props;

  return (
    <div className={styles.container}>
      <div className="p-2 pb-0">
        <ProviderTabs
          providers={CLOUD_PROVIDER_TABS as any}
          selectedId={selectedCloudProvider}
          onSelect={onCloudProviderChange}
          colorScheme={tabColorScheme}
          scrollable
        />
      </div>

      <div className="p-2">
        {selectedCloudProvider === "custom" ? (
          <div className="space-y-2">
            {/* Endpoint URL */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">Endpoint URL</label>
              <Input
                value={cloudTranscriptionBaseUrl}
                onChange={(e) => setCloudTranscriptionBaseUrl?.(e.target.value)}
                onBlur={onBaseUrlBlur}
                placeholder="https://your-api.example.com/v1"
                className="h-8 text-sm"
              />
            </div>

            {/* API Key */}
            <ApiKeyInput
              apiKey={customTranscriptionApiKey}
              setApiKey={setCustomTranscriptionApiKey || (() => {})}
              label="API Key (Optional)"
              helpText=""
            />

            {/* Model Name */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">Model</label>
              <Input
                value={selectedCloudModel}
                onChange={(e) => onCloudModelSelect(e.target.value)}
                placeholder="whisper-1"
                className="h-8 text-sm"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {/* API Key with inline link */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">API Key</label>
                <button
                  type="button"
                  onClick={createExternalLinkHandler(
                    {
                      groq: "https://console.groq.com/keys",
                      mistral: "https://console.mistral.ai/api-keys",
                      openai: "https://platform.openai.com/api-keys",
                    }[selectedCloudProvider] || "https://platform.openai.com/api-keys"
                  )}
                  className="text-[11px] text-white/70 hover:text-white transition-colors cursor-pointer"
                >
                  Get key →
                </button>
              </div>
              <ApiKeyInput
                apiKey={
                  { groq: groqApiKey, mistral: mistralApiKey, openai: openaiApiKey }[
                    selectedCloudProvider
                  ] || openaiApiKey
                }
                setApiKey={
                  { groq: setGroqApiKey, mistral: setMistralApiKey, openai: setOpenaiApiKey }[
                    selectedCloudProvider
                  ] || setOpenaiApiKey
                }
                label=""
                helpText=""
              />
            </div>

            {/* Model Selection */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Model</label>
              <ModelCardList
                models={cloudModelOptions as any}
                selectedModel={selectedCloudModel}
                onModelSelect={onCloudModelSelect}
                colorScheme={tabColorScheme}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

