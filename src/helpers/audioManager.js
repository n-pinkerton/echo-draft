import ReasoningService from "../services/ReasoningService";
import { API_ENDPOINTS, buildApiUrl, normalizeBaseUrl } from "../config/constants";
import logger from "../utils/logger";
import { isBuiltInMicrophone } from "../utils/audioDeviceUtils";
import { isSecureEndpoint } from "../utils/urlUtils";
import { withSessionRefresh } from "../lib/neonAuth";
import { getBaseLanguageCode, validateLanguageForModel } from "../utils/languageSupport";

const SHORT_CLIP_DURATION_SECONDS = 2.5;
const REASONING_CACHE_TTL = 30000; // 30 seconds

const PLACEHOLDER_KEYS = {
  openai: "your_openai_api_key_here",
  groq: "your_groq_api_key_here",
  mistral: "your_mistral_api_key_here",
};

const isValidApiKey = (key, provider = "openai") => {
  if (!key || key.trim() === "") return false;
  const placeholder = PLACEHOLDER_KEYS[provider] || PLACEHOLDER_KEYS.openai;
  return key !== placeholder;
};

class AudioManager {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.isProcessing = false;
    this.processingQueue = [];
    this.processingQueueRunner = null;
    this.activeProcessingContext = null;
    this.onStateChange = null;
    this.onError = null;
    this.onTranscriptionComplete = null;
    this.onPartialTranscript = null;
    this.onProgress = null;
    this.cachedApiKey = null;
    this.cachedApiKeyProvider = null;

