import { SettingsPanel, SettingsPanelRow } from "../../SettingsPanels";

type Props = {
  words: string[];
  onClearAll: () => void;
  onRemoveWord: (word: string) => void;
};

export default function DictionaryWordList(props: Props) {
  const { words, onClearAll, onRemoveWord } = props;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[12px] font-medium text-foreground">
          Your words
          {words.length > 0 && (
            <span className="ml-1.5 text-muted-foreground/50 font-normal text-[11px]">
              {words.length}
            </span>
          )}
        </p>
        {words.length > 0 && (
          <button
            onClick={onClearAll}
            className="text-[10px] text-muted-foreground/40 hover:text-destructive transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {words.length > 0 ? (
        <SettingsPanel>
          <SettingsPanelRow>
            <div className="flex flex-wrap gap-1">
              {words.map((word) => (
                <span
                  key={word}
                  className="group inline-flex items-center gap-0.5 pl-2 pr-1 py-0.5 bg-primary/5 dark:bg-primary/10 text-foreground rounded-[5px] text-[11px] border border-border/30 dark:border-border-subtle transition-all hover:border-destructive/40 hover:bg-destructive/5"
                >
                  {word}
                  <button
                    onClick={() => onRemoveWord(word)}
                    className="ml-0.5 p-0.5 rounded-sm text-muted-foreground/40 hover:text-destructive transition-colors"
                    title="Remove word"
                  >
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    >
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          </SettingsPanelRow>
        </SettingsPanel>
      ) : (
        <div className="rounded-lg border border-dashed border-border/40 dark:border-border-subtle py-6 flex flex-col items-center justify-center text-center">
          <p className="text-[11px] text-muted-foreground/50">No words added yet</p>
          <p className="text-[10px] text-muted-foreground/40 mt-0.5">Words you add will appear here</p>
        </div>
      )}
    </div>
  );
}

