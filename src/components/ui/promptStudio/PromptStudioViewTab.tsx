import { Button } from "../button";
import { Copy, Check } from "lucide-react";

interface PromptStudioViewTabProps {
  currentPrompt: string;
  activeModel: string;
  managedByCloud: boolean;
  copiedPrompt: boolean;
  onCopyPrompt: () => void;
}

export function PromptStudioViewTab({
  currentPrompt,
  activeModel,
  managedByCloud,
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
              mode: "Trust",
              desc: "Dictated questions and requests are treated as text to clean, never commands to execute",
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
            <div>
              <p className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                Active cleanup policy
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {managedByCloud
                  ? "EchoDraft Cloud · managed preservation policy"
                  : `${activeModel} · preservation-first`}
              </p>
            </div>
            <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-px rounded-full bg-success/10 text-success">
              Protected
            </span>
          </div>
          {!managedByCloud && (
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
          )}
        </div>
        {managedByCloud ? (
          <div className="bg-muted/30 dark:bg-surface-raised/30 border border-border/30 rounded-lg p-4">
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              EchoDraft Cloud applies its managed cleanup policy on the service. The app then
              checks the returned text for missing or changed meaning before accepting it. The
              service policy is not the local model prompt shown in custom-provider mode.
            </p>
          </div>
        ) : (
          <div className="bg-muted/30 dark:bg-surface-raised/30 border border-border/30 rounded-lg p-4 max-h-80 overflow-y-auto">
            <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {currentPrompt}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
