import { Download, FolderOpen } from "lucide-react";

import { Button } from "../../../ui/button";
import { SettingsPanel, SettingsPanelRow } from "../../SettingsPanels";
import { Textarea } from "../../../ui/textarea";

type DictionaryImportMode = "merge" | "replace";

type Props = {
  customDictionaryLength: number;
  dictionaryBatchText: string;
  onDictionaryBatchTextChange: (next: string) => void;
  dictionaryImportMode: DictionaryImportMode;
  onDictionaryImportModeChange: (next: DictionaryImportMode) => void;
  onClearDraft: () => void;
  onApplyBatch: () => void;

  preview: {
    parsedCount: number;
    uniqueWordsCount: number;
    duplicatesRemoved: number;
  };
  importedDictionaryFileName: string;

  isImportingDictionaryFile: boolean;
  onImportDictionaryFile: () => void;

  isExportingDictionary: boolean;
  onExportDictionary: () => void;
};

export default function DictionaryBatchPanel(props: Props) {
  const {
    customDictionaryLength,
    dictionaryBatchText,
    onDictionaryBatchTextChange,
    dictionaryImportMode,
    onDictionaryImportModeChange,
    onClearDraft,
    onApplyBatch,
    preview,
    importedDictionaryFileName,
    isImportingDictionaryFile,
    onImportDictionaryFile,
    isExportingDictionary,
    onExportDictionary,
  } = props;

  return (
    <SettingsPanel>
      <SettingsPanelRow>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-medium text-foreground">Batch import / export</p>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={onImportDictionaryFile}
                disabled={isImportingDictionaryFile}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {isImportingDictionaryFile ? "Importing..." : "Import file"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={onExportDictionary}
                disabled={customDictionaryLength === 0 || isExportingDictionary}
              >
                <Download className="w-3.5 h-3.5" />
                {isExportingDictionary ? "Exporting..." : "Export"}
              </Button>
            </div>
          </div>

          <Textarea
            value={dictionaryBatchText}
            onChange={(e) => onDictionaryBatchTextChange(e.target.value)}
            placeholder="Paste one word or phrase per line. Commas and semicolons are also supported."
            className="min-h-[110px] text-[12px] leading-relaxed dark:bg-surface-2/80 dark:border-border-subtle focus:border-primary/40 focus:ring-primary/10"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Button
                variant={dictionaryImportMode === "merge" ? "default" : "outline"}
                size="sm"
                className="h-7"
                onClick={() => onDictionaryImportModeChange("merge")}
              >
                Merge
              </Button>
              <Button
                variant={dictionaryImportMode === "replace" ? "destructive" : "outline"}
                size="sm"
                className="h-7"
                onClick={() => onDictionaryImportModeChange("replace")}
              >
                Replace
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                onClick={onClearDraft}
                disabled={!dictionaryBatchText.trim()}
              >
                Clear draft
              </Button>
            </div>

            <Button
              size="sm"
              className="h-7"
              onClick={onApplyBatch}
              disabled={preview.uniqueWordsCount === 0}
            >
              Apply {dictionaryImportMode === "replace" ? "Replace" : "Merge"}
            </Button>
          </div>

          <div className="rounded-md border border-border/40 dark:border-border-subtle bg-muted/40 dark:bg-surface-2/70 px-3 py-2 space-y-1">
            <p className="text-[10px] text-muted-foreground/80">
              {preview.parsedCount > 0
                ? `Preview: ${preview.uniqueWordsCount} unique words (${preview.duplicatesRemoved} duplicates removed).`
                : "Preview: Add words to see import counts."}
            </p>
            {importedDictionaryFileName && (
              <p className="text-[10px] text-muted-foreground/70">
                Source file: {importedDictionaryFileName}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground/70">
              Merge adds new words to your existing dictionary. Replace overwrites it.
            </p>
          </div>
        </div>
      </SettingsPanelRow>
    </SettingsPanel>
  );
}

