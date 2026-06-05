import { describe, expect, it, vi, beforeEach } from "vitest";

import { TranscriptionPipeline } from "./transcriptionPipeline";

describe("TranscriptionPipeline", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("routes to BYOK/OpenAI provider when not signed in and enriches timings", async () => {
    const logger = { debug: vi.fn(), trace: vi.fn(), info: vi.fn(), error: vi.fn() };
    const emitProgress = vi.fn();
    const emitError = vi.fn();
    const onTranscriptionComplete = vi.fn();

    const openAiTranscriber = {
      getTranscriptionModel: () => "gpt-4o-mini-transcribe",
      processWithOpenAIAPI: vi.fn(async () => ({
        success: true,
        text: "Hello",
        rawText: "Hello",
        source: "openai",
        timings: { transcriptionProcessingDurationMs: 5 },
      })),
    };

    const pipeline = new TranscriptionPipeline({
      logger,
      emitProgress,
      emitError,
      shouldContinue: () => true,
      getOnTranscriptionComplete: () => onTranscriptionComplete,
      openAiTranscriber,
      localTranscriber: { processWithLocalWhisper: vi.fn(), processWithLocalParakeet: vi.fn() },
      cloudTranscriber: { processWithEchoDraftCloud: vi.fn() },
    });

    localStorage.setItem("useLocalWhisper", "false");
    localStorage.setItem("isSignedIn", "false");

    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const context = { sessionId: "s1", outputMode: "clipboard", jobId: 1 };

    await pipeline.processAudio(
      audioBlob,
      {
        durationSeconds: 1,
        hotkeyToStartCallMs: 40,
        hotkeyToRecorderStartMs: 55,
        startConstraintsMs: 5,
        startGetUserMediaMs: 12,
        startMediaRecorderInitMs: 2,
        startMediaRecorderStartMs: 3,
        startTotalMs: 22,
        stopReason: "manual",
        stopSource: "manual",
        chunksCount: 2,
      },
      context
    );

    expect(openAiTranscriber.processWithOpenAIAPI).toHaveBeenCalledTimes(1);
    expect(onTranscriptionComplete).toHaveBeenCalledTimes(1);

    const payload = onTranscriptionComplete.mock.calls[0][0];
    expect(payload.context).toEqual(context);
    expect(payload.timings).toMatchObject({
      transcriptionProcessingDurationMs: 5,
      audioSizeBytes: 3,
      audioFormat: "audio/webm",
      hotkeyToStartCallMs: 40,
      hotkeyToRecorderStartMs: 55,
      startConstraintsMs: 5,
      startGetUserMediaMs: 12,
      startMediaRecorderInitMs: 2,
      startMediaRecorderStartMs: 3,
      startTotalMs: 22,
      stopReason: "manual",
      stopSource: "manual",
      chunksCount: 2,
    });
  });

  it("does not invoke completion callback when shouldContinue becomes false", async () => {
    const logger = { debug: vi.fn(), trace: vi.fn(), info: vi.fn(), error: vi.fn() };
    const onTranscriptionComplete = vi.fn();

    const openAiTranscriber = {
      getTranscriptionModel: () => "gpt-4o-mini-transcribe",
      processWithOpenAIAPI: vi.fn(async () => ({
        success: true,
        text: "Hello",
        rawText: "Hello",
        source: "openai",
        timings: {},
      })),
    };

    const pipeline = new TranscriptionPipeline({
      logger,
      emitProgress: vi.fn(),
      emitError: vi.fn(),
      shouldContinue: () => false,
      getOnTranscriptionComplete: () => onTranscriptionComplete,
      openAiTranscriber,
      localTranscriber: { processWithLocalWhisper: vi.fn(), processWithLocalParakeet: vi.fn() },
      cloudTranscriber: { processWithEchoDraftCloud: vi.fn() },
    });

    const audioBlob = new Blob([new Uint8Array([1])], { type: "audio/webm" });
    await pipeline.processAudio(audioBlob, {}, { sessionId: "s2" });

    expect(openAiTranscriber.processWithOpenAIAPI).toHaveBeenCalledTimes(1);
    expect(onTranscriptionComplete).not.toHaveBeenCalled();
  });

  it("rejects near-silent recordings before sending them to a transcriber", async () => {
    const logger = {
      debug: vi.fn(),
      trace: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const emitProgress = vi.fn();
    const emitError = vi.fn();
    const onTranscriptionComplete = vi.fn();

    const openAiTranscriber = {
      getTranscriptionModel: () => "gpt-4o-mini-transcribe",
      processWithOpenAIAPI: vi.fn(),
    };

    const pipeline = new TranscriptionPipeline({
      logger,
      emitProgress,
      emitError,
      shouldContinue: () => true,
      getOnTranscriptionComplete: () => onTranscriptionComplete,
      openAiTranscriber,
      localTranscriber: { processWithLocalWhisper: vi.fn(), processWithLocalParakeet: vi.fn() },
      cloudTranscriber: { processWithEchoDraftCloud: vi.fn() },
      audioLevelAnalyzer: vi.fn(async () => ({
        available: true,
        durationSeconds: 18.9,
        peakDbFS: -43.7,
        rmsDbFS: -69.3,
      })),
    });

    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    await pipeline.processAudio(
      audioBlob,
      { durationSeconds: 18.9, microphoneLabel: "Desk USB Mic" },
      { sessionId: "s-low" }
    );

    expect(openAiTranscriber.processWithOpenAIAPI).not.toHaveBeenCalled();
    expect(onTranscriptionComplete).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Recording audio level too low for transcription",
      expect.objectContaining({
        code: "LOW_AUDIO_LEVEL",
        microphoneLabel: "Desk USB Mic",
        peakDbFS: -43.7,
        rmsDbFS: -69.3,
      }),
      "audio"
    );
    expect(emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "error",
        message:
          "Selected microphone is too quiet or not receiving speech. Check the input device and microphone level, then try again.",
      })
    );
    expect(emitError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "LOW_AUDIO_LEVEL" }),
      expect.any(Error)
    );
  });
});
