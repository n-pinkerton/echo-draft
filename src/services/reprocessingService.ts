import type {
  ReprocessingAlternative,
  ReprocessingMode,
  TodoItem,
  TranscriptionItem,
} from "../types/electron";
import logger from "../utils/logger";
import ReasoningService from "./ReasoningService";
import { ReasoningCleanupService } from "../helpers/audio/reasoning/reasoningCleanupService";

type ReprocessableItem = TranscriptionItem | TodoItem;

type ReprocessingDependencies = {
  process: (
    rawText: string,
    mode: ReprocessingMode,
    applicationProcessName?: string | null
  ) => Promise<{ text: string; title?: string; cleanup?: Record<string, unknown> }>;
  save: (payload: {
    transcriptionId?: number;
    todoId?: number;
    mode: ReprocessingMode;
    text: string;
    meta?: Record<string, unknown>;
  }) => Promise<{ success: boolean; alternative: ReprocessingAlternative }>;
  copy: (text: string) => Promise<{ success: boolean }>;
};

export type ReprocessingResult = {
  alternative: ReprocessingAlternative;
  copied: boolean;
};

const isAcceptedCleanupOutcome = (cleanup: Record<string, unknown> | undefined) =>
  cleanup?.attempted === true &&
  (cleanup.status === "applied" || cleanup.status === "unchanged") &&
  (cleanup.fallbackReason === null || cleanup.fallbackReason === undefined);

export const createReprocessingAction =
  (dependencies: ReprocessingDependencies) =>
  async (
    item: ReprocessableItem,
    sourceType: "transcription" | "todo",
    mode: ReprocessingMode
  ): Promise<ReprocessingResult> => {
    const rawText = typeof item.raw_text === "string" ? item.raw_text : "";
    if (!rawText.trim()) {
      const error = new Error("Raw transcription is unavailable for this item.") as Error & {
        code?: string;
      };
      error.code = "RAW_TRANSCRIPTION_UNAVAILABLE";
      throw error;
    }

    const applicationProcessName =
      typeof item.meta?.applicationProcessName === "string"
        ? item.meta.applicationProcessName
        : null;
    const result = await dependencies.process(rawText, mode, applicationProcessName);
    if (typeof result.text !== "string" || !result.text.trim()) {
      throw new Error("Reprocessing returned no text.");
    }
    if (!isAcceptedCleanupOutcome(result.cleanup)) {
      throw new Error(
        "EchoDraft could not produce an accepted alternative. The source stayed unchanged."
      );
    }

    const saved = await dependencies.save({
      ...(sourceType === "transcription" ? { transcriptionId: item.id } : { todoId: item.id }),
      mode,
      text: result.text,
      meta: {
        ...(result.title ? { title: result.title } : {}),
        ...(result.cleanup ? { cleanup: result.cleanup } : {}),
      },
    });
    if (!saved?.success || !saved.alternative) {
      throw new Error("Could not save the reprocessed alternative.");
    }
    let copied = false;
    try {
      const copyResult = await dependencies.copy(result.text);
      copied = copyResult?.success === true;
    } catch {
      copied = false;
    }
    return { alternative: saved.alternative, copied };
  };

const cleanupService = new ReasoningCleanupService({
  logger,
  reasoningService: ReasoningService,
});

export const reprocessStoredItem = createReprocessingAction({
  process: async (rawText, mode, applicationProcessName) =>
    cleanupService.processTranscriptionWithOutcome(rawText, "stored-raw", true, {
      ...(mode === "codex-prompt" ? { processingMode: "codex-prompt" } : {}),
      ...(applicationProcessName ? { applicationProcessName } : {}),
    }),
  save: (payload) => window.electronAPI.saveReprocessingAlternative(payload),
  copy: async (text) => {
    await navigator.clipboard.writeText(text);
    return { success: true };
  },
});
