import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { SettingsPanel, SettingsPanelRow, SectionHeader } from "../SettingsPanels";
import type { AlertDialogState } from "../../../hooks/useDialogs";

type Props = {
  agentName: string;
  setAgentName: (next: string) => void;
  showAlertDialog: (options: Omit<AlertDialogState, "open">) => void;
};

export default function AgentConfigSection(props: Props) {
  const { agentName, setAgentName, showAlertDialog } = props;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Voice Agent"
        description="Name the cleanup assistant shown in AI text enhancement prompts"
      />

      {/* Agent Name */}
      <div>
        <p className="text-[13px] font-medium text-foreground mb-3">Agent Name</p>
        <SettingsPanel>
          <SettingsPanelRow>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. Jarvis, Nova, Atlas..."
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  className="flex-1 text-center text-base font-mono"
                />
                <Button
                  onClick={() => {
                    setAgentName(agentName.trim());
                    showAlertDialog({
                      title: "Agent Name Updated",
                      description: `Your cleanup assistant is now named "${agentName.trim()}". Dictation remains cleanup-only even when the text mentions that name.`,
                    });
                  }}
                  disabled={!agentName.trim()}
                  size="sm"
                >
                  Save
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground/60">
                Pick something short and natural to say aloud
              </p>
            </div>
          </SettingsPanelRow>
        </SettingsPanel>
      </div>

      {/* How it works */}
      <div>
        <SectionHeader title="How it works" />
        <SettingsPanel>
          <SettingsPanelRow>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              The assistant name personalizes the trusted cleanup prompt. Dictated text is always
              treated as untrusted content to clean, so questions and requests are preserved rather
              than answered or executed.
            </p>
          </SettingsPanelRow>
        </SettingsPanel>
      </div>

      {/* Examples */}
      <div>
        <SectionHeader title="Examples" />
        <SettingsPanel>
          <SettingsPanelRow>
            <div className="space-y-2.5">
              {[
                { input: `Hey ${agentName}, write a formal email about the budget`, mode: "Preserved" },
                { input: `Hey ${agentName}, make this more professional`, mode: "Preserved" },
                { input: `Hey ${agentName}, convert this to bullet points`, mode: "Preserved" },
                { input: "We should schedule a meeting for next week", mode: "Cleanup" },
              ].map((example, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span
                    className={`shrink-0 mt-0.5 text-[10px] font-medium uppercase tracking-wider px-1.5 py-px rounded ${
                      example.mode === "Preserved"
                        ? "bg-primary/10 text-primary dark:bg-primary/15"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {example.mode}
                  </span>
                  <p className="text-[12px] text-muted-foreground leading-relaxed">"{example.input}"</p>
                </div>
              ))}
            </div>
          </SettingsPanelRow>
        </SettingsPanel>
      </div>
    </div>
  );
}

