import React, { useMemo, useState } from "react";
import { Button } from "../button";
import { Textarea } from "../textarea";
import { Play, Copy, AlertTriangle } from "lucide-react";
import ReasoningService from "../../../services/ReasoningService";
import { ReasoningCleanupService } from "../../../helpers/audio/reasoning/reasoningCleanupService";
import { getModelProvider } from "../../../models/ModelRegistry";
import logger from "../../../utils/logger";

type ProviderConfig = {
  label: string;
  apiKeyStorageKey?: string;
  baseStorageKey?: string;
};

const PROVIDER_CONFIG: Record<string, ProviderConfig> = {
  openai: { label: "OpenAI", apiKeyStorageKey: "openaiApiKey" },
  anthropic: { label: "Anthropic", apiKeyStorageKey: "anthropicApiKey" },
  gemini: { label: "Gemini", apiKeyStorageKey: "geminiApiKey" },
  custom: {
    label: "Custom endpoint",
    apiKeyStorageKey: "openaiApiKey",
    baseStorageKey: "cloudReasoningBaseUrl",
  },
  local: { label: "Local" },
};

interface PromptStudioTestTabProps {
  managedByCloud: boolean;
  onCopyText: (text: string) => void;
}

export function PromptStudioTestTab({ managedByCloud, onCopyText }: PromptStudioTestTabProps) {
  const [testText, setTestText] = useState(
    "um so like I was thinking we should probably you know schedule a meeting for next week to discuss the the project timeline"
  );
  const [testResult, setTestResult] = useState("");
  const [testResultNote, setTestResultNote] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const cleanupService = useMemo(
    () => new ReasoningCleanupService({ logger, reasoningService: ReasoningService }),
    []
  );

  const useReasoningModel = localStorage.getItem("useReasoningModel") === "true";
  const reasoningModel = localStorage.getItem("reasoningModel") || "";
  const reasoningProvider = reasoningModel ? getModelProvider(reasoningModel) : "openai";

  const providerConfig = useMemo(() => {
    return (
      PROVIDER_CONFIG[reasoningProvider] || {
        label: reasoningProvider.charAt(0).toUpperCase() + reasoningProvider.slice(1),
      }
    );
  }, [reasoningProvider]);

  const testPrompt = async () => {
    if (!testText.trim()) return;

    setIsLoading(true);
    setTestResult("");
    setTestResultNote("");

    try {
      logger.debug(
        "PromptStudio test starting",
        {
          useReasoningModel,
          reasoningModel,
          reasoningProvider,
          testTextLength: testText.length,
        },
        "prompt-studio"
      );

      if (managedByCloud) {
        setTestResult(
          "Managed-cloud policy tests are unavailable here. Run a normal dictation to exercise the signed-in EchoDraft Cloud cleanup path."
        );
        return;
      }

      if (!useReasoningModel) {
        setTestResult("AI text enhancement is disabled. Enable it in AI Models to test prompts.");
        return;
      }

      if (!reasoningModel) {
        setTestResult("No reasoning model selected. Choose one in AI Models settings.");
        return;
      }

      if (providerConfig.baseStorageKey) {
        const baseUrl = (localStorage.getItem(providerConfig.baseStorageKey) || "").trim();
        if (!baseUrl) {
          setTestResult(`${providerConfig.label} base URL missing. Add it in AI Models settings.`);
          return;
        }
      }

      const result = await cleanupService.processTranscriptionWithOutcome(
        testText,
        "prompt-studio",
        true
      );
      setTestResult(result.text);
      if (result.cleanup?.status === "fallback") {
        setTestResultNote(
          result.cleanup?.fallbackReason === "fidelity_rejected"
            ? "Preservation checks rejected the rewrite and kept the original text."
            : "Cleanup could not complete, so the original text was kept."
        );
      } else if (result.cleanup?.status === "unchanged") {
        setTestResultNote("The production cleanup path found no safe wording change to apply.");
      } else {
        setTestResultNote("Processed with the same preservation and fidelity checks as dictation.");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("PromptStudio test failed", { error: errorMessage }, "prompt-studio");
      setTestResult(`Test failed: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="divide-y divide-border/40 dark:divide-border-subtle">
      {!useReasoningModel && (
        <div className="px-5 py-4">
          <div className="rounded-lg border border-warning/20 bg-warning/5 dark:bg-warning/10 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-3.5 h-3.5 text-warning mt-0.5 shrink-0" />
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                AI text enhancement is disabled. Enable it in{" "}
                <span className="font-medium text-foreground">AI Models</span> to test prompts.
              </p>
            </div>
          </div>
        </div>
      )}

      {managedByCloud && (
        <div className="px-5 py-4">
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              EchoDraft Cloud uses a managed service policy. This local tester is unavailable in
              managed mode because it cannot faithfully reproduce that production route. Run a
              normal dictation to test managed cleanup.
            </p>
          </div>
        </div>
      )}

      <div className="px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">Model</p>
            <p className="text-[12px] font-medium text-foreground font-mono">
              {managedByCloud ? "EchoDraft Cloud" : reasoningModel || "None"}
            </p>
          </div>
          <div className="h-3 w-px bg-border/40" />
          <div className="flex items-center gap-2">
            <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">
              Provider
            </p>
            <p className="text-[12px] font-medium text-foreground">
              {managedByCloud ? "Managed service" : providerConfig.label}
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <label
            htmlFor="cleanup-policy-test-input"
            className="text-[12px] font-medium text-foreground"
          >
            Input
          </label>
          {testText && (
            <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-px rounded bg-muted text-muted-foreground">
              Cleanup
            </span>
          )}
        </div>
        <Textarea
          id="cleanup-policy-test-input"
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          rows={3}
          className="text-[12px]"
          placeholder="Enter text to test..."
          aria-describedby="cleanup-policy-test-help"
        />
        <p id="cleanup-policy-test-help" className="text-[10px] text-muted-foreground/60 mt-1.5">
          Runs the production preservation and fidelity checks. Try a question or request to
          confirm it is preserved instead of executed.
        </p>
      </div>

      <div className="px-5 py-4">
        <Button
          onClick={testPrompt}
          disabled={!testText.trim() || isLoading || !useReasoningModel || managedByCloud}
          size="sm"
          className="w-full"
        >
          <Play className="w-3.5 h-3.5 mr-2" />
          {managedByCloud ? "Unavailable in Managed Mode" : isLoading ? "Processing..." : "Run Test"}
        </Button>
      </div>

      {testResult && (
        <div className="px-5 py-4" role="status" aria-live="polite">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[12px] font-medium text-foreground">Output</p>
            <Button
              onClick={() => onCopyText(testResult)}
              variant="ghost"
              size="sm"
              className="h-6 px-1.5"
              aria-label="Copy test output"
            >
              <Copy className="w-3 h-3 text-muted-foreground" />
            </Button>
          </div>
          <div className="bg-muted/30 dark:bg-surface-raised/30 border border-border/30 rounded-lg p-4 max-h-48 overflow-y-auto">
            <pre className="text-[12px] text-foreground whitespace-pre-wrap leading-relaxed">
              {testResult}
            </pre>
          </div>
          {testResultNote && (
            <p className="mt-2 text-[10px] text-muted-foreground">{testResultNote}</p>
          )}
        </div>
      )}
    </div>
  );
}
