import { Button } from "../button";
import { Textarea } from "../textarea";
import { Save, RotateCcw } from "lucide-react";

interface PromptStudioEditTabProps {
  agentName: string;
  editedPrompt: string;
  onEditedPromptChange: (value: string) => void;
  onSave: () => void;
  onResetToDefault: () => void;
}

export function PromptStudioEditTab({
  agentName,
  editedPrompt,
  onEditedPromptChange,
  onSave,
  onResetToDefault,
}: PromptStudioEditTabProps) {
  return (
    <div className="divide-y divide-border/40 dark:divide-border-subtle">
      <div className="px-5 py-4">
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          <span className="font-medium text-warning">Caution</span> — Modifying this prompt may
          affect transcription quality. Use{" "}
          <code className="text-[11px] bg-muted/50 px-1 py-0.5 rounded font-mono">
            {"{{agentName}}"}
          </code>{" "}
          as a placeholder for your agent's name.
        </p>
      </div>

      <div className="px-5 py-4">
        <Textarea
          value={editedPrompt}
          onChange={(e) => onEditedPromptChange(e.target.value)}
          rows={16}
          className="font-mono text-[11px] leading-relaxed"
          placeholder="Enter your custom system prompt..."
        />
        <p className="text-[11px] text-muted-foreground/50 mt-2">
          Agent name: <span className="font-medium text-foreground">{agentName}</span>
        </p>
      </div>

      <div className="px-5 py-4">
        <div className="flex gap-2">
          <Button onClick={onSave} size="sm" className="flex-1">
            <Save className="w-3.5 h-3.5 mr-2" />
            Save
          </Button>
          <Button onClick={onResetToDefault} variant="outline" size="sm">
            <RotateCcw className="w-3.5 h-3.5 mr-2" />
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
}

