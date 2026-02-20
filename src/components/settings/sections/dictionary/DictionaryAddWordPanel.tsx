import { Button } from "../../../ui/button";
import { Input } from "../../../ui/input";
import { SettingsPanel, SettingsPanelRow } from "../../SettingsPanels";

type Props = {
  newWord: string;
  onNewWordChange: (next: string) => void;
  onAddWord: () => void;
};

export default function DictionaryAddWordPanel(props: Props) {
  const { newWord, onNewWordChange, onAddWord } = props;
  const isDisabled = !newWord.trim();

  return (
    <SettingsPanel>
      <SettingsPanelRow>
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-foreground">Add a word or phrase</p>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. EchoDraft, Kubernetes, Dr. Martinez..."
              value={newWord}
              onChange={(e) => onNewWordChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onAddWord();
                }
              }}
              className="flex-1 h-8 text-[12px]"
            />
            <Button onClick={onAddWord} disabled={isDisabled} size="sm" className="h-8">
              Add
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/50">Press Enter to add</p>
        </div>
      </SettingsPanelRow>
    </SettingsPanel>
  );
}