    this._onApiKeyChanged = () => {
      this.cachedApiKey = null;
      this.cachedApiKeyProvider = null;
    };
    window.addEventListener("api-key-changed", this._onApiKeyChanged);
    this.cachedTranscriptionEndpoint = null;
    this.cachedEndpointProvider = null;
    this.cachedEndpointBaseUrl = null;
    this.recordingStartTime = null;
    this.reasoningAvailabilityCache = { value: false, expiresAt: 0 };
    this.cachedReasoningPreference = null;
    this.isStreaming = false;
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
    this.cachedMicDeviceId = null;
    this.persistentAudioContext = null;
    this.workletModuleLoaded = false;
    this.workletBlobUrl = null;
  }

  getWorkletBlobUrl() {
    if (this.workletBlobUrl) return this.workletBlobUrl;
    const code = `
const BUFFER_SIZE = 800;
class PCMStreamingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Int16Array(BUFFER_SIZE);
    this._offset = 0;
    this._stopped = false;
    this.port.onmessage = (event) => {
      if (event.data === "stop") {
        if (this._offset > 0) {
          const partial = this._buffer.slice(0, this._offset);
          this.port.postMessage(partial.buffer, [partial.buffer]);
          this._buffer = new Int16Array(BUFFER_SIZE);
          this._offset = 0;
        }
        this._stopped = true;
      }
    };
  }
  process(inputs) {
    if (this._stopped) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      this._buffer[this._offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this._offset >= BUFFER_SIZE) {
        this.port.postMessage(this._buffer.buffer, [this._buffer.buffer]);
        this._buffer = new Int16Array(BUFFER_SIZE);
        this._offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-streaming-processor", PCMStreamingProcessor);
`;
    this.workletBlobUrl = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
    return this.workletBlobUrl;
  }

  getCustomDictionaryPrompt() {
    const entries = this.getCustomDictionaryArray();
    if (entries.length === 0) return null;
    return entries.join(", ");
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

  emitProgress(event = {}) {
    const payload = {
      timestamp: Date.now(),
      ...event,
    };

    const stage = typeof payload.stage === "string" ? payload.stage : null;
    if (this.activeProcessingContext && stage && stage !== "listening") {
      if (!payload.context) {
        payload.context = this.activeProcessingContext;
      }
      if (payload.jobId === undefined && this.activeProcessingContext.jobId !== undefined) {
        payload.jobId = this.activeProcessingContext.jobId;
      }
    }

    this.onProgress?.(payload);
  }

  countWords(text) {
    if (!text || typeof text !== "string") return 0;
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  shouldApplyReasoningCleanup() {
    if (typeof window === "undefined" || !window.localStorage) {
      return false;
    }

    const enabled = localStorage.getItem("useReasoningModel");
    if (!enabled || enabled === "false") {
      return false;
    }

    const reasoningModel = localStorage.getItem("reasoningModel") || "";
    return Boolean(reasoningModel.trim());
  }

  async getAudioConstraints() {
    const preferBuiltIn = localStorage.getItem("preferBuiltInMic") !== "false";
    const selectedDeviceId = localStorage.getItem("selectedMicDeviceId") || "";

    // Disable browser audio processing — dictation doesn't need it and it adds ~48ms latency
    const noProcessing = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };

    if (preferBuiltIn) {
      if (this.cachedMicDeviceId) {
        logger.debug(
          "Using cached microphone device ID",
          { deviceId: this.cachedMicDeviceId },
          "audio"
        );
        return { audio: { deviceId: { exact: this.cachedMicDeviceId }, ...noProcessing } };
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter((d) => d.kind === "audioinput");
        const builtInMic = audioInputs.find((d) => isBuiltInMicrophone(d.label));

        if (builtInMic) {
          this.cachedMicDeviceId = builtInMic.deviceId;
          logger.debug(
            "Using built-in microphone (cached for next time)",
            { deviceId: builtInMic.deviceId, label: builtInMic.label },
            "audio"
          );
          return { audio: { deviceId: { exact: builtInMic.deviceId }, ...noProcessing } };
        }
      } catch (error) {
        logger.debug(
          "Failed to enumerate devices for built-in mic detection",
          { error: error.message },
          "audio"
        );
      }
    }

    if (!preferBuiltIn && selectedDeviceId) {
      logger.debug("Using selected microphone", { deviceId: selectedDeviceId }, "audio");
      return { audio: { deviceId: { exact: selectedDeviceId }, ...noProcessing } };
    }

    logger.debug("Using default microphone", {}, "audio");
    return { audio: noProcessing };
  }

  async cacheMicrophoneDeviceId() {
    if (this.cachedMicDeviceId) return; // Already cached

    const preferBuiltIn = localStorage.getItem("preferBuiltInMic") !== "false";
    if (!preferBuiltIn) return; // Only needed for built-in mic detection

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === "audioinput");
      const builtInMic = audioInputs.find((d) => isBuiltInMicrophone(d.label));
      if (builtInMic) {
        this.cachedMicDeviceId = builtInMic.deviceId;
        logger.debug("Microphone device ID pre-cached", { deviceId: builtInMic.deviceId }, "audio");
      }
    } catch (error) {
      logger.debug("Failed to pre-cache microphone device ID", { error: error.message }, "audio");
    }
  }

  async startRecording(context = null) {
    try {
      if (this.isRecording || this.mediaRecorder?.state === "recording") {
        return false;
      }

      const constraints = await this.getAudioConstraints();
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const settings = audioTrack.getSettings();
        logger.info(
          "Recording started with microphone",
          {
            label: audioTrack.label,
            deviceId: settings.deviceId?.slice(0, 20) + "...",
            sampleRate: settings.sampleRate,
            channelCount: settings.channelCount,
          },
          "audio"
        );
      }

      const mediaRecorder = new MediaRecorder(stream);
      const audioChunks = [];
      const recordingStartedAt = Date.now();
      const recordingMimeType = mediaRecorder.mimeType || "audio/webm";
      const recordingContext = context && typeof context === "object" ? context : null;

      this.mediaRecorder = mediaRecorder;
      this.audioChunks = audioChunks;
      this.recordingMimeType = recordingMimeType;
      this.emitProgress({
        stage: "listening",
        stageLabel: "Listening",
        stageProgress: null,
        context: recordingContext,
      });

      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        this.isRecording = false;
        if (this.mediaRecorder === mediaRecorder) {
          this.mediaRecorder = null;
        }

        const audioBlob = new Blob(audioChunks, { type: recordingMimeType });

        logger.info(
          "Recording stopped",
          {
            blobSize: audioBlob.size,
            blobType: audioBlob.type,
            chunksCount: audioChunks.length,
          },
          "audio"
        );

        const durationSeconds = recordingStartedAt
          ? (Date.now() - recordingStartedAt) / 1000
          : null;
        this.enqueueProcessingJob(audioBlob, { durationSeconds }, recordingContext);
        this.onStateChange?.({
          isRecording: false,
          isProcessing: this.isProcessing,
          isStreaming: this.isStreaming,
        });

        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      this.isRecording = true;
      this.onStateChange?.({
        isRecording: true,
        isProcessing: this.isProcessing,
        isStreaming: false,
      });

      return true;
    } catch (error) {
      let errorTitle = "Recording Error";
      let errorDescription = `Failed to access microphone: ${error.message}`;

      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        errorTitle = "Microphone Access Denied";
        errorDescription =
          "Please grant microphone permission in your system settings and try again.";
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        errorTitle = "No Microphone Found";
        errorDescription = "No microphone was detected. Please connect a microphone and try again.";
      } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
        errorTitle = "Microphone In Use";
        errorDescription =
          "The microphone is being used by another application. Please close other apps and try again.";
      }

      this.onError?.({
        title: errorTitle,
        description: errorDescription,
      });
      return false;
    }
  }

  stopRecording() {
    if (this.mediaRecorder?.state === "recording") {
      this.mediaRecorder.stop();
      return true;
    }
    return false;
  }

  cancelRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.mediaRecorder.onstop = () => {
        this.isRecording = false;
        this.audioChunks = [];
        this.onStateChange?.({
          isRecording: false,
          isProcessing: this.isProcessing,
          isStreaming: false,
        });
        this.emitProgress({
          stage: "cancelled",
          stageLabel: "Cancelled",
        });
      };

      this.mediaRecorder.stop();

      if (this.mediaRecorder.stream) {
        this.mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      }

      return true;
    }
    return false;
  }

  cancelProcessing() {
    if (this.isProcessing || this.processingQueue.length > 0) {
      this.isProcessing = false;
      this.processingQueue = [];
      this.activeProcessingContext = null;
      this.onStateChange?.({
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
    this.processingQueue.push({ audioBlob, metadata, context });
    this.startQueuedProcessingIfPossible();
  }

  startQueuedProcessingIfPossible() {
    if (this.processingQueueRunner || this.processingQueue.length === 0) {
      return;
    }

    // Another processing pipeline (e.g., streaming finalize) is active.
    // We'll start as soon as that processing ends.
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    this.onStateChange?.({
      isRecording: this.isRecording,
      isProcessing: true,
      isStreaming: this.isStreaming,
    });

    this.processingQueueRunner = (async () => {
      while (this.isProcessing && this.processingQueue.length > 0) {
        const job = this.processingQueue.shift();
        if (!job) {
          continue;
        }
        this.activeProcessingContext = job.context || null;
        await this.processAudio(job.audioBlob, job.metadata);
        this.activeProcessingContext = null;
      }
    })()
      .catch((error) => {
        logger.error("Processing queue runner failed", { error: error?.message }, "audio");
      })
      .finally(() => {
        this.processingQueueRunner = null;
        this.activeProcessingContext = null;
        if (this.isProcessing) {
          this.isProcessing = false;
        }
        this.onStateChange?.({
          isRecording: this.isRecording,
          isProcessing: this.isProcessing,
          isStreaming: this.isStreaming,
        });
      });
  }

  async processAudio(audioBlob, metadata = {}) {
    const pipelineStart = performance.now();

    try {
      const useLocalWhisper = localStorage.getItem("useLocalWhisper") === "true";
      const localProvider = localStorage.getItem("localTranscriptionProvider") || "whisper";
      const whisperModel = localStorage.getItem("whisperModel") || "base";
      const parakeetModel = localStorage.getItem("parakeetModel") || "parakeet-tdt-0.6b-v3";

      const cloudTranscriptionMode = localStorage.getItem("cloudTranscriptionMode") || "openwhispr";
      const isSignedIn = localStorage.getItem("isSignedIn") === "true";

      const isOpenWhisprCloudMode = !useLocalWhisper && cloudTranscriptionMode === "openwhispr";
      const useCloud = isOpenWhisprCloudMode && isSignedIn;
      logger.debug(
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
          result = await this.processWithLocalParakeet(audioBlob, parakeetModel, metadata);
        } else {
          this.emitProgress({
            stage: "transcribing",
            stageLabel: "Transcribing",
            provider: "local-whisper",
            model: whisperModel,
          });
          activeModel = whisperModel;
          result = await this.processWithLocalWhisper(audioBlob, whisperModel, metadata);
        }
      } else if (useCloud) {
        this.emitProgress({
          stage: "transcribing",
          stageLabel: "Transcribing",
          provider: "openwhispr",
          model: "openwhispr-cloud",
        });
        activeModel = "openwhispr-cloud";
        result = await this.processWithOpenWhisprCloud(audioBlob, metadata);
      } else {
        activeModel = this.getTranscriptionModel();
        this.emitProgress({
          stage: "transcribing",
          stageLabel: "Transcribing",
          provider: localStorage.getItem("cloudTranscriptionProvider") || "openai",
          model: activeModel,
        });
        result = await this.processWithOpenAIAPI(audioBlob, metadata);
      }

      if (!this.isProcessing) {
        return;
      }

      await Promise.resolve(
        this.onTranscriptionComplete?.({
          ...result,
          context: this.activeProcessingContext,
        })
      );

      const roundTripDurationMs = Math.round(performance.now() - pipelineStart);

      const timingData = {
        mode: useLocalWhisper ? `local-${localProvider}` : "cloud",
        model: activeModel,
        audioDurationMs: metadata.durationSeconds
          ? Math.round(metadata.durationSeconds * 1000)
          : null,
        reasoningProcessingDurationMs: result?.timings?.reasoningProcessingDurationMs ?? null,
        roundTripDurationMs,
        audioSizeBytes: audioBlob.size,
        audioFormat: audioBlob.type,
        outputTextLength: result?.text?.length,
      };

      if (useLocalWhisper) {
        timingData.audioConversionDurationMs = result?.timings?.audioConversionDurationMs ?? null;
      }
      timingData.transcriptionProcessingDurationMs =
        result?.timings?.transcriptionProcessingDurationMs ?? null;

      logger.info("Pipeline timing", timingData, "performance");
    } catch (error) {
      const errorAtMs = Math.round(performance.now() - pipelineStart);

      logger.error(
        "Pipeline failed",
        {
          errorAtMs,
          error: error.message,
        },
        "performance"
      );

      if (error.message !== "No audio detected") {
        this.emitProgress({
          stage: "error",
          stageLabel: "Error",
          message: error.message,
        });
        this.onError?.({
          title: "Transcription Error",
          description: `Transcription failed: ${error.message}`,
          code: error.code,
        });
      }
    } finally {
      // Processing state is managed by the queue runner (or streaming pipeline).
    }
  }

  async processWithLocalWhisper(audioBlob, model = "base", metadata = {}) {
    const timings = {};

    try {
      // Send original audio to main process - FFmpeg in main process handles conversion
      // (renderer-side AudioContext conversion was unreliable with WebM/Opus format)
      const arrayBuffer = await audioBlob.arrayBuffer();
      const language = getBaseLanguageCode(localStorage.getItem("preferredLanguage"));
      const options = { model };
      if (language) {
        options.language = language;
      }

      // Add custom dictionary as initial prompt to help Whisper recognize specific words
      const dictionaryPrompt = this.getCustomDictionaryPrompt();
      if (dictionaryPrompt) {
        options.initialPrompt = dictionaryPrompt;
      }

      logger.debug(
        "Local transcription starting",
        {
          audioFormat: audioBlob.type,
          audioSizeBytes: audioBlob.size,
        },
        "performance"
      );

      const transcriptionStart = performance.now();
      const result = await window.electronAPI.transcribeLocalWhisper(arrayBuffer, options);
      timings.transcriptionProcessingDurationMs = Math.round(
        performance.now() - transcriptionStart
      );

      logger.debug(
        "Local transcription complete",
        {
          transcriptionProcessingDurationMs: timings.transcriptionProcessingDurationMs,
          success: result.success,
        },
        "performance"
      );

      if (result.success && result.text) {
        const rawText = result.text;
        let cleanedText = rawText;

        if (this.shouldApplyReasoningCleanup()) {
          this.emitProgress({
            stage: "cleaning",
            stageLabel: "Cleaning up",
          });
          const reasoningStart = performance.now();
          cleanedText = await this.processTranscription(rawText, "local");
          timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);
        }

        return {
          success: true,
          text: cleanedText || rawText,
          rawText,
          source: "local",
          timings,
        };
      } else if (result.success === false && result.message === "No audio detected") {
        throw new Error("No audio detected");
      } else {
        throw new Error(result.message || result.error || "Local Whisper transcription failed");
      }
    } catch (error) {
      if (error.message === "No audio detected") {
        throw error;
      }

      const allowOpenAIFallback = localStorage.getItem("allowOpenAIFallback") === "true";
      const isLocalMode = localStorage.getItem("useLocalWhisper") === "true";

      if (allowOpenAIFallback && isLocalMode) {
        try {
          const fallbackResult = await this.processWithOpenAIAPI(audioBlob, metadata);
          return { ...fallbackResult, source: "openai-fallback" };
        } catch (fallbackError) {
          throw new Error(
            `Local Whisper failed: ${error.message}. OpenAI fallback also failed: ${fallbackError.message}`
          );
        }
      } else {
        throw new Error(`Local Whisper failed: ${error.message}`);
      }
    }
  }

  async processWithLocalParakeet(audioBlob, model = "parakeet-tdt-0.6b-v3", metadata = {}) {
    const timings = {};

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const language = validateLanguageForModel(localStorage.getItem("preferredLanguage"), model);
      const options = { model };
      if (language) {
        options.language = language;
      }

      logger.debug(
        "Parakeet transcription starting",
        {
          audioFormat: audioBlob.type,
          audioSizeBytes: audioBlob.size,
          model,
        },
        "performance"
      );

      const transcriptionStart = performance.now();
      const result = await window.electronAPI.transcribeLocalParakeet(arrayBuffer, options);
      timings.transcriptionProcessingDurationMs = Math.round(
        performance.now() - transcriptionStart
      );

      logger.debug(
        "Parakeet transcription complete",
        {
          transcriptionProcessingDurationMs: timings.transcriptionProcessingDurationMs,
          success: result.success,
        },
        "performance"
      );

      if (result.success && result.text) {
        const rawText = result.text;
        let cleanedText = rawText;

        if (this.shouldApplyReasoningCleanup()) {
          this.emitProgress({
            stage: "cleaning",
            stageLabel: "Cleaning up",
          });
          const reasoningStart = performance.now();
          cleanedText = await this.processTranscription(rawText, "local-parakeet");
          timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);
        }

        return {
          success: true,
          text: cleanedText || rawText,
          rawText,
          source: "local-parakeet",
          timings,
        };
      } else if (result.success === false && result.message === "No audio detected") {
        throw new Error("No audio detected");
      } else {
        throw new Error(result.message || result.error || "Parakeet transcription failed");
      }
    } catch (error) {
      if (error.message === "No audio detected") {
        throw error;
      }

      const allowOpenAIFallback = localStorage.getItem("allowOpenAIFallback") === "true";
      const isLocalMode = localStorage.getItem("useLocalWhisper") === "true";

      if (allowOpenAIFallback && isLocalMode) {
        try {
          const fallbackResult = await this.processWithOpenAIAPI(audioBlob, metadata);
          return { ...fallbackResult, source: "openai-fallback" };
        } catch (fallbackError) {
          throw new Error(
            `Parakeet failed: ${error.message}. OpenAI fallback also failed: ${fallbackError.message}`
          );
        }
      } else {
        throw new Error(`Parakeet failed: ${error.message}`);
      }
    }
  }

  async getAPIKey() {
    // Get the current transcription provider
    const provider =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("cloudTranscriptionProvider") || "openai"
        : "openai";

    // Check cache (invalidate if provider changed)
    if (this.cachedApiKey !== null && this.cachedApiKeyProvider === provider) {
      return this.cachedApiKey;
    }

    let apiKey = null;

    if (provider === "custom") {
      try {
        apiKey = await window.electronAPI.getCustomTranscriptionKey?.();
      } catch (err) {
        logger.debug(
          "Failed to get custom transcription key via IPC, falling back to localStorage",
          { error: err?.message },
          "transcription"
        );
      }
      if (!apiKey || !apiKey.trim()) {
        apiKey = localStorage.getItem("customTranscriptionApiKey") || "";
      }
      apiKey = apiKey?.trim() || "";

      logger.debug(
        "Custom STT API key retrieval",
        {
          provider,
          hasKey: !!apiKey,
          keyLength: apiKey?.length || 0,
          keyPreview: apiKey ? `${apiKey.substring(0, 8)}...` : "(none)",
        },
        "transcription"
      );

      // For custom, we allow null/empty - the endpoint may not require auth
      if (!apiKey) {
        apiKey = null;
      }
    } else if (provider === "mistral") {
      apiKey = await window.electronAPI.getMistralKey?.();
      if (!isValidApiKey(apiKey, "mistral")) {
        apiKey = localStorage.getItem("mistralApiKey");
      }
      if (!isValidApiKey(apiKey, "mistral")) {
        throw new Error("Mistral API key not found. Please set your API key in the Control Panel.");
      }
    } else if (provider === "groq") {
      // Try to get Groq API key
      apiKey = await window.electronAPI.getGroqKey?.();
      if (!isValidApiKey(apiKey, "groq")) {
        apiKey = localStorage.getItem("groqApiKey");
      }
      if (!isValidApiKey(apiKey, "groq")) {
        throw new Error("Groq API key not found. Please set your API key in the Control Panel.");
      }
    } else {
      // Default to OpenAI
      apiKey = await window.electronAPI.getOpenAIKey();
      if (!isValidApiKey(apiKey, "openai")) {
        apiKey = localStorage.getItem("openaiApiKey");
      }
      if (!isValidApiKey(apiKey, "openai")) {
        throw new Error(
          "OpenAI API key not found. Please set your API key in the .env file or Control Panel."
        );
      }
    }

    this.cachedApiKey = apiKey;
    this.cachedApiKeyProvider = provider;
    return apiKey;
  }

  async optimizeAudio(audioBlob) {
    return new Promise((resolve) => {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const arrayBuffer = reader.result;
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

          // Convert to 16kHz mono for smaller size and faster upload
          const sampleRate = 16000;
          const channels = 1;
          const length = Math.floor(audioBuffer.duration * sampleRate);
          const offlineContext = new OfflineAudioContext(channels, length, sampleRate);

          const source = offlineContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(offlineContext.destination);
          source.start();

          const renderedBuffer = await offlineContext.startRendering();
          const wavBlob = this.audioBufferToWav(renderedBuffer);
          resolve(wavBlob);
        } catch (error) {
          // If optimization fails, use original
          resolve(audioBlob);
        }
      };

      reader.onerror = () => resolve(audioBlob);
      reader.readAsArrayBuffer(audioBlob);
    });
  }

  audioBufferToWav(buffer) {
    const length = buffer.length;
    const arrayBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(arrayBuffer);
    const sampleRate = buffer.sampleRate;
    const channelData = buffer.getChannelData(0);

    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, length * 2, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  async processWithReasoningModel(text, model, agentName) {
    logger.logReasoning("CALLING_REASONING_SERVICE", {
      model,
      agentName,
      textLength: text.length,
    });

    const startTime = Date.now();

    try {
      const result = await ReasoningService.processText(text, model, agentName);

      const processingTime = Date.now() - startTime;

      logger.logReasoning("REASONING_SERVICE_COMPLETE", {
        model,
        processingTimeMs: processingTime,
        resultLength: result.length,
        success: true,
      });

      return result;
    } catch (error) {
      const processingTime = Date.now() - startTime;

      logger.logReasoning("REASONING_SERVICE_ERROR", {
        model,
        processingTimeMs: processingTime,
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  }

  async isReasoningAvailable() {
    if (typeof window === "undefined" || !window.localStorage) {
      return false;
    }

    const storedValue = localStorage.getItem("useReasoningModel");
    const now = Date.now();
    const cacheValid =
      this.reasoningAvailabilityCache &&
      now < this.reasoningAvailabilityCache.expiresAt &&
      this.cachedReasoningPreference === storedValue;

    if (cacheValid) {
      return this.reasoningAvailabilityCache.value;
    }

    logger.logReasoning("REASONING_STORAGE_CHECK", {
      storedValue,
      typeOfStoredValue: typeof storedValue,
      isTrue: storedValue === "true",
      isTruthy: !!storedValue && storedValue !== "false",
    });

    const useReasoning = storedValue === "true" || (!!storedValue && storedValue !== "false");

    if (!useReasoning) {
      this.reasoningAvailabilityCache = {
        value: false,
        expiresAt: now + REASONING_CACHE_TTL,
      };
      this.cachedReasoningPreference = storedValue;
      return false;
    }

    try {
      const isAvailable = await ReasoningService.isAvailable();

      logger.logReasoning("REASONING_AVAILABILITY", {
        isAvailable,
        reasoningEnabled: useReasoning,
        finalDecision: useReasoning && isAvailable,
      });

      this.reasoningAvailabilityCache = {
        value: isAvailable,
        expiresAt: now + REASONING_CACHE_TTL,
      };
      this.cachedReasoningPreference = storedValue;

      return isAvailable;
    } catch (error) {
      logger.logReasoning("REASONING_AVAILABILITY_ERROR", {
        error: error.message,
        stack: error.stack,
      });

      this.reasoningAvailabilityCache = {
        value: false,
        expiresAt: now + REASONING_CACHE_TTL,
      };
      this.cachedReasoningPreference = storedValue;
      return false;
    }
  }

  async processTranscription(text, source) {
    const normalizedText = typeof text === "string" ? text.trim() : "";

    logger.logReasoning("TRANSCRIPTION_RECEIVED", {
      source,
      textLength: normalizedText.length,
      textPreview: normalizedText.substring(0, 100) + (normalizedText.length > 100 ? "..." : ""),
      timestamp: new Date().toISOString(),
    });

    const reasoningModel =
      typeof window !== "undefined" && window.localStorage
        ? localStorage.getItem("reasoningModel") || ""
        : "";
    const reasoningProvider =
      typeof window !== "undefined" && window.localStorage
        ? localStorage.getItem("reasoningProvider") || "auto"
        : "auto";
    const agentName =
      typeof window !== "undefined" && window.localStorage
        ? localStorage.getItem("agentName") || null
        : null;
    if (!reasoningModel) {
      logger.logReasoning("REASONING_SKIPPED", {
        reason: "No reasoning model selected",
      });
      return normalizedText;
    }

    const useReasoning = await this.isReasoningAvailable();

    logger.logReasoning("REASONING_CHECK", {
      useReasoning,
      reasoningModel,
      reasoningProvider,
      agentName,
    });

    if (useReasoning) {
      try {
        logger.logReasoning("SENDING_TO_REASONING", {
          preparedTextLength: normalizedText.length,
          model: reasoningModel,
          provider: reasoningProvider,
        });

        const result = await this.processWithReasoningModel(
          normalizedText,
          reasoningModel,
          agentName
        );

        logger.logReasoning("REASONING_SUCCESS", {
          resultLength: result.length,
          resultPreview: result.substring(0, 100) + (result.length > 100 ? "..." : ""),
          processingTime: new Date().toISOString(),
        });

        return result;
      } catch (error) {
        logger.logReasoning("REASONING_FAILED", {
          error: error.message,
          stack: error.stack,
          fallbackToCleanup: true,
        });
        console.error(`Reasoning failed (${source}):`, error.message);
      }
    }

    logger.logReasoning("USING_STANDARD_CLEANUP", {
      reason: useReasoning ? "Reasoning failed" : "Reasoning not enabled",
    });

    return normalizedText;
  }

  shouldStreamTranscription(model, provider) {
    if (provider !== "openai") {
      return false;
    }
    const normalized = typeof model === "string" ? model.trim() : "";
    if (!normalized || normalized === "whisper-1") {
      return false;
    }
    if (normalized === "gpt-4o-transcribe" || normalized === "gpt-4o-transcribe-diarize") {
      return true;
    }
    return normalized.startsWith("gpt-4o-mini-transcribe");
  }

  async readTranscriptionStream(response) {
    const reader = response.body?.getReader();
    if (!reader) {
      logger.error("Streaming response body not available", {}, "transcription");
      throw new Error("Streaming response body not available");
    }

    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let collectedText = "";
    let finalText = null;
    let eventCount = 0;
    const eventTypes = {};

    const handleEvent = (payload) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      eventCount++;
      const eventType = payload.type || "unknown";
      eventTypes[eventType] = (eventTypes[eventType] || 0) + 1;

      logger.debug(
        "Stream event received",
        {
          type: eventType,
          eventNumber: eventCount,
          payloadKeys: Object.keys(payload),
        },
        "transcription"
      );

      if (payload.type === "transcript.text.delta" && typeof payload.delta === "string") {
        collectedText += payload.delta;
        this.emitProgress({
          stage: "transcribing",
          stageLabel: "Transcribing",
          generatedChars: collectedText.length,
          generatedWords: this.countWords(collectedText),
        });
        return;
      }
      if (payload.type === "transcript.text.segment" && typeof payload.text === "string") {
        collectedText += payload.text;
        this.emitProgress({
          stage: "transcribing",
          stageLabel: "Transcribing",
          generatedChars: collectedText.length,
          generatedWords: this.countWords(collectedText),
        });
        return;
      }
      if (payload.type === "transcript.text.done" && typeof payload.text === "string") {
        finalText = payload.text;
        logger.debug(
          "Final transcript received",
          {
            textLength: payload.text.length,
          },
          "transcription"
        );
      }
    };

    logger.debug("Starting to read transcription stream", {}, "transcription");

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        logger.debug(
          "Stream reading complete",
          {
            eventCount,
            eventTypes,
            collectedTextLength: collectedText.length,
            hasFinalText: finalText !== null,
          },
          "transcription"
        );
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Log first chunk to see format
      if (eventCount === 0 && chunk.length > 0) {
        logger.debug(
          "First stream chunk received",
          {
            chunkLength: chunk.length,
            chunkPreview: chunk.substring(0, 500),
          },
          "transcription"
        );
      }

      // Process complete lines from the buffer
      // Each SSE event is "data: <json>\n" followed by empty line
      const lines = buffer.split("\n");
      buffer = "";

      for (const line of lines) {
        const trimmedLine = line.trim();

        // Skip empty lines
        if (!trimmedLine) {
          continue;
        }

        // Extract data from "data: " prefix
        let data = "";
        if (trimmedLine.startsWith("data: ")) {
          data = trimmedLine.slice(6);
        } else if (trimmedLine.startsWith("data:")) {
          data = trimmedLine.slice(5).trim();
        } else {
          // Not a data line, could be leftover - keep in buffer
          buffer += line + "\n";
          continue;
        }

        // Handle [DONE] marker
        if (data === "[DONE]") {
          finalText = finalText ?? collectedText;
          continue;
        }

        // Try to parse JSON
        try {
          const parsed = JSON.parse(data);
          handleEvent(parsed);
        } catch (error) {
          // Incomplete JSON - put back in buffer for next iteration
          buffer += line + "\n";
        }
      }
    }

    const result = finalText ?? collectedText;
    logger.debug(
      "Stream processing complete",
      {
        resultLength: result.length,
        usedFinalText: finalText !== null,
        eventCount,
        eventTypes,
      },
      "transcription"
    );

    return result;
  }

  async processWithOpenWhisprCloud(audioBlob, metadata = {}) {
    if (!navigator.onLine) {
      const err = new Error("You're offline. Cloud transcription requires an internet connection.");
      err.code = "OFFLINE";
      throw err;
    }

    const timings = {};
    const language = getBaseLanguageCode(localStorage.getItem("preferredLanguage"));

    const arrayBuffer = await audioBlob.arrayBuffer();
    const opts = {};
    if (language) opts.language = language;

    const dictionaryEntries = this.getCustomDictionaryArray();
    const dictionaryPrompt = dictionaryEntries.length > 0 ? dictionaryEntries.join(", ") : null;
    if (dictionaryPrompt) opts.prompt = dictionaryPrompt;

    // Use withSessionRefresh to handle AUTH_EXPIRED automatically
    const transcriptionStart = performance.now();
    const result = await withSessionRefresh(async () => {
      const res = await window.electronAPI.cloudTranscribe(arrayBuffer, opts);
      if (!res.success) {
        const err = new Error(res.error || "Cloud transcription failed");
        err.code = res.code;
        throw err;
      }
      return res;
    });
    timings.transcriptionProcessingDurationMs = Math.round(performance.now() - transcriptionStart);

    // Process with reasoning if enabled
    const rawText = result.text;
    let processedText = rawText;

    if (dictionaryPrompt && this.isLikelyDictionaryPromptEcho(rawText, dictionaryEntries)) {
      throw new Error(
        "Transcription returned the dictionary prompt (likely no usable audio). Please try again."
      );
    }

    const useReasoningModel = localStorage.getItem("useReasoningModel") === "true";
    if (useReasoningModel && processedText) {
      this.emitProgress({
        stage: "cleaning",
        stageLabel: "Cleaning up",
        provider: "openwhispr",
      });
      const reasoningStart = performance.now();
      const agentName = localStorage.getItem("agentName") || "";
      const cloudReasoningMode = localStorage.getItem("cloudReasoningMode") || "openwhispr";

      if (cloudReasoningMode === "openwhispr") {
        const reasonResult = await withSessionRefresh(async () => {
          const res = await window.electronAPI.cloudReason(processedText, {
            agentName,
            customDictionary: this.getCustomDictionaryArray(),
            language: localStorage.getItem("preferredLanguage") || "auto",
          });
          if (!res.success) {
            const err = new Error(res.error || "Cloud reasoning failed");
            err.code = res.code;
            throw err;
          }
          return res;
        });

        if (reasonResult.success) {
          processedText = reasonResult.text;
        }
      } else {
        const reasoningModel = localStorage.getItem("reasoningModel") || "";
        if (reasoningModel) {
          const result = await this.processWithReasoningModel(
            processedText,
            reasoningModel,
            agentName
          );
          if (result) {
            processedText = result;
          }
        }
      }
      timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);
    }

    return {
      success: true,
      text: processedText,
      rawText,
      source: "openwhispr",
      timings,
      limitReached: result.limitReached,
      wordsUsed: result.wordsUsed,
      wordsRemaining: result.wordsRemaining,
    };
  }

  getCustomDictionaryArray() {
    try {
      const raw = localStorage.getItem("customDictionary");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  shouldGuardDictionaryPromptEcho(dictionaryEntries) {
    if (!Array.isArray(dictionaryEntries)) return false;
    const uniqueCount = new Set(
      dictionaryEntries
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase())
    ).size;
    // Avoid false positives for tiny dictionaries (someone might actually dictate 2-3 terms)
    return uniqueCount >= 10;
  }

  extractTermsFromCommaOrBullets(text) {
    const raw = typeof text === "string" ? text : "";
    const trimmed = raw.trim();
    if (!trimmed) return [];

    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const bulletLines = lines.filter((line) => /^[-*•]\s+/.test(line));
    if (bulletLines.length >= 3) {
      return bulletLines.map((line) => line.replace(/^[-*•]\s+/, "").trim()).filter(Boolean);
    }

    if (trimmed.includes(",")) {
      return trimmed
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean);
    }

    return lines;
  }

  isLikelyDictionaryPromptEcho(transcribedText, dictionaryEntries) {
    if (!this.shouldGuardDictionaryPromptEcho(dictionaryEntries)) {
      return false;
    }

    const dictionarySet = new Set(
      dictionaryEntries
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase())
    );

    const transcriptTerms = this.extractTermsFromCommaOrBullets(transcribedText);
    const transcriptSet = new Set(
      transcriptTerms
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase())
    );

    if (dictionarySet.size === 0 || transcriptSet.size === 0) {
      return false;
    }

    let intersection = 0;
    for (const term of dictionarySet) {
      if (transcriptSet.has(term)) {
        intersection += 1;
      }
    }

    const coverage = intersection / dictionarySet.size;
    const jaccard = intersection / (dictionarySet.size + transcriptSet.size - intersection);

    return coverage >= 0.95 && jaccard >= 0.9;
  }

  async processWithOpenAIAPI(audioBlob, metadata = {}, options = {}) {
    const skipDictionaryPrompt = options.skipDictionaryPrompt === true;
    const allowPromptEchoRetry = options.allowPromptEchoRetry !== false;

    const timings = {};
    const language = getBaseLanguageCode(localStorage.getItem("preferredLanguage"));
    const allowLocalFallback = localStorage.getItem("allowLocalFallback") === "true";
    const fallbackModel = localStorage.getItem("fallbackWhisperModel") || "base";

    try {
      const durationSeconds = metadata.durationSeconds ?? null;
      const shouldSkipOptimizationForDuration =
        typeof durationSeconds === "number" &&
        durationSeconds > 0 &&
        durationSeconds < SHORT_CLIP_DURATION_SECONDS;

      const model = this.getTranscriptionModel();
      const provider = localStorage.getItem("cloudTranscriptionProvider") || "openai";

      logger.debug(
        "Transcription request starting",
        {
          provider,
          model,
          blobSize: audioBlob.size,
          blobType: audioBlob.type,
          durationSeconds,
          language,
        },
        "transcription"
      );

      // gpt-4o-transcribe models don't support WAV format - they need webm, mp3, mp4, etc.
      // Only use WAV optimization for whisper-1 and groq models
      const is4oModel = model.includes("gpt-4o");
      const shouldOptimize =
        !is4oModel && !shouldSkipOptimizationForDuration && audioBlob.size > 1024 * 1024;

      logger.debug(
        "Audio optimization decision",
        {
          is4oModel,
          shouldOptimize,
          shouldSkipOptimizationForDuration,
        },
        "transcription"
      );

      const [apiKey, optimizedAudio] = await Promise.all([
        this.getAPIKey(),
        shouldOptimize ? this.optimizeAudio(audioBlob) : Promise.resolve(audioBlob),
      ]);

      const formData = new FormData();
      // Determine the correct file extension based on the blob type
      const mimeType = optimizedAudio.type || "audio/webm";
      const extension = mimeType.includes("webm")
        ? "webm"
        : mimeType.includes("ogg")
          ? "ogg"
          : mimeType.includes("mp4")
            ? "mp4"
            : mimeType.includes("mpeg")
              ? "mp3"
              : mimeType.includes("wav")
                ? "wav"
                : "webm";

      logger.debug(
        "FormData preparation",
        {
          mimeType,
          extension,
          optimizedSize: optimizedAudio.size,
          hasApiKey: !!apiKey,
        },
        "transcription"
      );

      formData.append("file", optimizedAudio, `audio.${extension}`);
      formData.append("model", model);

      if (language) {
        formData.append("language", language);
      }

      const dictionaryEntries = skipDictionaryPrompt ? [] : this.getCustomDictionaryArray();
      const dictionaryPrompt = dictionaryEntries.length > 0 ? dictionaryEntries.join(", ") : null;
      const shouldAttachDictionaryPrompt = Boolean(dictionaryPrompt);

      // Add custom dictionary as prompt hint for cloud transcription
      if (shouldAttachDictionaryPrompt) {
        formData.append("prompt", dictionaryPrompt);
      }

      const shouldStream = this.shouldStreamTranscription(model, provider);
      if (shouldStream) {
        formData.append("stream", "true");
      }

      const endpoint = this.getTranscriptionEndpoint();
      const isCustomEndpoint =
        provider === "custom" ||
        (!endpoint.includes("api.openai.com") &&
          !endpoint.includes("api.groq.com") &&
          !endpoint.includes("api.mistral.ai"));

      const apiCallStart = performance.now();

      // Mistral uses x-api-key auth (not Bearer) and doesn't allow browser CORS — proxy through main process
      if (provider === "mistral" && window.electronAPI?.proxyMistralTranscription) {
        const audioBuffer = await optimizedAudio.arrayBuffer();
        const proxyData = { audioBuffer, model, language };

        if (dictionaryPrompt) {
          const tokens = dictionaryPrompt
            .split(",")
            .flatMap((entry) => entry.trim().split(/\s+/))
            .filter(Boolean)
            .slice(0, 100);
          if (tokens.length > 0) {
            proxyData.contextBias = tokens;
          }
        }

        const result = await window.electronAPI.proxyMistralTranscription(proxyData);
        const proxyText = result?.text;

        if (proxyText && proxyText.trim().length > 0) {
          timings.transcriptionProcessingDurationMs = Math.round(performance.now() - apiCallStart);
          const rawText = proxyText;

          if (
            shouldAttachDictionaryPrompt &&
            this.isLikelyDictionaryPromptEcho(rawText, dictionaryEntries)
          ) {
            logger.warn(
              "Transcription appears to have echoed the dictionary prompt (Mistral proxy). Retrying without prompt.",
              { model, provider, rawTextPreview: rawText.slice(0, 120) },
              "transcription"
            );

            if (allowPromptEchoRetry && !skipDictionaryPrompt) {
              return await this.processWithOpenAIAPI(audioBlob, metadata, {
                skipDictionaryPrompt: true,
                allowPromptEchoRetry: false,
              });
            }

            throw new Error(
              "Transcription returned the dictionary prompt (likely no usable audio). Please try again."
            );
          }

          let cleanedText = rawText;
          let source = "mistral";

          if (this.shouldApplyReasoningCleanup()) {
            this.emitProgress({
              stage: "cleaning",
              stageLabel: "Cleaning up",
            });
            const reasoningStart = performance.now();
            cleanedText = await this.processTranscription(rawText, "mistral");
            timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);
            source = "mistral-reasoned";
          }

          return { success: true, text: cleanedText || rawText, rawText, source, timings };
        }

        throw new Error("No text transcribed - Mistral response was empty");
      }

      logger.debug(
        "Making transcription API request",
        {
          endpoint,
          shouldStream,
          model,
          provider,
          isCustomEndpoint,
          hasApiKey: !!apiKey,
          apiKeyPreview: apiKey ? `${apiKey.substring(0, 8)}...` : "(none)",
        },
        "transcription"
      );

      // Build headers - only include Authorization if we have an API key
      const headers = {};
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      logger.debug(
        "STT request details",
        {
          endpoint,
          method: "POST",
          hasAuthHeader: !!apiKey,
          formDataFields: [
            "file",
            "model",
            language && language !== "auto" ? "language" : null,
            shouldStream ? "stream" : null,
          ].filter(Boolean),
        },
        "transcription"
      );

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: formData,
      });

      const responseContentType = response.headers.get("content-type") || "";

      logger.debug(
        "Transcription API response received",
        {
          status: response.status,
          statusText: response.statusText,
          contentType: responseContentType,
          ok: response.ok,
        },
        "transcription"
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          "Transcription API error response",
          {
            status: response.status,
            errorText,
          },
          "transcription"
        );
        throw new Error(`API Error: ${response.status} ${errorText}`);
      }

      let result;
      const contentType = responseContentType;

      if (shouldStream && contentType.includes("text/event-stream")) {
        logger.debug("Processing streaming response", { contentType }, "transcription");
        const streamedText = await this.readTranscriptionStream(response);
        result = { text: streamedText };
        logger.debug(
          "Streaming response parsed",
          {
            hasText: !!streamedText,
            textLength: streamedText?.length,
          },
          "transcription"
        );
      } else {
        const rawText = await response.text();
        logger.debug(
          "Raw API response body",
          {
            rawText: rawText.substring(0, 1000),
            fullLength: rawText.length,
          },
          "transcription"
        );

        try {
          result = JSON.parse(rawText);
        } catch (parseError) {
          logger.error(
            "Failed to parse JSON response",
            {
              parseError: parseError.message,
              rawText: rawText.substring(0, 500),
            },
            "transcription"
          );
          throw new Error(`Failed to parse API response: ${parseError.message}`);
        }

        logger.debug(
          "Parsed transcription result",
          {
            hasText: !!result.text,
            textLength: result.text?.length,
            resultKeys: Object.keys(result),
            fullResult: result,
          },
          "transcription"
        );
      }

      // Check for text - handle both empty string and missing field
      if (result.text && result.text.trim().length > 0) {
        timings.transcriptionProcessingDurationMs = Math.round(performance.now() - apiCallStart);

        const rawText = result.text;

        if (
          shouldAttachDictionaryPrompt &&
          this.isLikelyDictionaryPromptEcho(rawText, dictionaryEntries)
        ) {
          logger.warn(
            "Transcription appears to have echoed the dictionary prompt. Retrying without prompt.",
            { model, provider, rawTextPreview: rawText.slice(0, 120) },
            "transcription"
          );

          if (allowPromptEchoRetry && !skipDictionaryPrompt) {
            return await this.processWithOpenAIAPI(audioBlob, metadata, {
              skipDictionaryPrompt: true,
              allowPromptEchoRetry: false,
            });
          }

          throw new Error(
            "Transcription returned the dictionary prompt (likely no usable audio). Please try again."
          );
        }

        let cleanedText = rawText;
        let source = "openai";

        if (this.shouldApplyReasoningCleanup()) {
          this.emitProgress({
            stage: "cleaning",
            stageLabel: "Cleaning up",
          });
          const reasoningStart = performance.now();
          cleanedText = await this.processTranscription(rawText, "openai");
          timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);
          source = "openai-reasoned";
        }

        logger.debug(
          "Transcription successful",
          {
            originalLength: rawText.length,
            processedLength: cleanedText.length,
            source,
            transcriptionProcessingDurationMs: timings.transcriptionProcessingDurationMs,
            reasoningProcessingDurationMs: timings.reasoningProcessingDurationMs,
          },
          "transcription"
        );
        return { success: true, text: cleanedText || rawText, rawText, source, timings };
      } else {
        // Log at info level so it shows without debug mode
        logger.info(
          "Transcription returned empty - check audio input",
          {
            model,
            provider,
            endpoint,
            blobSize: audioBlob.size,
            blobType: audioBlob.type,
            mimeType,
            extension,
            resultText: result.text,
            resultKeys: Object.keys(result),
          },
          "transcription"
        );
        logger.error(
          "No text in transcription result",
          {
            result,
            resultKeys: Object.keys(result),
          },
          "transcription"
        );
        throw new Error(
          "No text transcribed - audio may be too short, silent, or in an unsupported format"
        );
      }
    } catch (error) {
      const isOpenAIMode = localStorage.getItem("useLocalWhisper") !== "true";

      if (allowLocalFallback && isOpenAIMode) {
        try {
          const arrayBuffer = await audioBlob.arrayBuffer();
          const options = { model: fallbackModel };
          if (language && language !== "auto") {
            options.language = language;
          }

          const result = await window.electronAPI.transcribeLocalWhisper(arrayBuffer, options);

          if (result.success && result.text) {
            const text = await this.processTranscription(result.text, "local-fallback");
            if (text) {
              return { success: true, text, source: "local-fallback" };
            }
          }
          throw error;
        } catch (fallbackError) {
          throw new Error(
            `OpenAI API failed: ${error.message}. Local fallback also failed: ${fallbackError.message}`
          );
        }
      }

      throw error;
    }
  }

  getTranscriptionModel() {
    try {
      const provider =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("cloudTranscriptionProvider") || "openai"
          : "openai";

      const model =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("cloudTranscriptionModel") || ""
          : "";

      const trimmedModel = model.trim();

      // For custom provider, use whatever model is set (or fallback to whisper-1)
      if (provider === "custom") {
        return trimmedModel || "whisper-1";
      }

      // Validate model matches provider to handle settings migration
      if (trimmedModel) {
        const isGroqModel = trimmedModel.startsWith("whisper-large-v3");
        const isOpenAIModel = trimmedModel.startsWith("gpt-4o") || trimmedModel === "whisper-1";
        const isMistralModel = trimmedModel.startsWith("voxtral-");

        if (provider === "groq" && isGroqModel) {
          return trimmedModel;
        }
        if (provider === "openai" && isOpenAIModel) {
          return trimmedModel;
        }
        if (provider === "mistral" && isMistralModel) {
          return trimmedModel;
        }
        // Model doesn't match provider - fall through to default
      }

      // Return provider-appropriate default
      if (provider === "groq") return "whisper-large-v3-turbo";
      if (provider === "mistral") return "voxtral-mini-latest";
      return "gpt-4o-mini-transcribe";
    } catch (error) {
      return "gpt-4o-mini-transcribe";
    }
  }

  getTranscriptionEndpoint() {
    // Get current provider and base URL to check if cache is valid
    const currentProvider =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("cloudTranscriptionProvider") || "openai"
        : "openai";
    const currentBaseUrl =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("cloudTranscriptionBaseUrl") || ""
        : "";

    // Only use custom URL when provider is explicitly "custom"
    const isCustomEndpoint = currentProvider === "custom";

    // Invalidate cache if provider or base URL changed
    if (
      this.cachedTranscriptionEndpoint &&
      (this.cachedEndpointProvider !== currentProvider ||
        this.cachedEndpointBaseUrl !== currentBaseUrl)
    ) {
      logger.debug(
        "STT endpoint cache invalidated",
        {
          previousProvider: this.cachedEndpointProvider,
          newProvider: currentProvider,
          previousBaseUrl: this.cachedEndpointBaseUrl,
          newBaseUrl: currentBaseUrl,
        },
        "transcription"
      );
      this.cachedTranscriptionEndpoint = null;
    }

    if (this.cachedTranscriptionEndpoint) {
      return this.cachedTranscriptionEndpoint;
    }

    try {
      // Use custom URL only when provider is "custom", otherwise use provider-specific defaults
      let base;
      if (isCustomEndpoint) {
        base = currentBaseUrl.trim() || API_ENDPOINTS.TRANSCRIPTION_BASE;
      } else if (currentProvider === "groq") {
        base = API_ENDPOINTS.GROQ_BASE;
      } else if (currentProvider === "mistral") {
        base = API_ENDPOINTS.MISTRAL_BASE;
      } else {
        // OpenAI or other standard providers
        base = API_ENDPOINTS.TRANSCRIPTION_BASE;
      }

      const normalizedBase = normalizeBaseUrl(base);

      logger.debug(
        "STT endpoint resolution",
        {
          provider: currentProvider,
          isCustomEndpoint,
          rawBaseUrl: currentBaseUrl,
          normalizedBase,
          defaultBase: API_ENDPOINTS.TRANSCRIPTION_BASE,
        },
        "transcription"
      );

      const cacheResult = (endpoint) => {
        this.cachedTranscriptionEndpoint = endpoint;
        this.cachedEndpointProvider = currentProvider;
        this.cachedEndpointBaseUrl = currentBaseUrl;

        logger.debug(
          "STT endpoint resolved",
          {
            endpoint,
            provider: currentProvider,
            isCustomEndpoint,
            usingDefault: endpoint === API_ENDPOINTS.TRANSCRIPTION,
          },
          "transcription"
        );

        return endpoint;
      };

      if (!normalizedBase) {
        logger.debug(
          "STT endpoint: using default (normalization failed)",
          { rawBase: base },
          "transcription"
        );
        return cacheResult(API_ENDPOINTS.TRANSCRIPTION);
      }

      // Only validate HTTPS for custom endpoints (known providers are already HTTPS)
      if (isCustomEndpoint && !isSecureEndpoint(normalizedBase)) {
        logger.warn(
          "STT endpoint: HTTPS required, falling back to default",
          { attemptedUrl: normalizedBase },
          "transcription"
        );
        return cacheResult(API_ENDPOINTS.TRANSCRIPTION);
      }

      let endpoint;
      if (/\/audio\/(transcriptions|translations)$/i.test(normalizedBase)) {
        endpoint = normalizedBase;
        logger.debug("STT endpoint: using full path from config", { endpoint }, "transcription");
      } else {
        endpoint = buildApiUrl(normalizedBase, "/audio/transcriptions");
        logger.debug(
          "STT endpoint: appending /audio/transcriptions to base",
          { base: normalizedBase, endpoint },
          "transcription"
        );
      }

      return cacheResult(endpoint);
    } catch (error) {
      logger.error(
        "STT endpoint resolution failed",
        { error: error.message, stack: error.stack },
        "transcription"
      );
      this.cachedTranscriptionEndpoint = API_ENDPOINTS.TRANSCRIPTION;
      this.cachedEndpointProvider = currentProvider;
      this.cachedEndpointBaseUrl = currentBaseUrl;
      return API_ENDPOINTS.TRANSCRIPTION;
    }
  }

  async safePaste(text, options = {}) {
    try {
      await window.electronAPI.pasteText(text, options);
      return true;
    } catch (error) {
      const message =
        error?.message ??
        (typeof error?.toString === "function" ? error.toString() : String(error));
      this.onError?.({
        title: "Paste Error",
        description: `Failed to insert text automatically. ${message}`,
      });
      return false;
    }
  }

  async saveTranscription(payload) {
    try {
      return await window.electronAPI.saveTranscription(payload);
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
    }
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
    if (!this.shouldUseStreaming()) {
      logger.debug("Streaming warmup skipped - not in streaming mode", {}, "streaming");
      return false;
    }

    try {
      const [, wsResult] = await Promise.all([
        this.cacheMicrophoneDeviceId(),
        withSessionRefresh(async () => {
          const res = await window.electronAPI.assemblyAiStreamingWarmup({
            sampleRate: 16000,
            language: getBaseLanguageCode(localStorage.getItem("preferredLanguage")),
          });
          // Throw error to trigger retry if AUTH_EXPIRED
          if (!res.success && res.code) {
            const err = new Error(res.error || "Warmup failed");
            err.code = res.code;
            throw err;
          }
          return res;
        }),
      ]);

      if (wsResult.success) {
        // Pre-load AudioWorklet module so first recording is faster
        try {
          const audioContext = await this.getOrCreateAudioContext();
          if (!this.workletModuleLoaded) {
            await audioContext.audioWorklet.addModule(this.getWorkletBlobUrl());
            this.workletModuleLoaded = true;
            logger.debug("AudioWorklet module pre-loaded during warmup", {}, "streaming");
          }
        } catch (e) {
          logger.debug(
            "AudioWorklet pre-load failed (will retry on recording)",
            { error: e.message },
            "streaming"
          );
        }

        // Warm up the OS audio driver by briefly acquiring the mic, then releasing.
        // This forces macOS to initialize the audio subsystem so subsequent
        // getUserMedia calls resolve in ~100-200ms instead of ~500-1000ms.
        if (!this.micDriverWarmedUp) {
          try {
            const constraints = await this.getAudioConstraints();
            const tempStream = await navigator.mediaDevices.getUserMedia(constraints);
            tempStream.getTracks().forEach((track) => track.stop());
            this.micDriverWarmedUp = true;
            logger.debug("Microphone driver pre-warmed", {}, "streaming");
          } catch (e) {
            logger.debug(
              "Mic driver warmup failed (non-critical)",
              { error: e.message },
              "streaming"
            );
          }
        }

        logger.info(
          "AssemblyAI streaming connection warmed up",
          { alreadyWarm: wsResult.alreadyWarm, micCached: !!this.cachedMicDeviceId },
          "streaming"
        );
        return true;
      } else if (wsResult.code === "NO_API") {
        logger.debug("Streaming warmup skipped - API not configured", {}, "streaming");
        return false;
      } else {
        logger.warn("AssemblyAI warmup failed", { error: wsResult.error }, "streaming");
        return false;
      }
    } catch (error) {
      logger.error("AssemblyAI warmup error", { error: error.message }, "streaming");
      return false;
    }
  }

  async getOrCreateAudioContext() {
    if (this.persistentAudioContext && this.persistentAudioContext.state !== "closed") {
      if (this.persistentAudioContext.state === "suspended") {
        await this.persistentAudioContext.resume();
      }
      return this.persistentAudioContext;
    }
    this.persistentAudioContext = new AudioContext({ sampleRate: 16000 });
    this.workletModuleLoaded = false;
    return this.persistentAudioContext;
  }

  async startStreamingRecording(context = null) {
    try {
      if (this.isRecording || this.isStreaming || this.isProcessing) {
        return false;
      }

      const recordingContext = context && typeof context === "object" ? context : null;

      const t0 = performance.now();
      const constraints = await this.getAudioConstraints();
      const tConstraints = performance.now();

      // Run getUserMedia and WebSocket connect in parallel.
      // With warmup, WS resolves in ~5ms; getUserMedia (~500ms) dominates.
      const [stream, result] = await Promise.all([
        navigator.mediaDevices.getUserMedia(constraints),
        withSessionRefresh(async () => {
          const res = await window.electronAPI.assemblyAiStreamingStart({
            sampleRate: 16000,
            language: getBaseLanguageCode(localStorage.getItem("preferredLanguage")),
          });

          if (!res.success) {
            if (res.code === "NO_API") {
              return { needsFallback: true };
            }
            const err = new Error(res.error || "Failed to start streaming session");
            err.code = res.code;
            throw err;
          }
          return res;
        }),
      ]);
      const tParallel = performance.now();

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const settings = audioTrack.getSettings();
        logger.info(
          "Streaming recording started with microphone",
          {
            label: audioTrack.label,
            deviceId: settings.deviceId?.slice(0, 20) + "...",
            sampleRate: settings.sampleRate,
            usedCachedId: !!this.cachedMicDeviceId,
          },
          "audio"
        );
      }

      if (result.needsFallback) {
        stream.getTracks().forEach((track) => track.stop());
        logger.debug(
          "Streaming API not configured, falling back to regular recording",
          {},
          "streaming"
        );
        return this.startRecording(recordingContext);
      }

      const audioContext = await this.getOrCreateAudioContext();
      this.streamingAudioContext = audioContext;
      this.streamingSource = audioContext.createMediaStreamSource(stream);
      this.streamingStream = stream;

      if (!this.workletModuleLoaded) {
        await audioContext.audioWorklet.addModule(this.getWorkletBlobUrl());
        this.workletModuleLoaded = true;
      }

      this.streamingProcessor = new AudioWorkletNode(audioContext, "pcm-streaming-processor");

      this.streamingProcessor.port.onmessage = (event) => {
        if (!this.isStreaming) return;
        window.electronAPI.assemblyAiStreamingSend(event.data);
      };

      this.streamingSource.connect(this.streamingProcessor);

      const tReady = performance.now();
      logger.info(
        "Streaming start timing",
        {
          constraintsMs: Math.round(tConstraints - t0),
          getUserMediaAndWsMs: Math.round(tParallel - tConstraints),
          pipelineMs: Math.round(tReady - tParallel),
          totalMs: Math.round(tReady - t0),
          usedWarmConnection: result.usedWarmConnection,
          micDriverWarmedUp: !!this.micDriverWarmedUp,
        },
        "streaming"
      );

      // Show recording indicator only AFTER mic is live and audio pipeline is connected.
      // This ensures no words are lost — the user sees "recording" exactly when audio flows.
      this.isStreaming = true;
      this.isRecording = true;
      this.streamingContext = recordingContext;
      this.recordingStartTime = Date.now();
      this.onStateChange?.({ isRecording: true, isProcessing: false, isStreaming: true });
      this.emitProgress({
        stage: "listening",
        stageLabel: "Listening",
        stageProgress: null,
        context: recordingContext,
      });

      this.streamingFinalText = "";
      this.streamingPartialText = "";
      this.streamingTextResolve = null;
      this.streamingTextDebounce = null;

      const partialCleanup = window.electronAPI.onAssemblyAiPartialTranscript((text) => {
        this.streamingPartialText = text;
        this.onPartialTranscript?.(text);
        this.emitProgress({
          generatedChars: text.length,
          generatedWords: this.countWords(text),
        });
      });

      const finalCleanup = window.electronAPI.onAssemblyAiFinalTranscript((text) => {
        this.streamingFinalText = text;
        this.streamingPartialText = "";
        this.onPartialTranscript?.(text);
        this.emitProgress({
          generatedChars: text.length,
          generatedWords: this.countWords(text),
        });
      });

      const errorCleanup = window.electronAPI.onAssemblyAiError((error) => {
        logger.error("AssemblyAI streaming error", { error }, "streaming");
        this.onError?.({
          title: "Streaming Error",
          description: error,
        });
        if (this.isStreaming) {
          logger.warn("Connection lost during streaming, auto-stopping", {}, "streaming");
          this.stopStreamingRecording().catch((e) => {
            logger.error(
              "Auto-stop after connection loss failed",
              { error: e.message },
              "streaming"
            );
          });
        }
      });

      const sessionEndCleanup = window.electronAPI.onAssemblyAiSessionEnd((data) => {
        logger.debug("AssemblyAI session ended", data, "streaming");
        if (data.text) {
          this.streamingFinalText = data.text;
        }
      });

      this.streamingCleanupFns = [partialCleanup, finalCleanup, errorCleanup, sessionEndCleanup];

      return true;
    } catch (error) {
      logger.error("Failed to start streaming recording", { error: error.message }, "streaming");

      this.streamingContext = null;
      let errorTitle = "Streaming Error";
      let errorDescription = `Failed to start streaming: ${error.message}`;

      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        errorTitle = "Microphone Access Denied";
        errorDescription =
          "Please grant microphone permission in your system settings and try again.";
      } else if (error.code === "AUTH_EXPIRED" || error.code === "AUTH_REQUIRED") {
        errorTitle = "Sign-in Required";
        errorDescription =
          "Your OpenWhispr Cloud session is unavailable. Please sign in again from Settings.";
      }

      this.onError?.({
        title: errorTitle,
        description: errorDescription,
      });

      await this.cleanupStreaming();
      return false;
    }
  }

  async stopStreamingRecording() {
    if (!this.isStreaming) return false;

    const durationSeconds = this.recordingStartTime
      ? (Date.now() - this.recordingStartTime) / 1000
      : null;

    const t0 = performance.now();
    let finalText = this.streamingFinalText || "";

    // 1. Update UI immediately
    this.isRecording = false;
    this.isProcessing = true;
    this.recordingStartTime = null;
    this.onStateChange?.({ isRecording: false, isProcessing: true, isStreaming: false });
    this.emitProgress({
      stage: "transcribing",
      stageLabel: "Transcribing",
      message: "Finalizing stream",
      context: this.streamingContext,
    });

    // 2. Stop the processor — it flushes its remaining buffer on "stop".
    //    Keep isStreaming TRUE so the port.onmessage handler forwards the flush to WebSocket.
    if (this.streamingProcessor) {
      try {
        this.streamingProcessor.port.postMessage("stop");
        this.streamingProcessor.disconnect();
      } catch (e) {
        // Ignore
      }
      this.streamingProcessor = null;
    }
    if (this.streamingSource) {
      try {
        this.streamingSource.disconnect();
      } catch (e) {
        // Ignore
      }
      this.streamingSource = null;
    }
    this.streamingAudioContext = null;
    if (this.streamingStream) {
      this.streamingStream.getTracks().forEach((track) => track.stop());
      this.streamingStream = null;
    }
    const tAudioCleanup = performance.now();

    // 3. Wait for flushed buffer to travel: port → main thread → IPC → WebSocket → server.
    //    Then mark streaming done so no further audio is forwarded.
    await new Promise((resolve) => setTimeout(resolve, 120));
    this.isStreaming = false;

    // 4. ForceEndpoint finalizes any in-progress turn, then Terminate closes the session.
    //    The server MUST process ALL remaining audio and send ALL Turn messages before
    //    responding with Termination — so awaiting this guarantees we get every word.
    window.electronAPI.assemblyAiStreamingForceEndpoint?.();
    const tForceEndpoint = performance.now();

    const stopResult = await window.electronAPI.assemblyAiStreamingStop().catch((e) => {
      logger.debug("Streaming disconnect error", { error: e.message }, "streaming");
      return { success: false };
    });
    const tTerminate = performance.now();

    finalText = this.streamingFinalText || "";

    if (!finalText && this.streamingPartialText) {
      finalText = this.streamingPartialText;
      logger.debug("Using partial text as fallback", { textLength: finalText.length }, "streaming");
    }

    if (!finalText && stopResult?.text) {
      finalText = stopResult.text;
      logger.debug(
        "Using disconnect result text as fallback",
        { textLength: finalText.length },
        "streaming"
      );
    }

    this.cleanupStreamingListeners();

    logger.info(
      "Streaming stop timing",
      {
        durationSeconds,
        audioCleanupMs: Math.round(tAudioCleanup - t0),
        flushWaitMs: Math.round(tForceEndpoint - tAudioCleanup),
        terminateRoundTripMs: Math.round(tTerminate - tForceEndpoint),
        totalStopMs: Math.round(tTerminate - t0),
        textLength: finalText.length,
      },
      "streaming"
    );

    const useReasoningModel = localStorage.getItem("useReasoningModel") === "true";
    if (useReasoningModel && finalText) {
      this.emitProgress({
        stage: "cleaning",
        stageLabel: "Cleaning up",
        provider: "openwhispr",
        context: this.streamingContext,
      });
      const reasoningStart = performance.now();
      const agentName = localStorage.getItem("agentName") || "";
      const cloudReasoningMode = localStorage.getItem("cloudReasoningMode") || "openwhispr";

      try {
        if (cloudReasoningMode === "openwhispr") {
          const reasonResult = await withSessionRefresh(async () => {
            const res = await window.electronAPI.cloudReason(finalText, {
              agentName,
              customDictionary: this.getCustomDictionaryArray(),
              language: localStorage.getItem("preferredLanguage") || "auto",
            });
            if (!res.success) {
              const err = new Error(res.error || "Cloud reasoning failed");
              err.code = res.code;
              throw err;
            }
            return res;
          });

          if (reasonResult.success && reasonResult.text) {
            finalText = reasonResult.text;
          }

          logger.info(
            "Streaming reasoning complete",
            {
              reasoningDurationMs: Math.round(performance.now() - reasoningStart),
              model: reasonResult.model,
            },
            "streaming"
          );
        } else {
          const reasoningModel = localStorage.getItem("reasoningModel") || "";
          if (reasoningModel) {
            const result = await this.processWithReasoningModel(
              finalText,
              reasoningModel,
              agentName
            );
            if (result) {
              finalText = result;
            }
            logger.info(
              "Streaming BYOK reasoning complete",
              { reasoningDurationMs: Math.round(performance.now() - reasoningStart) },
              "streaming"
            );
          }
        }
      } catch (reasonError) {
        logger.error(
          "Streaming reasoning failed, using raw text",
          { error: reasonError.message },
          "streaming"
        );
      }
    }

    if (finalText) {
      const tBeforePaste = performance.now();
      await Promise.resolve(
        this.onTranscriptionComplete?.({
          success: true,
          text: finalText,
          source: "assemblyai-streaming",
          context: this.streamingContext,
        })
      );

      logger.info(
        "Streaming total processing",
        {
          totalProcessingMs: Math.round(tBeforePaste - t0),
          hasReasoning: useReasoningModel,
        },
        "streaming"
      );
    }

    this.isProcessing = false;
    this.streamingContext = null;
    if (this.processingQueue.length > 0) {
      this.startQueuedProcessingIfPossible();
    } else {
      this.onStateChange?.({
        isRecording: this.isRecording,
        isProcessing: false,
        isStreaming: this.isStreaming,
      });
    }

    if (this.shouldUseStreaming()) {
      this.warmupStreamingConnection().catch((e) => {
        logger.debug("Background re-warm failed", { error: e.message }, "streaming");
      });
    }

    return true;
  }

  cleanupStreamingAudio() {
    if (this.streamingProcessor) {
      try {
        this.streamingProcessor.port.postMessage("stop");
        this.streamingProcessor.disconnect();
      } catch (e) {
        // Ignore
      }
      this.streamingProcessor = null;
    }

    if (this.streamingSource) {
      try {
        this.streamingSource.disconnect();
      } catch (e) {
        // Ignore
      }
      this.streamingSource = null;
    }

    this.streamingAudioContext = null;

    if (this.streamingStream) {
      this.streamingStream.getTracks().forEach((track) => track.stop());
      this.streamingStream = null;
    }

    this.isStreaming = false;
  }

  cleanupStreamingListeners() {
    for (const cleanup of this.streamingCleanupFns) {
      try {
        cleanup?.();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    this.streamingCleanupFns = [];
    this.streamingFinalText = "";
    this.streamingPartialText = "";
    this.streamingTextResolve = null;
    clearTimeout(this.streamingTextDebounce);
    this.streamingTextDebounce = null;
  }

  async cleanupStreaming() {
    this.cleanupStreamingAudio();
    this.cleanupStreamingListeners();
  }

  cleanup() {
    if (this.isStreaming) {
      this.cleanupStreaming();
    }
    if (this.mediaRecorder?.state === "recording") {
      this.stopRecording();
    }
    if (this.persistentAudioContext && this.persistentAudioContext.state !== "closed") {
      this.persistentAudioContext.close().catch(() => {});
      this.persistentAudioContext = null;
      this.workletModuleLoaded = false;
      if (this.workletBlobUrl) {
        URL.revokeObjectURL(this.workletBlobUrl);
        this.workletBlobUrl = null;
      }
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
