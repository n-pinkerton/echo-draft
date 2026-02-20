import { useCallback, useMemo, useState } from "react";

import { SectionHeader } from "../SettingsPanels";
import type { ConfirmDialogState } from "../../../hooks/useDialogs";
import {
  dedupeDictionaryEntries,
  getFileNameFromPath,
  parseDictionaryEntries,
} from "../dictionaryUtils";
import DictionaryAddWordPanel from "./dictionary/DictionaryAddWordPanel";
import DictionaryBatchPanel from "./dictionary/DictionaryBatchPanel";
import DictionaryHowItWorks from "./dictionary/DictionaryHowItWorks";
import DictionaryWordList from "./dictionary/DictionaryWordList";

type ToastFn = (opts: {
  title: string;
  description: string;
  variant?: "default" | "destructive" | "success";
  duration?: number;
}) => void;

type Props = {
  customDictionary: string[];
  setCustomDictionary: (next: string[]) => void;
  showConfirmDialog: (options: Omit<ConfirmDialogState, "open">) => void;
  toast: ToastFn;
};

export default function DictionarySection(props: Props) {
  const { customDictionary, setCustomDictionary, showConfirmDialog, toast } = props;

  const [newDictionaryWord, setNewDictionaryWord] = useState("");
  const [dictionaryBatchText, setDictionaryBatchText] = useState("");
  const [dictionaryImportMode, setDictionaryImportMode] = useState<"merge" | "replace">("merge");
  const [importedDictionaryFileName, setImportedDictionaryFileName] = useState("");
  const [isImportingDictionaryFile, setIsImportingDictionaryFile] = useState(false);
  const [isExportingDictionary, setIsExportingDictionary] = useState(false);

  const dictionaryBatchPreview = useMemo(() => {
    const parsedEntries = parseDictionaryEntries(dictionaryBatchText);
    const uniqueWords = dedupeDictionaryEntries(parsedEntries);
    return {
      parsedCount: parsedEntries.length,
      uniqueWords,
      uniqueWordsCount: uniqueWords.length,
      duplicatesRemoved: Math.max(0, parsedEntries.length - uniqueWords.length),
    };
  }, [dictionaryBatchText]);

  const handleAddDictionaryWord = useCallback(() => {
    const word = newDictionaryWord.trim();
    if (word) {
      const nextWords = dedupeDictionaryEntries([...customDictionary, word]);
      if (nextWords.length !== customDictionary.length) {
        setCustomDictionary(nextWords);
      }
      setNewDictionaryWord("");
    }
  }, [newDictionaryWord, customDictionary, setCustomDictionary]);

  const handleRemoveDictionaryWord = useCallback(
    (wordToRemove: string) => {
      setCustomDictionary(customDictionary.filter((word) => word !== wordToRemove));
    },
    [customDictionary, setCustomDictionary]
  );

  const applyDictionaryBatch = useCallback(() => {
    const batchWords = dictionaryBatchPreview.uniqueWords;
    if (batchWords.length === 0) {
      toast({
        title: "Nothing to import",
        description: "Add words first, then apply the import.",
        variant: "destructive",
      });
      return;
    }

    const runImport = () => {
      const nextWords =
        dictionaryImportMode === "replace"
          ? batchWords
          : dedupeDictionaryEntries([...customDictionary, ...batchWords]);

      const addedCount = Math.max(0, nextWords.length - customDictionary.length);
      const replacedCount = customDictionary.length;
      setCustomDictionary(nextWords);

      toast({
        title: dictionaryImportMode === "replace" ? "Dictionary replaced" : "Dictionary merged",
        description:
          dictionaryImportMode === "replace"
            ? `Replaced ${replacedCount} existing words with ${nextWords.length} imported words.`
            : `Imported ${batchWords.length} words (${addedCount} new additions).`,
        variant: "success",
      });
    };

    if (dictionaryImportMode === "replace" && customDictionary.length > 0) {
      showConfirmDialog({
        title: "Replace dictionary?",
        description:
          "This will replace your current dictionary with the imported words. Existing words will be removed.",
        confirmText: "Replace Dictionary",
        variant: "destructive",
        onConfirm: runImport,
      });
      return;
    }

    runImport();
  }, [
    customDictionary,
    dictionaryBatchPreview.uniqueWords,
    dictionaryImportMode,
    setCustomDictionary,
    showConfirmDialog,
    toast,
  ]);

  const handleImportDictionaryFile = useCallback(async () => {
    if (!window.electronAPI?.importDictionaryFile) {
      toast({
        title: "Import unavailable",
        description: "File import is not available in this build.",
        variant: "destructive",
      });
      return;
    }

    setIsImportingDictionaryFile(true);
    try {
      const result = await window.electronAPI.importDictionaryFile();
      if (!result || result.canceled) {
        return;
      }

      if (!result.success) {
        throw new Error(result.error || "Failed to import dictionary file.");
      }

      const importedWords = Array.isArray(result.words) ? result.words : [];
      setDictionaryBatchText(importedWords.join("\n"));
      setImportedDictionaryFileName(getFileNameFromPath(result.filePath || ""));

      toast({
        title: "File imported",
        description: `Loaded ${importedWords.length} unique words from file.`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Import failed",
        description: (error as Error)?.message || "Could not read dictionary file.",
        variant: "destructive",
      });
    } finally {
      setIsImportingDictionaryFile(false);
    }
  }, [toast]);

  const handleExportDictionary = useCallback(async () => {
    if (!window.electronAPI?.exportDictionary) {
      toast({
        title: "Export unavailable",
        description: "Dictionary export is not available in this build.",
        variant: "destructive",
      });
      return;
    }

    setIsExportingDictionary(true);
    try {
      const result = await window.electronAPI.exportDictionary("txt");
      if (!result || result.canceled) {
        return;
      }
      if (!result.success) {
        throw new Error("Failed to export dictionary.");
      }

      toast({
        title: "Dictionary exported",
        description: `Saved ${result.count ?? customDictionary.length} words to ${getFileNameFromPath(result.filePath || "")}.`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Export failed",
        description: (error as Error)?.message || "Could not export dictionary.",
        variant: "destructive",
      });
    } finally {
      setIsExportingDictionary(false);
    }
  }, [customDictionary.length, toast]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Custom Dictionary"
        description="Add words, names, or technical terms to improve transcription accuracy"
      />

      <DictionaryAddWordPanel
        newWord={newDictionaryWord}
        onNewWordChange={setNewDictionaryWord}
        onAddWord={handleAddDictionaryWord}
      />

      <DictionaryBatchPanel
        customDictionaryLength={customDictionary.length}
        dictionaryBatchText={dictionaryBatchText}
        onDictionaryBatchTextChange={setDictionaryBatchText}
        dictionaryImportMode={dictionaryImportMode}
        onDictionaryImportModeChange={setDictionaryImportMode}
        onClearDraft={() => {
          setDictionaryBatchText("");
          setImportedDictionaryFileName("");
        }}
        onApplyBatch={applyDictionaryBatch}
        preview={{
          parsedCount: dictionaryBatchPreview.parsedCount,
          uniqueWordsCount: dictionaryBatchPreview.uniqueWordsCount,
          duplicatesRemoved: dictionaryBatchPreview.duplicatesRemoved,
        }}
        importedDictionaryFileName={importedDictionaryFileName}
        isImportingDictionaryFile={isImportingDictionaryFile}
        onImportDictionaryFile={handleImportDictionaryFile}
        isExportingDictionary={isExportingDictionary}
        onExportDictionary={handleExportDictionary}
      />

      <DictionaryWordList
        words={customDictionary}
        onClearAll={() => {
          showConfirmDialog({
            title: "Clear dictionary?",
            description:
              "This will remove all words from your custom dictionary. This action cannot be undone.",
            confirmText: "Clear All",
            variant: "destructive",
            onConfirm: () => setCustomDictionary([]),
          });
        }}
        onRemoveWord={handleRemoveDictionaryWord}
      />

      <DictionaryHowItWorks />
    </div>
  );
}
