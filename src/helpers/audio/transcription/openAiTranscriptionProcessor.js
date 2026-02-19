import { getBaseLanguageCode } from "../../../utils/languageSupport";
import { getCustomDictionaryArray } from "./customDictionary";
import { isLikelyDictionaryPromptEcho } from "./dictionaryPromptEcho";

const SHORT_CLIP_DURATION_SECONDS = 2.5;

export async function processWithOpenAIAPI(transcriber, audioBlob, metadata = {}, options = {}) {
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

    const model = transcriber.getTranscriptionModel();
    const provider = localStorage.getItem("cloudTranscriptionProvider") || "openai";

    transcriber.logger?.debug?.(
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

    const is4oModel = model.includes("gpt-4o");
    const shouldOptimize =
      !is4oModel &&
      !shouldSkipOptimizationForDuration &&
      audioBlob.size > 1024 * 1024;

    transcriber.logger?.debug?.(
      "Audio optimization decision",
      { is4oModel, shouldOptimize, shouldSkipOptimizationForDuration },
      "transcription"
    );

    const [apiKey, optimizedAudio] = await Promise.all([
      transcriber.getAPIKey(),
      shouldOptimize ? transcriber.optimizeAudio(audioBlob) : Promise.resolve(audioBlob),
    ]);

    const formData = new FormData();
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

    transcriber.logger?.debug?.(
      "FormData preparation",
      { mimeType, extension, optimizedSize: optimizedAudio.size, hasApiKey: !!apiKey },
      "transcription"
    );

    formData.append("file", optimizedAudio, `audio.${extension}`);
    formData.append("model", model);
    if (language) {
      formData.append("language", language);
    }

    const dictionaryEntries = skipDictionaryPrompt ? [] : getCustomDictionaryArray();
    const dictionaryPrompt = dictionaryEntries.length > 0 ? dictionaryEntries.join(", ") : null;
    const shouldAttachDictionaryPrompt = Boolean(dictionaryPrompt);

    if (shouldAttachDictionaryPrompt) {
      formData.append("prompt", dictionaryPrompt);
    }

    const shouldStream = transcriber.shouldStreamTranscription(model, provider);
    if (shouldStream) {
      formData.append("stream", "true");
    }

    const endpoint = transcriber.getTranscriptionEndpoint();

    const apiCallStart = performance.now();

    if (provider === "mistral" && window.electronAPI?.proxyMistralTranscription) {
      const audioBuffer = await optimizedAudio.arrayBuffer();
      const proxyData = { audioBuffer, model, language };

      if (dictionaryPrompt) {
        const tokens = dictionaryPrompt
          .split(",")
          .flatMap((entry) => entry.trim().split(/\\s+/))
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
          isLikelyDictionaryPromptEcho(rawText, dictionaryEntries)
        ) {
          transcriber.logger?.warn?.(
            "Transcription appears to have echoed the dictionary prompt (Mistral proxy). Retrying without prompt.",
            { model, provider, rawTextPreview: rawText.slice(0, 120) },
            "transcription"
          );

          if (allowPromptEchoRetry && !skipDictionaryPrompt) {
            return await processWithOpenAIAPI(transcriber, audioBlob, metadata, {
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

        if (transcriber.shouldApplyReasoningCleanup?.()) {
          transcriber.emitProgress?.({ stage: "cleaning", stageLabel: "Cleaning up" });
          const reasoningStart = performance.now();
          cleanedText = await transcriber.reasoningCleanupService.processTranscription(
            rawText,
            "mistral",
            transcriber.getCleanupEnabledOverride?.() ?? null
          );
          timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);
          source = "mistral-reasoned";
        }

        return { success: true, text: cleanedText || rawText, rawText, source, timings };
      }

      throw new Error("No text transcribed - Mistral response was empty");
    }

    transcriber.logger?.debug?.(
      "Making transcription API request",
      {
        endpoint,
        shouldStream,
        model,
        provider,
        hasApiKey: !!apiKey,
        apiKeyPreview: apiKey ? `${apiKey.substring(0, 8)}...` : "(none)",
      },
      "transcription"
    );

    const headers = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(endpoint, { method: "POST", headers, body: formData });
    const responseContentType = response.headers.get("content-type") || "";

    transcriber.logger?.debug?.(
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
      transcriber.logger?.error?.(
        "Transcription API error response",
        { status: response.status, errorText },
        "transcription"
      );
      throw new Error(`API Error: ${response.status} ${errorText}`);
    }

    let result;
    const contentType = responseContentType;

    if (shouldStream && contentType.includes("text/event-stream")) {
      transcriber.logger?.debug?.("Processing streaming response", { contentType }, "transcription");
      const streamedText = await transcriber.readTranscriptionStream(response);
      result = { text: streamedText };
    } else {
      const rawText = await response.text();
      try {
        result = JSON.parse(rawText);
      } catch (parseError) {
        transcriber.logger?.error?.(
          "Failed to parse JSON response",
          {
            parseError: parseError.message,
            rawText: rawText.substring(0, 500),
          },
          "transcription"
        );
        throw new Error(`Failed to parse API response: ${parseError.message}`);
      }
    }

    if (result.text && result.text.trim().length > 0) {
      timings.transcriptionProcessingDurationMs = Math.round(performance.now() - apiCallStart);

      const rawText = result.text;

      if (
        shouldAttachDictionaryPrompt &&
        isLikelyDictionaryPromptEcho(rawText, dictionaryEntries)
      ) {
        transcriber.logger?.warn?.(
          "Transcription appears to have echoed the dictionary prompt. Retrying without prompt.",
          { model, provider, rawTextPreview: rawText.slice(0, 120) },
          "transcription"
        );

        if (allowPromptEchoRetry && !skipDictionaryPrompt) {
          return await processWithOpenAIAPI(transcriber, audioBlob, metadata, {
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

      if (transcriber.shouldApplyReasoningCleanup?.()) {
        transcriber.emitProgress?.({ stage: "cleaning", stageLabel: "Cleaning up" });
        const reasoningStart = performance.now();
        cleanedText = await transcriber.reasoningCleanupService.processTranscription(
          rawText,
          "openai",
          transcriber.getCleanupEnabledOverride?.() ?? null
        );
        timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);
        source = "openai-reasoned";
      }

      return { success: true, text: cleanedText || rawText, rawText, source, timings };
    }

    throw new Error(
      "No text transcribed - audio may be too short, silent, or in an unsupported format"
    );
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
          const text = await transcriber.reasoningCleanupService.processTranscription(
            result.text,
            "local-fallback",
            transcriber.getCleanupEnabledOverride?.() ?? null
          );
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

