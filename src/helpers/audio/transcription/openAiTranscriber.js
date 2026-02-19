import { API_ENDPOINTS, buildApiUrl, normalizeBaseUrl } from "../../../config/constants";
import { isSecureEndpoint } from "../../../utils/urlUtils";
import { readOpenAiTranscriptionStream } from "./openAiSseStream";
import { processWithOpenAIAPI as processWithOpenAIAPIRequest } from "./openAiTranscriptionProcessor";

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

/**
 * OpenAI/Groq/Mistral/custom HTTP transcription client used by AudioManager.
 *
 * Responsibilities:
 * - resolve model + endpoint from localStorage (with caching)
 * - fetch API keys (with caching) from IPC/localStorage
 * - handle OpenAI transcription streaming (`text/event-stream`)
 * - dictionary prompt echo heuristic retry
 * - optional local fallback when BYOK HTTP fails
 */
export class OpenAiTranscriber {
  /**
   * @param {{
   *   logger: any,
   *   emitProgress?: (payload: any) => void,
   *   shouldApplyReasoningCleanup?: () => boolean,
   *   getCleanupEnabledOverride?: () => boolean | null,
   *   reasoningCleanupService?: { processTranscription: Function },
   * }} deps
   */
  constructor(deps = {}) {
    this.logger = deps.logger;
    this.emitProgress = deps.emitProgress;
    this.shouldApplyReasoningCleanup = deps.shouldApplyReasoningCleanup;
    this.getCleanupEnabledOverride = deps.getCleanupEnabledOverride;
    this.reasoningCleanupService = deps.reasoningCleanupService;

    this.cachedApiKey = null;
    this.cachedApiKeyProvider = null;
    this.cachedTranscriptionEndpoint = null;
    this.cachedEndpointProvider = null;
    this.cachedEndpointBaseUrl = null;
  }

  resetApiKeyCache() {
    this.cachedApiKey = null;
    this.cachedApiKeyProvider = null;
  }

  resetEndpointCache() {
    this.cachedTranscriptionEndpoint = null;
    this.cachedEndpointProvider = null;
    this.cachedEndpointBaseUrl = null;
  }

