import ReasoningService from "../services/ReasoningService";
import logger from "../utils/logger";
import { withSessionRefresh } from "../lib/neonAuth";
import {
  cleanupStreaming,
  cleanupStreamingAudio,
  cleanupStreamingListeners,
  getOrCreateAudioContext,
  startStreamingRecording,
  stopStreamingRecording,
  warmupStreamingConnection,
} from "./audio/streaming/assemblyAiStreamingController";
import { StreamingWorkletManager } from "./audio/streaming/streamingWorkletManager";
import {
  cancelNonStreamingRecording,
  startNonStreamingRecording,
  stopNonStreamingRecording,
} from "./audio/recording/nonStreamingRecording";
import { CloudTranscriber } from "./audio/transcription/cloudTranscriber";
import { LocalTranscriber } from "./audio/transcription/localTranscriber";
import { OpenAiTranscriber } from "./audio/transcription/openAiTranscriber";
import { ReasoningCleanupService } from "./audio/reasoning/reasoningCleanupService";
import { MicrophoneService } from "./audio/microphone/microphoneService";
import { TranscriptionPipeline } from "./audio/pipeline/transcriptionPipeline";
import { ProcessingQueue } from "./audio/pipeline/processingQueue";
import {
  emitError as emitAudioError,
  emitProgress as emitAudioProgress,
  emitStateChange as emitAudioStateChange,
} from "./audio/events/audioManagerEvents";
import { saveDebugAudioCaptureIfEnabled as saveDebugAudioCapture } from "./audio/debug/debugAudioCaptureClient";
import {
  safePaste as safePasteImpl,
  saveTranscription as saveTranscriptionImpl,
} from "./audio/persistence/audioPersistence";
const REASONING_CACHE_TTL = 30000; // 30 seconds
const STREAMING_WORKLET_FLUSH_DONE_MESSAGE = "__openwhispr_stream_worklet_flush_done__";
class AudioManager {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.isProcessing = false;
    this.processingQueue = null;
    this.activeProcessingContext = null;
    this.onStateChange = null;
    this.onError = null;
    this.onTranscriptionComplete = null;
    this.onPartialTranscript = null;
    this.onProgress = null;
    this.recordingStartTime = null;
    this.reasoningCleanupService = new ReasoningCleanupService({
      logger,
      reasoningService: ReasoningService,
      cacheTtlMs: REASONING_CACHE_TTL,
    });
    this.withSessionRefresh = withSessionRefresh;
    this.openAiTranscriber = new OpenAiTranscriber({
      logger,
      emitProgress: (payload) => this.emitProgress(payload),
      shouldApplyReasoningCleanup: () => this.shouldApplyReasoningCleanup(),
      getCleanupEnabledOverride: () => this.getCleanupEnabledOverride(),
      reasoningCleanupService: this.reasoningCleanupService,
    });
    this.localTranscriber = new LocalTranscriber({
      logger,
      emitProgress: (payload) => this.emitProgress(payload),
      shouldApplyReasoningCleanup: () => this.shouldApplyReasoningCleanup(),
      getCleanupEnabledOverride: () => this.getCleanupEnabledOverride(),
      reasoningCleanupService: this.reasoningCleanupService,
      openAiTranscriber: this.openAiTranscriber,
    });
    this.cloudTranscriber = new CloudTranscriber({
      logger,
      emitProgress: (payload) => this.emitProgress(payload),
      withSessionRefresh,
      getCleanupEnabledOverride: () => this.getCleanupEnabledOverride(),
      reasoningCleanupService: this.reasoningCleanupService,
    });
    this.microphoneService = new MicrophoneService({ logger });
    this.transcriptionPipeline = new TranscriptionPipeline({
      logger,
      emitProgress: (payload) => this.emitProgress(payload),
      emitError: (payload, caughtError) => this.emitError(payload, caughtError),
      shouldContinue: () => this.isProcessing,
      getOnTranscriptionComplete: () => this.onTranscriptionComplete,
      openAiTranscriber: this.openAiTranscriber,
      localTranscriber: this.localTranscriber,
      cloudTranscriber: this.cloudTranscriber,
    });
    this.processingQueue = new ProcessingQueue({
      logger,
      getIsProcessing: () => this.isProcessing,
      setIsProcessing: (value) => {
        this.isProcessing = value;
        this.emitStateChange({
          isRecording: this.isRecording,
          isProcessing: value,
          isStreaming: this.isStreaming,
        });
      },
      setActiveContext: (context) => {
        this.activeProcessingContext = context;
      },
      processJob: async (audioBlob, metadata) => {
        await this.processAudio(audioBlob, metadata);
      },
    });
    this._onApiKeyChanged = () => {
      this.openAiTranscriber.resetApiKeyCache();
    };
    window.addEventListener("api-key-changed", this._onApiKeyChanged);
    this.isStreaming = false;
    this.pendingNonStreamingStopContext = null;
    this.pendingNonStreamingStopRequestedAt = null;
    this.isStopping = false;
    this.pendingStopContext = null;
    this.streamingAudioForwarding = false;
    this.streamingAudioChunkCount = 0;
    this.streamingAudioBytesSent = 0;
    this.streamingAudioFirstChunkAt = null;
    this.streamingAudioLastChunkAt = null;
    // Exposed for unit tests (regression guard for streaming flush handling).
    this.STREAMING_WORKLET_FLUSH_DONE_MESSAGE = STREAMING_WORKLET_FLUSH_DONE_MESSAGE;
    this.streamingContext = null;
    this.streamingAudioContext = null;
    this.streamingSource = null;
    this.streamingProcessor = null;
    this.streamingStream = null;
    this.streamingCleanupFns = [];
    this.streamingFinalText = "";
    this.streamingPartialText = "";
    this.streamingTextResolve = null;
    this.streamingTextDebounce = null;
    this.persistentAudioContext = null;
    this.workletModuleLoaded = false;
    this.streamingWorklet = new StreamingWorkletManager({
      logger,
      flushDoneMessage: STREAMING_WORKLET_FLUSH_DONE_MESSAGE,
      shouldForward: () => this.streamingAudioForwarding,
      onAudioChunk: (buffer) => {
        this.streamingAudioChunkCount += 1;
        this.streamingAudioBytesSent += buffer.byteLength;
        const now = Date.now();
        if (!this.streamingAudioFirstChunkAt) {
          this.streamingAudioFirstChunkAt = now;
        }
        this.streamingAudioLastChunkAt = now;
        if (typeof window !== "undefined" && window.__openwhisprLogLevel === "trace") {
          logger.trace(
            "Streaming audio chunk forwarded",
            {
              sessionId: this.streamingContext?.sessionId || null,
              chunkIndex: this.streamingAudioChunkCount,
              bytes: buffer.byteLength,
              totalBytes: this.streamingAudioBytesSent,
            },
            "streaming"
          );
        }
        try {
          window.electronAPI?.assemblyAiStreamingSend?.(buffer);
        } catch {
          // Ignore send failures (e.g., page unloading)
        }
      },
    });
  }
  get cachedMicDeviceId() {
    return this.microphoneService?.cachedMicDeviceId || null;
  }

  set cachedMicDeviceId(value) {
    if (this.microphoneService) {
      this.microphoneService.cachedMicDeviceId = value;
    }
  }

  get micDriverWarmedUp() {
    return Boolean(this.microphoneService?.micDriverWarmedUp);
  }

  setCallbacks({
    onStateChange,
    onError,
    onTranscriptionComplete,
    onPartialTranscript,
    onProgress,
  }) {
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.onTranscriptionComplete = onTranscriptionComplete;
    this.onPartialTranscript = onPartialTranscript;
    this.onProgress = onProgress;
  }

  emitStateChange(nextState) {
    emitAudioStateChange(this, nextState);
  }

  emitError(payload, caughtError = null) {
    emitAudioError(this, payload, caughtError);
  }

  emitProgress(event = {}) {
    emitAudioProgress(this, event);
  }

  async saveDebugAudioCaptureIfEnabled(audioBlob, payload = {}) {
    await saveDebugAudioCapture(audioBlob, payload);
  }

  getCleanupEnabledOverride() {
    const value = this.activeProcessingContext?.cleanupEnabled;
    return typeof value === "boolean" ? value : null;
  }

  shouldApplyReasoningCleanup() {
    if (typeof window === "undefined" || !window.localStorage) {
      return false;
    }

    const override = this.getCleanupEnabledOverride();
    if (override === false) {
      return false;
    }

    const reasoningModel = localStorage.getItem("reasoningModel") || "";
    if (!reasoningModel.trim()) {
      return false;
    }

    if (override === true) {
      return true;
    }

    const enabled = localStorage.getItem("useReasoningModel");
    if (!enabled || enabled === "false") {
      return false;
    }

    return true;
  }

  async isReasoningAvailable() {
    return await this.reasoningCleanupService.isReasoningAvailable(this.getCleanupEnabledOverride());
  }

  async getAudioConstraints() {
    return await this.microphoneService.getAudioConstraints();
  }

  async cacheMicrophoneDeviceId() {
    await this.microphoneService.cacheMicrophoneDeviceId();
  }

  async getMicrophonePermissionState() {
    return await this.microphoneService.getMicrophonePermissionState();
  }

  async warmupMicrophoneDriver() {
    return await this.microphoneService.warmupMicrophoneDriver();
  }

  async startRecording(context = null) {
    return await startNonStreamingRecording(this, context);
  }

  stopRecording(stopContext = null) {
    return stopNonStreamingRecording(this, stopContext);
  }

  cancelRecording() {
    return cancelNonStreamingRecording(this);
  }

  cancelProcessing() {
    if (this.isProcessing || this.processingQueue.length > 0) {
      this.isProcessing = false;
      this.processingQueue.cancel();
      this.activeProcessingContext = null;
      this.emitStateChange({
        isRecording: this.isRecording,
        isProcessing: false,
        isStreaming: this.isStreaming,
      });
      this.emitProgress({
        stage: "cancelled",
        stageLabel: "Cancelled",
      });
      return true;
    }
    return false;
  }

  enqueueProcessingJob(audioBlob, metadata = {}, context = null) {
    this.processingQueue.enqueue(audioBlob, metadata, context);
  }

  startQueuedProcessingIfPossible() {
    this.processingQueue.startIfPossible();
  }

  async processAudio(audioBlob, metadata = {}) {
    await this.transcriptionPipeline.processAudio(audioBlob, metadata, this.activeProcessingContext);
  }

  async readTranscriptionStream(response) {
    return await this.openAiTranscriber.readTranscriptionStream(response);
  }

  async safePaste(text, options = {}) {
    return await safePasteImpl(this, text, options);
  }

  async saveTranscription(payload) {
    return await saveTranscriptionImpl(payload);
  }

  getState() {
    return {
      isRecording: this.isRecording,
      isProcessing: this.isProcessing,
      isStreaming: this.isStreaming,
    };
  }

  shouldUseStreaming() {
    const cloudTranscriptionMode = localStorage.getItem("cloudTranscriptionMode") || "openwhispr";
    const isSignedIn = localStorage.getItem("isSignedIn") === "true";
    const useLocalWhisper = localStorage.getItem("useLocalWhisper") === "true";
    const streamingDisabled = localStorage.getItem("assemblyAiStreaming") === "false";

    return (
      !useLocalWhisper &&
      cloudTranscriptionMode === "openwhispr" &&
      isSignedIn &&
      !streamingDisabled
    );
  }

  async warmupStreamingConnection() {
    return await warmupStreamingConnection(this);
  }

  async getOrCreateAudioContext() {
    return await getOrCreateAudioContext(this);
  }

  async startStreamingRecording(context = null) {
    return await startStreamingRecording(this, context);
  }

  async stopStreamingRecording() {
    return await stopStreamingRecording(this);
  }

  cleanupStreamingAudio() {
    cleanupStreamingAudio(this);
  }

  cleanupStreamingListeners() {
    cleanupStreamingListeners(this);
  }

  async cleanupStreaming() {
    await cleanupStreaming(this);
  }

  cleanup() {
    if (this.isStreaming) {
      this.cleanupStreaming();
    }
    if (this.mediaRecorder?.state === "recording") {
      this.stopRecording({ reason: "cleanup", source: "cleanup" });
    }
    if (this.persistentAudioContext && this.persistentAudioContext.state !== "closed") {
      this.persistentAudioContext.close().catch(() => {});
      this.persistentAudioContext = null;
      this.workletModuleLoaded = false;
      this.streamingWorklet?.dispose?.();
    }
    try {
      window.electronAPI?.assemblyAiStreamingStop?.();
    } catch (e) {
      // Ignore errors during cleanup (page may be unloading)
    }
    this.onStateChange = null;
    this.onError = null;
    this.onTranscriptionComplete = null;
    this.onPartialTranscript = null;
    this.onProgress = null;
    if (this._onApiKeyChanged) {
      window.removeEventListener("api-key-changed", this._onApiKeyChanged);
    }
  }
}

export default AudioManager;
