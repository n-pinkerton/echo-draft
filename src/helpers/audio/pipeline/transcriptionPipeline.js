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
  }

  async processAudio(audioBlob, metadata = {}, context = null) {
    const pipelineStart = performance.now();

    try {
      const useLocalWhisper = localStorage.getItem("useLocalWhisper") === "true";
      const localProvider = localStorage.getItem("localTranscriptionProvider") || "whisper";
      const whisperModel = localStorage.getItem("whisperModel") || "base";
      const parakeetModel = localStorage.getItem("parakeetModel") || "parakeet-tdt-0.6b-v3";

      const cloudTranscriptionMode =
        localStorage.getItem("cloudTranscriptionMode") || "openwhispr";
      const isSignedIn = localStorage.getItem("isSignedIn") === "true";

      const isEchoDraftCloudMode = !useLocalWhisper && cloudTranscriptionMode === "openwhispr";
      const useCloud = isEchoDraftCloudMode && isSignedIn;
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
          provider: "openwhispr",
          model: "openwhispr-cloud",
        });
        activeModel = "openwhispr-cloud";
        result = await this.cloudTranscriber.processWithEchoDraftCloud(audioBlob, metadata);
      } else {
        activeModel = this.openAiTranscriber.getTranscriptionModel();
        this.emitProgress({
          stage: "transcribing",
          stageLabel: "Transcribing",
          provider: localStorage.getItem("cloudTranscriptionProvider") || "openai",
          model: activeModel,
        });
        result = await this.openAiTranscriber.processWithOpenAIAPI(audioBlob, metadata);
      }

      if (!this.shouldContinue()) {
        return;
      }

      if (typeof window !== "undefined" && window.__openwhisprLogLevel === "trace") {
        const rawText = typeof result?.rawText === "string" ? result.rawText : null;
        const cleanedText = typeof result?.text === "string" ? result.text : null;
        this.logger.trace(
          "Transcription result text",
          {
            context,
            source: result?.source || null,
            rawLength: rawText?.length ?? null,
            cleanedLength: cleanedText?.length ?? null,
            rawEqualsCleaned:
              rawText != null && cleanedText != null ? rawText === cleanedText : null,
            rawText,
            cleanedText,
          },
          "transcription"
        );
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
}