  async getAPIKey() {
    const provider =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("cloudTranscriptionProvider") || "openai"
        : "openai";

    if (this.cachedApiKey !== null && this.cachedApiKeyProvider === provider) {
      return this.cachedApiKey;
    }

    let apiKey = null;

    if (provider === "custom") {
      try {
        apiKey = await window.electronAPI.getCustomTranscriptionKey?.();
      } catch (err) {
        this.logger?.debug?.(
          "Failed to get custom transcription key via IPC, falling back to localStorage",
          { error: err?.message },
          "transcription"
        );
      }
      if (!apiKey || !apiKey.trim()) {
        apiKey = localStorage.getItem("customTranscriptionApiKey") || "";
      }
      apiKey = apiKey?.trim() || "";

      this.logger?.debug?.(
        "Custom STT API key retrieval",
        {
          provider,
          hasKey: !!apiKey,
          keyLength: apiKey?.length || 0,
          keyPreview: apiKey ? `${apiKey.substring(0, 8)}...` : "(none)",
        },
        "transcription"
      );

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
      apiKey = await window.electronAPI.getGroqKey?.();
      if (!isValidApiKey(apiKey, "groq")) {
        apiKey = localStorage.getItem("groqApiKey");
      }
      if (!isValidApiKey(apiKey, "groq")) {
        throw new Error("Groq API key not found. Please set your API key in the Control Panel.");
      }
    } else {
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
        } catch {
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

  getTranscriptionModel() {
    try {
      const provider =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("cloudTranscriptionProvider") || "openai"
          : "openai";

      const model =
        typeof localStorage !== "undefined" ? localStorage.getItem("cloudTranscriptionModel") || "" : "";

      const trimmedModel = model.trim();

      if (provider === "custom") {
        return trimmedModel || "whisper-1";
      }

      if (trimmedModel) {
        const isGroqModel = trimmedModel.startsWith("whisper-large-v3");
        const isOpenAIModel = trimmedModel.startsWith("gpt-4o") || trimmedModel === "whisper-1";
        const isMistralModel = trimmedModel.startsWith("voxtral-");

        if (provider === "groq" && isGroqModel) return trimmedModel;
        if (provider === "openai" && isOpenAIModel) return trimmedModel;
        if (provider === "mistral" && isMistralModel) return trimmedModel;
      }

      if (provider === "groq") return "whisper-large-v3-turbo";
      if (provider === "mistral") return "voxtral-mini-latest";
      return "gpt-4o-mini-transcribe";
    } catch {
      return "gpt-4o-mini-transcribe";
    }
  }

  getTranscriptionEndpoint() {
    const currentProvider =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("cloudTranscriptionProvider") || "openai"
        : "openai";
    const currentBaseUrl =
      typeof localStorage !== "undefined" ? localStorage.getItem("cloudTranscriptionBaseUrl") || "" : "";

    const isCustomEndpoint = currentProvider === "custom";

    if (
      this.cachedTranscriptionEndpoint &&
      (this.cachedEndpointProvider !== currentProvider || this.cachedEndpointBaseUrl !== currentBaseUrl)
    ) {
      this.logger?.debug?.(
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
      let base;
      if (isCustomEndpoint) {
        base = currentBaseUrl.trim() || API_ENDPOINTS.TRANSCRIPTION_BASE;
      } else if (currentProvider === "groq") {
        base = API_ENDPOINTS.GROQ_BASE;
      } else if (currentProvider === "mistral") {
        base = API_ENDPOINTS.MISTRAL_BASE;
      } else {
        base = API_ENDPOINTS.TRANSCRIPTION_BASE;
      }

      const normalizedBase = normalizeBaseUrl(base);

      this.logger?.debug?.(
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

        this.logger?.debug?.(
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
        this.logger?.debug?.(
          "STT endpoint: using default (normalization failed)",
          { rawBase: base },
          "transcription"
        );
        return cacheResult(API_ENDPOINTS.TRANSCRIPTION);
      }

      if (isCustomEndpoint && !isSecureEndpoint(normalizedBase)) {
        this.logger?.warn?.(
          "STT endpoint: HTTPS required, falling back to default",
          { attemptedUrl: normalizedBase },
          "transcription"
        );
        return cacheResult(API_ENDPOINTS.TRANSCRIPTION);
      }

      let endpoint;
      if (normalizedBase.includes("/audio/transcriptions")) {
        endpoint = normalizedBase;
      } else {
        endpoint = buildApiUrl(normalizedBase, "/audio/transcriptions");
        this.logger?.debug?.(
          "STT endpoint: appending /audio/transcriptions to base",
          { base: normalizedBase, endpoint },
          "transcription"
        );
      }

      return cacheResult(endpoint);
    } catch (error) {
      this.logger?.error?.(
        "STT endpoint resolution failed",
        { error: error?.message || String(error), stack: error?.stack },
        "transcription"
      );
      this.cachedTranscriptionEndpoint = API_ENDPOINTS.TRANSCRIPTION;
      this.cachedEndpointProvider = currentProvider;
      this.cachedEndpointBaseUrl = currentBaseUrl;
      return API_ENDPOINTS.TRANSCRIPTION;
    }
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
    const trace = typeof window !== "undefined" && window.__openwhisprLogLevel === "trace";

    return readOpenAiTranscriptionStream(response, {
      logger: this.logger,
      trace,
      emitProgress: ({ generatedChars, generatedWords }) => {
        this.emitProgress?.({
          stage: "transcribing",
          stageLabel: "Transcribing",
          generatedChars,
          generatedWords,
        });
      },
    });
  }

  async processWithOpenAIAPI(audioBlob, metadata = {}, options = {}) {
    return await processWithOpenAIAPIRequest(this, audioBlob, metadata, options);
  }
}
