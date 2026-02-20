import { Button } from "../ui/button";
import ApiKeyInput from "../ui/ApiKeyInput";
import { Input } from "../ui/input";
import ModelCardList from "../ui/ModelCardList";
import type { CloudModelOption, CustomEndpointModelsState } from "./customEndpointModels";

export function CustomEndpointPanel({
  endpoint,
  customReasoningApiKey,
  setCustomReasoningApiKey,
  reasoningModel,
  onModelSelect,
}: {
  endpoint: CustomEndpointModelsState;
  customReasoningApiKey: string;
  setCustomReasoningApiKey: (key: string) => void;
  reasoningModel: string;
  onModelSelect: (modelId: string) => void;
}) {
  const {
    customBaseInput,
    setCustomBaseInput,
    customModelOptions,
    displayedCustomModels,
    customModelsLoading,
    customModelsError,
    defaultOpenAIBase,
    effectiveReasoningBase,
    hasCustomBase,
    hasSavedCustomBase,
    isCustomBaseDirty,
    trimmedCustomBase,
    handleBaseUrlBlur,
    handleResetCustomBase,
    handleRefreshCustomModels,
  } = endpoint;

  const modelsUrl = hasCustomBase
    ? `${effectiveReasoningBase}/models`
    : `${defaultOpenAIBase}/models`;

  const refreshLabel = customModelsLoading
    ? "Loading..."
    : isCustomBaseDirty
      ? "Apply & Refresh"
      : "Refresh";

  return (
    <>
      <div className="space-y-2">
        <h4 className="font-medium text-foreground">Endpoint URL</h4>
        <Input
          value={customBaseInput}
          onChange={(event) => setCustomBaseInput(event.target.value)}
          onBlur={handleBaseUrlBlur}
          placeholder="https://api.openai.com/v1"
          className="text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Examples: <code className="text-primary">http://localhost:11434/v1</code> (Ollama),{" "}
          <code className="text-primary">http://localhost:8080/v1</code> (LocalAI).
        </p>
      </div>

      <div className="space-y-2 pt-3">
        <h4 className="font-medium text-foreground">API Key (Optional)</h4>
        <ApiKeyInput
          apiKey={customReasoningApiKey}
          setApiKey={setCustomReasoningApiKey}
          label=""
          helpText="Optional. Sent as a Bearer token for authentication. This is separate from your OpenAI API key."
        />
      </div>

      <div className="space-y-2 pt-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-foreground">Available Models</h4>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleResetCustomBase}
              className="text-xs"
            >
              Reset
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleRefreshCustomModels}
              disabled={customModelsLoading || (!trimmedCustomBase && !hasSavedCustomBase)}
              className="text-xs"
            >
              {refreshLabel}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          We'll query <code>{modelsUrl}</code> for available models.
        </p>

        {isCustomBaseDirty && (
          <p className="text-xs text-primary">
            Models will reload when you click away from the URL field or click "Apply & Refresh".
          </p>
        )}

        {!hasCustomBase && (
          <p className="text-xs text-warning">Enter an endpoint URL above to load models.</p>
        )}

        {hasCustomBase && (
          <>
            {customModelsLoading && (
              <p className="text-xs text-primary">Fetching model list from endpoint...</p>
            )}
            {customModelsError && <p className="text-xs text-destructive">{customModelsError}</p>}
            {!customModelsLoading && !customModelsError && customModelOptions.length === 0 && (
              <p className="text-xs text-warning">No models returned. Check your endpoint URL.</p>
            )}
          </>
        )}

        <ModelCardList
          models={displayedCustomModels as CloudModelOption[]}
          selectedModel={reasoningModel}
          onModelSelect={onModelSelect}
        />
      </div>
    </>
  );
}

