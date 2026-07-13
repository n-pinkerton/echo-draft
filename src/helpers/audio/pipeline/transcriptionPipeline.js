import {
  ECHO_DRAFT_CLOUD_MODE,
  ECHO_DRAFT_CLOUD_MODEL,
  ECHO_DRAFT_CLOUD_SOURCE,
  isEchoDraftCloudMode,
} from "../../../utils/branding";
import { analyzeAudioBlobLevel, getLowAudioRejection } from "../audioLevelAnalysis";
import { isTranscriptionCancelled, throwIfTranscriptionCancelled } from "./cancellation";

/**
 * TranscriptionPipeline
 *
 * Focused orchestration layer for turning an audio blob into a transcript.
 * AudioManager composes this with recording + queueing, keeping responsibilities separated.
 */
export class TranscriptionPipeline {
  /**
   * @param {{
   *   logger: any,
   *   emitProgress: (payload: any) => void,
   *   emitError: (payload: any, caughtError?: any) => void,
   *   shouldContinue: () => boolean,
   *   getOnTranscriptionComplete: () => ((payload: any) => void) | null,
   *   openAiTranscriber: any,
   *   localTranscriber: any,
   *   cloudTranscriber: any,
   *   audioLevelAnalyzer?: (audioBlob: Blob) => Promise<any>,
   * }} deps
   */
  constructor(deps) {
    this.logger = deps.logger;
    this.emitProgress = deps.emitProgress;
    this.emitError = deps.emitError;
    this.shouldContinue = deps.shouldContinue;
    this.getOnTranscriptionComplete = deps.getOnTranscriptionComplete;
    this.openAiTranscriber = deps.openAiTranscriber;
    this.localTranscriber = deps.localTranscriber;
    this.cloudTranscriber = deps.cloudTranscriber;
    this.audioLevelAnalyzer = deps.audioLevelAnalyzer || analyzeAudioBlobLevel;
  }

