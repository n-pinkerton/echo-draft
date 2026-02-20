import { Button } from "../button";
import { Copy, Check } from "lucide-react";

interface PromptStudioViewTabProps {
  agentName: string;
  currentPrompt: string;
  isCustomPrompt: boolean;
  copiedPrompt: boolean;
  onCopyPrompt: () => void;
}

export function PromptStudioViewTab({
  agentName,
  currentPrompt,
  isCustomPrompt,
  copiedPrompt,
  onCopyPrompt,
}: PromptStudioViewTabProps) {
  return (
    <div className="divide-y divide-border/40 dark:divide-border-subtle">
      <div className="px-5 py-4">
        <div className="space-y-2">
          {[
            { mode: "Cleanup", desc: "Removes filler words, fixes grammar and punctuation" },
            {
              mode: "Instruction",
              desc: `Triggered by \"Hey ${agentName}\" — executes commands and cleans text`,
            },
          ].map((item) => (
            <div key={item.mode} className="flex items-start gap-3">
              <span className="shrink-0 mt-0.5 text-[10px] font-medium uppercase tracking-wider px-1.5 py-px rounded bg-muted text-muted-foreground">
                {item.mode}
              </span>
              <p className="text-[12px] text-muted-foreground leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">
              {isCustomPrompt ? "Custom prompt" : "Default prompt"}
            </p>
            {isCustomPrompt && (
              <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-px rounded-full bg-primary/10 text-primary">
                Modified
              </span>
            )}
          </div>
          <Button
            onClick={onCopyPrompt}
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
          >
            {copiedPrompt ? (
              <>
                <Check className="w-3 h-3 mr-1 text-success" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 mr-1" /> Copy
              </>
            )}
          </Button>
        </div>
        <div className="bg-muted/30 dark:bg-surface-raised/30 border border-border/30 rounded-lg p-4 max-h-80 overflow-y-auto">
          <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {currentPrompt.replace(/\{\{agentName\}\}/g, agentName)}
          </pre>
        </div>
      </div>
    </div>
  );
}

