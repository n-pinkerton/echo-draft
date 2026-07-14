import { useCallback, useMemo, useState } from "react";

import { SectionHeader } from "../SettingsPanels";
import type { ConfirmDialogState } from "../../../hooks/useDialogs";
import {
  dedupeDictionaryEntries,
  getFileNameFromPath,
  MAX_STORED_DICTIONARY_ENTRIES,
  MAX_USER_DICTIONARY_ENTRIES,
  normalizeDictionaryEntry,
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
    const uniqueWords = dedupeDictionaryEntries(parsedEntries, Math.max(1, parsedEntries.length));
    const invalidEntriesRemoved = parsedEntries.filter(
      (entry) => normalizeDictionaryEntry(entry) === null
    ).length;
    const currentKeys = new Set(customDictionary.map((word) => word.toLocaleLowerCase()));
    const requestedImportCount =
      dictionaryImportMode === "replace"
        ? uniqueWords.length
        : uniqueWords.filter((word) => !currentKeys.has(word.toLocaleLowerCase())).length;
    const availableSlots =
      dictionaryImportMode === "replace"
        ? MAX_USER_DICTIONARY_ENTRIES
        : Math.max(0, MAX_USER_DICTIONARY_ENTRIES - customDictionary.length);
    const capacitySkipped = Math.max(0, requestedImportCount - availableSlots);
    return {
      parsedCount: parsedEntries.length,
      uniqueWords,
      uniqueWordsCount: uniqueWords.length,
      importableCount: requestedImportCount - capacitySkipped,
      capacitySkipped,
      duplicatesRemoved: Math.max(
        0,
        parsedEntries.length - uniqueWords.length - invalidEntriesRemoved
      ),
      invalidEntriesRemoved,
    };
  }, [customDictionary, dictionaryBatchText, dictionaryImportMode]);

  const handleAddDictionaryWord = useCallback(() => {
    const word = normalizeDictionaryEntry(newDictionaryWord);
    if (!word && newDictionaryWord.trim()) {
      toast({
        title: "Use one lexical term",
        description: "Add a single word, name, or identifier of up to 80 characters.",
        variant: "destructive",
      });
      return;
    }
    if (word) {
      const alreadyStored = customDictionary.some(
        (entry) => entry.toLocaleLowerCase() === word.toLocaleLowerCase()
      );
      if (!alreadyStored && customDictionary.length >= MAX_USER_DICTIONARY_ENTRIES) {
        toast({
          title: "Dictionary limit reached",
          description: `Remove a term before adding another. EchoDraft uses up to ${MAX_USER_DICTIONARY_ENTRIES} custom terms.`,
          variant: "destructive",
        });
      } else if (!alreadyStored) {
        setCustomDictionary(dedupeDictionaryEntries([...customDictionary, word]));
      }
      setNewDictionaryWord("");
    }
  }, [newDictionaryWord, customDictionary, setCustomDictionary, toast]);

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
      const availableSlots = Math.max(0, MAX_USER_DICTIONARY_ENTRIES - customDictionary.length);
      const existingKeys = new Set(customDictionary.map((word) => word.toLocaleLowerCase()));
      const mergeAdditions = batchWords
        .filter((word) => !existingKeys.has(word.toLocaleLowerCase()))
        .slice(0, availableSlots);
      const nextWords =
        dictionaryImportMode === "replace"
          ? dedupeDictionaryEntries(batchWords)
          : dedupeDictionaryEntries(
              [...customDictionary, ...mergeAdditions],
              MAX_STORED_DICTIONARY_ENTRIES
            );

      const addedCount = Math.max(0, nextWords.length - customDictionary.length);
      const requestedNewCount = batchWords.filter(
        (word) =>
          !customDictionary.some(
            (existing) => existing.toLocaleLowerCase() === word.toLocaleLowerCase()
          )
      ).length;
      const capacityRemoved =
        dictionaryImportMode === "merge"
          ? Math.max(0, requestedNewCount - addedCount)
          : Math.max(0, batchWords.length - nextWords.length);
      const replacedCount = customDictionary.length;
      setCustomDictionary(nextWords);

      toast({
        title: dictionaryImportMode === "replace" ? "Dictionary replaced" : "Dictionary merged",
        description:
          dictionaryImportMode === "replace"
            ? `Replaced ${replacedCount} existing words with ${nextWords.length} imported words${capacityRemoved ? `; ${capacityRemoved} skipped at the ${MAX_USER_DICTIONARY_ENTRIES}-term limit` : ""}.`
            : `Merged ${batchWords.length} valid unique terms (${addedCount} new additions${capacityRemoved ? `; ${capacityRemoved} skipped at the ${MAX_USER_DICTIONARY_ENTRIES}-term limit` : ""}).`,
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
        description: `Loaded ${importedWords.length} valid unique terms from file${result.unsupportedRemoved ? `; skipped ${result.unsupportedRemoved} unsupported entries` : ""}${result.capacityRemoved ? `; skipped ${result.capacityRemoved} beyond the ${MAX_USER_DICTIONARY_ENTRIES}-term limit` : ""}.`,
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
          importableCount: dictionaryBatchPreview.importableCount,
          capacitySkipped: dictionaryBatchPreview.capacitySkipped,
          duplicatesRemoved: dictionaryBatchPreview.duplicatesRemoved,
          invalidEntriesRemoved: dictionaryBatchPreview.invalidEntriesRemoved,
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