  async processAudio(audioBlob, metadata = {}, context = null, runtime = {}) {
    const pipelineStart = performance.now();
    let audioLevel = null;
    const signal = runtime?.signal || null;

    try {
      throwIfTranscriptionCancelled(signal);
      audioLevel = await this.checkAudioLevelBeforeTranscription(audioBlob, metadata, context);
      throwIfTranscriptionCancelled(signal);

      const useLocalWhisper = localStorage.getItem("useLocalWhisper") === "true";
      const localProvider = localStorage.getItem("localTranscriptionProvider") || "whisper";
      const whisperModel = localStorage.getItem("whisperModel") || "base";
      const parakeetModel = localStorage.getItem("parakeetModel") || "parakeet-tdt-0.6b-v3";

      const cloudTranscriptionMode =
        localStorage.getItem("cloudTranscriptionMode") || ECHO_DRAFT_CLOUD_MODE;
      const isSignedIn = localStorage.getItem("isSignedIn") === "true";

      const useCloud =
        !useLocalWhisper && isEchoDraftCloudMode(cloudTranscriptionMode) && isSignedIn;
      this.logger.debug(
        "Transcription routing",
        { useLocalWhisper, useCloud, isSignedIn, cloudTranscriptionMode },
        "transcription"
      );

      let result;
      let activeModel;

      if (useLocalWhisper) {
        if (localProvider === "nvidia") {
          this.emitProgress({
            stage: "transcribing",
            stageLabel: "Transcribing",
            provider: "local-parakeet",
            model: parakeetModel,
          });
          activeModel = parakeetModel;
          result = await this.localTranscriber.processWithLocalParakeet(
            audioBlob,
            parakeetModel,
            metadata
          );
        } else {
          this.emitProgress({
            stage: "transcribing",
            stageLabel: "Transcribing",
            provider: "local-whisper",
            model: whisperModel,
          });
          activeModel = whisperModel;
          result = await this.localTranscriber.processWithLocalWhisper(
            audioBlob,
            whisperModel,
            metadata
          );
        }
      } else if (useCloud) {
        this.emitProgress({
          stage: "transcribing",
          stageLabel: "Transcribing",
          provider: ECHO_DRAFT_CLOUD_SOURCE,
          model: ECHO_DRAFT_CLOUD_MODEL,
        });
        activeModel = ECHO_DRAFT_CLOUD_MODEL;
        result = await this.cloudTranscriber.processWithEchoDraftCloud(audioBlob, metadata);
      } else {
        activeModel = this.openAiTranscriber.getTranscriptionModel();
        this.emitProgress({
          stage: "transcribing",
          stageLabel: "Transcribing",
          provider: localStorage.getItem("cloudTranscriptionProvider") || "openai",
          model: activeModel,
        });
        result = await this.openAiTranscriber.processWithOpenAIAPI(audioBlob, metadata, { signal });
      }

      throwIfTranscriptionCancelled(signal);
      if (!this.shouldContinue()) {
        return;
      }

      const metadataTimingsPatch = {
        audioSizeBytes: audioBlob.size,
        audioFormat: audioBlob.type,
        hotkeyToStartCallMs: metadata.hotkeyToStartCallMs ?? null,
        hotkeyToRecorderStartMs: metadata.hotkeyToRecorderStartMs ?? null,
        startConstraintsMs: metadata.startConstraintsMs ?? null,
        startGetUserMediaMs: metadata.startGetUserMediaMs ?? null,
        startMediaRecorderInitMs: metadata.startMediaRecorderInitMs ?? null,
        startMediaRecorderStartMs: metadata.startMediaRecorderStartMs ?? null,
        startTotalMs: metadata.startTotalMs ?? null,
        stopReason: metadata.stopReason || null,
        stopSource: metadata.stopSource || null,
        stopRequestedAt: metadata.stopRequestedAt || null,
        stopLatencyMs: metadata.stopLatencyMs ?? null,
        stopAudioBlobAt: metadata.stopAudioBlobAt || null,
        stopLatencyToFlushStartMs: metadata.stopLatencyToFlushStartMs ?? null,
        stopFlushMs: metadata.stopFlushMs ?? null,
        chunksCount: metadata.chunksCount ?? null,
        chunksBeforeStopWait: metadata.chunksBeforeStopWait ?? null,
        chunksAfterStopWait: metadata.chunksAfterStopWait ?? null,
        audioPeakDbFS: audioLevel?.peakDbFS ?? null,
        audioRmsDbFS: audioLevel?.rmsDbFS ?? null,
      };

      const resultWithDiagnostics = {
        ...result,
        timings: {
          ...(result?.timings || {}),
          ...metadataTimingsPatch,
        },
      };

      await Promise.resolve(
        this.getOnTranscriptionComplete?.()?.({
          ...resultWithDiagnostics,
          context,
        })
      );
      throwIfTranscriptionCancelled(signal);

      const roundTripDurationMs = Math.round(performance.now() - pipelineStart);

      const timingData = {
        mode: useLocalWhisper ? `local-${localProvider}` : "cloud",
        model: activeModel,
        audioDurationMs: metadata.durationSeconds
          ? Math.round(metadata.durationSeconds * 1000)
          : null,
        hotkeyToStartCallMs: metadata.hotkeyToStartCallMs ?? null,
        hotkeyToRecorderStartMs: metadata.hotkeyToRecorderStartMs ?? null,
        stopReason: metadata.stopReason || null,
        stopSource: metadata.stopSource || null,
        stopRequestedAt: metadata.stopRequestedAt || null,
        stopLatencyMs: metadata.stopLatencyMs || null,
        stopAudioBlobAt: metadata.stopAudioBlobAt || null,
        reasoningProcessingDurationMs:
          resultWithDiagnostics?.timings?.reasoningProcessingDurationMs ?? null,
        roundTripDurationMs,
        audioSizeBytes: audioBlob.size,
        audioFormat: audioBlob.type,
        audioPeakDbFS: audioLevel?.peakDbFS ?? null,
        audioRmsDbFS: audioLevel?.rmsDbFS ?? null,
        outputTextLength: result?.text?.length,
      };

      if (useLocalWhisper) {
        timingData.audioConversionDurationMs =
          resultWithDiagnostics?.timings?.audioConversionDurationMs ?? null;
      }
      timingData.transcriptionProcessingDurationMs =
        resultWithDiagnostics?.timings?.transcriptionProcessingDurationMs ?? null;

      this.logger.info("Pipeline timing", timingData, "performance");
    } catch (error) {
      const errorAtMs = Math.round(performance.now() - pipelineStart);
      const errorMessage = error?.message || String(error);

      if (isTranscriptionCancelled(error, signal)) {
        this.logger.info(
          "Pipeline cancelled",
          { errorAtMs, sessionId: context?.sessionId || null, jobId: context?.jobId ?? null },
          "performance"
        );
        return;
      }

      this.logger.error(
        "Pipeline failed",
        {
          errorAtMs,
          error: errorMessage,
        },
        "performance"
      );

      if (errorMessage !== "No audio detected") {
        this.emitProgress({
          stage: "error",
          stageLabel: "Error",
          message: errorMessage,
        });
        this.emitError(
          {
            title: "Transcription Error",
            description: `Transcription failed: ${errorMessage}`,
            code: error?.code,
          },
          error
        );
      }
    } finally {
      // Processing state is managed by the caller (queue or streaming finalize).
    }
  }

  async checkAudioLevelBeforeTranscription(audioBlob, metadata = {}, context = null) {
    let audioLevel;
    try {
      audioLevel = await this.audioLevelAnalyzer?.(audioBlob, metadata, context);
    } catch (error) {
      this.logger.warn(
        "Audio level analysis failed; continuing transcription",
        { error: error?.message || String(error), context },
        "audio"
      );
      return null;
    }

    if (!audioLevel?.available) {
      this.logger.debug(
        "Audio level analysis unavailable",
        { reason: audioLevel?.reason || "unknown" },
        "audio"
      );
      return null;
    }

    const rejection = getLowAudioRejection(audioLevel, metadata);
    if (!rejection) {
      this.logger.debug(
        "Audio level check passed",
        {
          peakDbFS: audioLevel.peakDbFS,
          rmsDbFS: audioLevel.rmsDbFS,
          durationSeconds: metadata.durationSeconds ?? audioLevel.durationSeconds ?? null,
          microphoneLabel: metadata.microphoneLabel || null,
        },
        "audio"
      );
      return audioLevel;
    }

    this.logger.warn(
      "Recording audio level too low for transcription",
      {
        ...rejection,
        microphoneLabel: metadata.microphoneLabel || null,
        context,
      },
      "audio"
    );

    const error = new Error(rejection.message);
    error.code = rejection.code;
    error.details = rejection;
    throw error;
  }
}
