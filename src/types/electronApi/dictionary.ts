import type { AudioFileSelectionResult, DictionaryExportResult, DictionaryImportResult } from "../electron";

export interface ElectronAPIDictionary {
  // Dictionary operations
  getDictionary: () => Promise<string[]>;
  setDictionary: (words: string[]) => Promise<{ success: boolean }>;
  importDictionaryFile?: () => Promise<DictionaryImportResult>;
  exportDictionary?: (format?: "txt" | "csv") => Promise<DictionaryExportResult>;
  selectAudioFileForTranscription?: () => Promise<AudioFileSelectionResult>;
  e2eExportDictionary?: (
    format: "txt" | "csv",
    filePath: string
  ) => Promise<{
    success: boolean;
    format?: "txt" | "csv";
    filePath?: string;
    count?: number;
    error?: string;
  }>;
  e2eImportDictionary?: (filePath: string) => Promise<DictionaryImportResult>;
}

