import { Button } from "../../../ui/button";
import { Input } from "../../../ui/input";
import { SettingsPanel, SettingsPanelRow } from "../../SettingsPanels";
import { normalizeDictionaryEntry } from "../../dictionaryUtils";

type Props = {
  newWord: string;
  onNewWordChange: (next: string) => void;
  onAddWord: () => void;
};

export default function DictionaryAddWordPanel(props: Props) {
  const { newWord, onNewWordChange, onAddWord } = props;
  const hasValue = Boolean(newWord.trim());
  const isInvalid = hasValue && normalizeDictionaryEntry(newWord) === null;
  const isDisabled = !hasValue || isInvalid;

  return (
    <SettingsPanel>
      <SettingsPanelRow>
        <div className="space-y-2">
          <label
            htmlFor="dictionary-term-input"
            className="text-[12px] font-medium text-foreground"
          >
            Add a dictionary term
          </label>
          <div className="flex gap-2">
            <Input
              id="dictionary-term-input"
              placeholder="e.g. EchoDraft, Kubernetes, Martinez"
              value={newWord}
              onChange={(e) => onNewWordChange(e.target.value)}
              aria-describedby={
                isInvalid ? "dictionary-term-help dictionary-term-error" : "dictionary-term-help"
              }
              aria-invalid={isInvalid}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isDisabled) {
                  onAddWord();
                }
              }}
              className="flex-1 h-8 text-[12px]"
            />
            <Button onClick={onAddWord} disabled={isDisabled} size="sm" className="h-8">
              Add
            </Button>
          </div>
          <p id="dictionary-term-help" className="text-[10px] text-muted-foreground/60">
            One word, name, or identifier per entry. Press Enter to add.
          </p>
          {isInvalid && (
            <p id="dictionary-term-error" role="alert" className="text-[10px] text-destructive">
              Enter one term without spaces. For a person’s name, add each distinctive word
              separately.
            </p>
          )}
        </div>
      </SettingsPanelRow>
    </SettingsPanel>
  );
}
