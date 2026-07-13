import React, { useEffect, useState } from "react";
import { Eye, TestTube } from "lucide-react";
import { DEFAULT_CLEANUP_MODEL_ID, getSystemPrompt } from "../../config/prompts";
import { ECHO_DRAFT_CLOUD_MODE, normalizeCloudMode } from "../../utils/branding";
import { PromptStudioTestTab } from "./promptStudio/PromptStudioTestTab";
import { PromptStudioViewTab } from "./promptStudio/PromptStudioViewTab";

interface PromptStudioProps {
  className?: string;
}

export default function PromptStudio({ className = "" }: PromptStudioProps) {
  const [activeTab, setActiveTab] = useState<"current" | "test">("current");
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const reasoningModel = localStorage.getItem("reasoningModel") || DEFAULT_CLEANUP_MODEL_ID;
  const preferredLanguage = localStorage.getItem("preferredLanguage") || "auto";
  const managedByCloud =
    localStorage.getItem("isSignedIn") === "true" &&
    normalizeCloudMode(localStorage.getItem("cloudReasoningMode")) === ECHO_DRAFT_CLOUD_MODE;
  const activePrompt = getSystemPrompt(
    null,
    undefined,
    preferredLanguage,
    reasoningModel,
    "preservation-first"
  );

  useEffect(() => {
    // Arbitrary privileged prompt text is intentionally retired. Cleanup behavior is governed
    // by the fixed, versioned policy shown here so dictation can never become model instructions.
    localStorage.removeItem("customPrompts");
    localStorage.removeItem("customUnifiedPrompt");
  }, []);

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const tabs = [
    { id: "current" as const, label: "View", icon: Eye },
    { id: "test" as const, label: "Test", icon: TestTube },
  ];

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setActiveTab(nextTab.id);
    document.getElementById(`cleanup-policy-tab-${nextTab.id}`)?.focus();
  };

  return (
    <div className={className}>
      {/* Tab Navigation + Content in a single panel */}
      <div className="rounded-xl border border-border/60 dark:border-border-subtle bg-card dark:bg-surface-2 overflow-hidden">
        <div
          className="flex border-b border-border/40 dark:border-border-subtle"
          role="tablist"
          aria-label="Cleanup policy"
        >
          {tabs.map((tab, index) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`cleanup-policy-tab-${tab.id}`}
                role="tab"
                aria-selected={isActive}
                aria-controls={`cleanup-policy-panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-[12px] font-medium transition-all duration-150 border-b-2 ${
                  isActive
                    ? "border-primary text-foreground bg-primary/5 dark:bg-primary/3"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-black/2 dark:hover:bg-white/2"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Keep both panels mounted so every tab's aria-controls relationship stays valid. */}
        <div
          id="cleanup-policy-panel-current"
          role="tabpanel"
          aria-labelledby="cleanup-policy-tab-current"
          hidden={activeTab !== "current"}
        >
          <PromptStudioViewTab
            currentPrompt={activePrompt}
            activeModel={reasoningModel}
            managedByCloud={managedByCloud}
            copiedPrompt={copiedPrompt}
            onCopyPrompt={() => copyText(activePrompt)}
          />
        </div>

        <div
          id="cleanup-policy-panel-test"
          role="tabpanel"
          aria-labelledby="cleanup-policy-tab-test"
          hidden={activeTab !== "test"}
        >
          <PromptStudioTestTab managedByCloud={managedByCloud} onCopyText={copyText} />
        </div>
      </div>
    </div>
  );
}
