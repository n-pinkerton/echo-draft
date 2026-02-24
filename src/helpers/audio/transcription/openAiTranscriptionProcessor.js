import { getBaseLanguageCode } from "../../../utils/languageSupport";
import { getCustomDictionaryArray } from "./customDictionary";
import { isLikelyDictionaryPromptEcho } from "./dictionaryPromptEcho";
import { countWords } from "../utils/wordCount";

const SHORT_CLIP_DURATION_SECONDS = 2.5;
const TRUNCATION_RETRY_MIN_DURATION_SECONDS = 12;
const TRUNCATION_RETRY_MAX_WORDS_PER_SECOND = 0.6;

export async function processWithOpenAIAPI(transcriber, audioBlob, metadata = {}, options = {}) {
  const skipDictionaryPrompt = options.skipDictionaryPrompt === true;
  const allowPromptEchoRetry = options.allowPromptEchoRetry !== false;
  const forceNoStream = options.forceNoStream === true;
  const allowTruncationRetry = options.allowTruncationRetry !== false;

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

    const transcribeOnce = async ({
      attemptLabel,
      attemptSkipDictionaryPrompt,
      attemptForceNoStream,
    }) => {
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

      const dictionaryEntries = attemptSkipDictionaryPrompt ? [] : getCustomDictionaryArray();
      const dictionaryPrompt = dictionaryEntries.length > 0 ? dictionaryEntries.join(", ") : null;
      const shouldAttachDictionaryPrompt = Boolean(dictionaryPrompt);

      const shouldStream =
        !attemptForceNoStream && transcriber.shouldStreamTranscription(model, provider);

      transcriber.logger?.debug?.(
        "FormData preparation",
        {
          attempt: attemptLabel,
          mimeType,
          extension,
          optimizedSize: optimizedAudio.size,
          hasApiKey: !!apiKey,
          shouldStream,
          forceNoStream: attemptForceNoStream,
          dictionaryEntriesCount: dictionaryEntries.length,
          dictionaryPromptLength: dictionaryPrompt ? dictionaryPrompt.length : 0,
        },
        "transcription"
      );

      formData.append("file", optimizedAudio, `audio.${extension}`);
      formData.append("model", model);
      if (language) {
        formData.append("language", language);
      }

      if (shouldAttachDictionaryPrompt) {
        formData.append("prompt", dictionaryPrompt);
      }

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

        if (!proxyText || proxyText.trim().length === 0) {
          throw new Error("No text transcribed - Mistral response was empty");
        }

        const attemptDurationMs = Math.round(performance.now() - apiCallStart);
        return {
          rawText: proxyText,
          source: "mistral",
          timings: { transcriptionProcessingDurationMs: attemptDurationMs },
          dictionaryEntries,
          shouldAttachDictionaryPrompt,
        };
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
      const requestId =
        response.headers.get("x-request-id") ||
        response.headers.get("openai-request-id") ||
        null;

      transcriber.logger?.debug?.(
        "Transcription API response received",
        {
          status: response.status,
          statusText: response.statusText,
          contentType: responseContentType,
          requestId,
          ok: response.ok,
        },
        "transcription"
      );

      if (!response.ok) {
        const errorText = await response.text();
        transcriber.logger?.error?.(
          "Transcription API error response",
          { status: response.status, requestId, errorText },
          "transcription"
        );
        throw new Error(`API Error: ${response.status} ${errorText}`);
      }

      let result;
      const contentType = responseContentType;

      if (contentType.includes("text/event-stream")) {
        transcriber.logger?.debug?.(
          "Processing streaming response",
          { contentType, requestId },
          "transcription"
        );
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
              requestId,
              parseError: parseError.message,
              rawText: rawText.substring(0, 500),
            },
            "transcription"
          );
          throw new Error(`Failed to parse API response: ${parseError.message}`);
        }
      }

      const attemptDurationMs = Math.round(performance.now() - apiCallStart);

      if (result.text && result.text.trim().length > 0) {
        return {
          rawText: result.text,
          source: "openai",
          timings: { transcriptionProcessingDurationMs: attemptDurationMs },
          dictionaryEntries,
          shouldAttachDictionaryPrompt,
        };
      }

      throw new Error(
        "No text transcribed - audio may be too short, silent, or in an unsupported format"
      );
    };

    const combineTranscriptionTimings = (attempts) => {
      const total = attempts.reduce(
        (sum, attempt) => sum + (attempt?.timings?.transcriptionProcessingDurationMs || 0),
        0
      );
      return {
        transcriptionProcessingDurationMs: total,
        transcriptionAttemptCount: attempts.length,
        ...(attempts.length > 1 ? { transcriptionRetried: true } : {}),
      };
    };

    const transcribeWithDictionaryRetry = async ({
      attemptLabel,
      attemptSkipDictionaryPrompt,
      attemptForceNoStream,
    }) => {
      const firstAttempt = await transcribeOnce({
        attemptLabel,
        attemptSkipDictionaryPrompt,
        attemptForceNoStream,
      });

      const rawText = firstAttempt.rawText;
      if (
        firstAttempt.shouldAttachDictionaryPrompt &&
        isLikelyDictionaryPromptEcho(rawText, firstAttempt.dictionaryEntries)
      ) {
        transcriber.logger?.warn?.(
          "Transcription appears to have echoed the dictionary prompt. Retrying without prompt.",
          { model, provider, rawTextPreview: rawText.slice(0, 120) },
          "transcription"
        );

        if (allowPromptEchoRetry && !attemptSkipDictionaryPrompt) {
          const retryAttempt = await transcribeOnce({
            attemptLabel: `${attemptLabel}-noprompt`,
            attemptSkipDictionaryPrompt: true,
            attemptForceNoStream,
          });
          return { attempts: [firstAttempt, retryAttempt], result: retryAttempt, skipDictionaryPrompt: true };
        }

        throw new Error(
          "Transcription returned the dictionary prompt (likely no usable audio). Please try again."
        );
      }

      return { attempts: [firstAttempt], result: firstAttempt, skipDictionaryPrompt: attemptSkipDictionaryPrompt };
    };

    const attempts = [];
    const primary = await transcribeWithDictionaryRetry({
      attemptLabel: "primary",
      attemptSkipDictionaryPrompt: skipDictionaryPrompt,
      attemptForceNoStream: forceNoStream,
    });
    attempts.push(...primary.attempts);

    let activeResult = primary.result;
    let effectiveSkipDictionaryPrompt = primary.skipDictionaryPrompt;

    const rawText = typeof activeResult.rawText === "string" ? activeResult.rawText : "";

    const words = countWords(rawText);
    const wordsPerSecond =
      typeof durationSeconds === "number" && durationSeconds > 0 ? words / durationSeconds : null;

    const looksTruncated =
      allowTruncationRetry &&
      !forceNoStream &&
      typeof durationSeconds === "number" &&
      durationSeconds >= TRUNCATION_RETRY_MIN_DURATION_SECONDS &&
      wordsPerSecond !== null &&
      words > 0 &&
      wordsPerSecond < TRUNCATION_RETRY_MAX_WORDS_PER_SECOND;

    if (looksTruncated) {
      transcriber.logger?.warn?.(
        "Transcription looks suspiciously short for the recording duration; retrying",
        {
          model,
          provider,
          durationSeconds,
          words,
          wordsPerSecond: Number(wordsPerSecond.toFixed(3)),
          rawLength: rawText.length,
        },
        "transcription"
      );

      try {
        const retry = await transcribeWithDictionaryRetry({
          attemptLabel: "retry-truncation",
          attemptSkipDictionaryPrompt: effectiveSkipDictionaryPrompt,
          attemptForceNoStream: true,
        });
        attempts.push(...retry.attempts);

        const retryText = typeof retry.result.rawText === "string" ? retry.result.rawText : "";
        if (retryText.trim().length > rawText.trim().length) {
          transcriber.logger?.warn?.(
            "Using retry transcription result because it is longer",
            { primaryLength: rawText.trim().length, retryLength: retryText.trim().length },
            "transcription"
          );
          activeResult = retry.result;
        } else {
          transcriber.logger?.warn?.(
            "Keeping primary transcription result (retry was not longer)",
            { primaryLength: rawText.trim().length, retryLength: retryText.trim().length },
            "transcription"
          );
        }
      } catch (retryError) {
        transcriber.logger?.warn?.(
          "Truncation retry failed; continuing with primary transcription",
          { error: retryError?.message || String(retryError) },
          "transcription"
        );
      }
    }

    const finalRawText = typeof activeResult.rawText === "string" ? activeResult.rawText : "";
    const combinedTimings = combineTranscriptionTimings(attempts);
    timings.transcriptionProcessingDurationMs = combinedTimings.transcriptionProcessingDurationMs;
    timings.transcriptionAttemptCount = combinedTimings.transcriptionAttemptCount;
    if (combinedTimings.transcriptionRetried) {
      timings.transcriptionRetried = true;
    }

    let cleanedText = finalRawText;
    let source = activeResult.source || "openai";

    if (transcriber.shouldApplyReasoningCleanup?.()) {
      transcriber.emitProgress?.({ stage: "cleaning", stageLabel: "Cleaning up" });
      const reasoningStart = performance.now();
      cleanedText = await transcriber.reasoningCleanupService.processTranscription(
        finalRawText,
        source,
        transcriber.getCleanupEnabledOverride?.() ?? null
      );
      timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);
      source = `${source}-reasoned`;
    }

    return { success: true, text: cleanedText || finalRawText, rawText: finalRawText, source, timings };
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
