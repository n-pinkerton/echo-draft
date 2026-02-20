import React, { useState, useEffect } from "react";
import { Eye, Edit3, TestTube } from "lucide-react";
import { AlertDialog } from "./dialog";
import { useDialogs } from "../../hooks/useDialogs";
import { useAgentName } from "../../utils/agentName";
import { UNIFIED_SYSTEM_PROMPT } from "../../config/prompts";
import { PromptStudioEditTab } from "./promptStudio/PromptStudioEditTab";
import { PromptStudioTestTab } from "./promptStudio/PromptStudioTestTab";
import { PromptStudioViewTab } from "./promptStudio/PromptStudioViewTab";

interface PromptStudioProps {
  className?: string;
}

export default function PromptStudio({ className = "" }: PromptStudioProps) {
  const [activeTab, setActiveTab] = useState<"current" | "edit" | "test">("current");
  const [editedPrompt, setEditedPrompt] = useState(UNIFIED_SYSTEM_PROMPT);
  const [currentPrompt, setCurrentPrompt] = useState(UNIFIED_SYSTEM_PROMPT);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const { alertDialog, showAlertDialog, hideAlertDialog } = useDialogs();
  const { agentName } = useAgentName();

  useEffect(() => {
    const legacyPrompts = localStorage.getItem("customPrompts");
    if (legacyPrompts && !localStorage.getItem("customUnifiedPrompt")) {
      try {
        const parsed = JSON.parse(legacyPrompts);
        if (parsed.agent) {
          localStorage.setItem("customUnifiedPrompt", JSON.stringify(parsed.agent));
          localStorage.removeItem("customPrompts");
        }
      } catch (e) {
        console.error("Failed to migrate legacy custom prompts:", e);
      }
    }

    const customPrompt = localStorage.getItem("customUnifiedPrompt");
    if (customPrompt) {
      try {
        const parsed = JSON.parse(customPrompt);
        setEditedPrompt(parsed);
        setCurrentPrompt(parsed);
      } catch (error) {
        console.error("Failed to load custom prompt:", error);
      }
    } else {
      setCurrentPrompt(UNIFIED_SYSTEM_PROMPT);
    }
  }, []);

  const savePrompt = () => {
    localStorage.setItem("customUnifiedPrompt", JSON.stringify(editedPrompt));
    setCurrentPrompt(editedPrompt);
    showAlertDialog({
      title: "Prompt Saved",
      description: "Your custom prompt will be used for all future AI processing.",
    });
  };

  const resetToDefault = () => {
    setEditedPrompt(UNIFIED_SYSTEM_PROMPT);
    localStorage.removeItem("customUnifiedPrompt");
    setCurrentPrompt(UNIFIED_SYSTEM_PROMPT);
    showAlertDialog({
      title: "Reset Complete",
      description: "Prompt has been reset to the default value.",
    });
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };
  const isCustomPrompt = currentPrompt !== UNIFIED_SYSTEM_PROMPT;

  const tabs = [
    { id: "current" as const, label: "View", icon: Eye },
    { id: "edit" as const, label: "Customize", icon: Edit3 },
    { id: "test" as const, label: "Test", icon: TestTube },
  ];

  return (
    <div className={className}>
      <AlertDialog
        open={alertDialog.open}
        onOpenChange={(open) => !open && hideAlertDialog()}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      {/* Tab Navigation + Content in a single panel */}
      <div className="rounded-xl border border-border/60 dark:border-border-subtle bg-card dark:bg-surface-2 overflow-hidden">
        <div className="flex border-b border-border/40 dark:border-border-subtle">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
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

        {/* ── View Tab ── */}
        {activeTab === "current" && (
          <PromptStudioViewTab
            agentName={agentName}
            currentPrompt={currentPrompt}
            isCustomPrompt={isCustomPrompt}
            copiedPrompt={copiedPrompt}
            onCopyPrompt={() => copyText(currentPrompt)}
          />
        )}

        {/* ── Edit Tab ── */}
        {activeTab === "edit" && (
          <PromptStudioEditTab
            agentName={agentName}
            editedPrompt={editedPrompt}
            onEditedPromptChange={setEditedPrompt}
            onSave={savePrompt}
            onResetToDefault={resetToDefault}
          />
        )}

        {/* ── Test Tab ── */}
        {activeTab === "test" && (
          <PromptStudioTestTab agentName={agentName} editedPrompt={editedPrompt} onCopyText={copyText} />
        )}
      </div>
    </div>
  );
}
