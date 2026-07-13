import { countWords } from "../utils/wordCount";

/**
 * Read an OpenAI transcription stream response (`text/event-stream`) and return the full transcript.
 *
 * EchoDraft uses `stream=true` for certain OpenAI models (notably `gpt-4o-transcribe*`) to:
 * - show progress in the UI
 * - reduce perceived latency
 *
 * Contract:
 * - Accumulates `transcript.text.delta` (and `transcript.text.segment`) events into a single string
 * - Uses `transcript.text.done` when it is >= the delta-collected length
 * - If `done` is shorter than collected deltas, returns the collected deltas (defensive)
 *
 * @param {Response} response
 * @param {{
 *   logger: { debug: Function, warn: Function, trace?: Function, error?: Function },
 *   emitProgress?: (payload: { generatedChars: number, generatedWords: number }) => void,
 *   trace?: boolean
 * }} options
 * @returns {Promise<string>}
 */
export async function readOpenAiTranscriptionStream(response, options = {}) {
  const { logger, emitProgress, trace = false } = options;

  const reader = response.body?.getReader?.();
  if (!reader) {
    logger?.error?.("Streaming response body not available", {}, "transcription");
    throw new Error("Streaming response body not available");
  }

  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let collectedText = "";
  let finalText = null;
  let completionMarkerReceived = false;
  let eventCount = 0;
  const eventTypes = {};

  const handleEvent = (payload) => {
    if (!payload || typeof payload !== "object") {
      return;
    }

    eventCount += 1;
    const type = payload.type || "unknown";
    eventTypes[type] = (eventTypes[type] || 0) + 1;

    if (type === "transcript.text.delta" && typeof payload.delta === "string") {
      if (trace) {
        logger?.trace?.(
          "OpenAI stream delta",
          { deltaLength: payload.delta.length, eventNumber: eventCount },
          "transcription"
        );
      }
      collectedText += payload.delta;
      emitProgress?.({
        generatedChars: collectedText.length,
        generatedWords: countWords(collectedText),
      });
      return;
    }

    if (type === "transcript.text.segment" && typeof payload.text === "string") {
      if (trace) {
        logger?.trace?.(
          "OpenAI stream segment",
          { textLength: payload.text.length, eventNumber: eventCount },
          "transcription"
        );
      }
      collectedText += payload.text;
      emitProgress?.({
        generatedChars: collectedText.length,
        generatedWords: countWords(collectedText),
      });
      return;
    }

    if (type === "transcript.text.done" && typeof payload.text === "string") {
      finalText = payload.text;
      completionMarkerReceived = true;
      logger?.debug?.(
        "Final transcript received",
        {
          textLength: payload.text.length,
          collectedTextLength: collectedText.length,
        },
        "transcription"
      );
      if (trace) {
        logger?.trace?.(
          "OpenAI stream done",
          { textLength: payload.text.length, eventNumber: eventCount },
          "transcription"
        );
      }
    }
  };

  const handleSseLine = (line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      return true;
    }

    let data = "";
    if (trimmedLine.startsWith("data: ")) {
      data = trimmedLine.slice(6);
    } else if (trimmedLine.startsWith("data:")) {
      data = trimmedLine.slice(5).trim();
    } else {
      return true;
    }

    if (data === "[DONE]") {
      completionMarkerReceived = true;
      if (trace) {
        logger?.trace?.(
          "OpenAI stream done marker received",
          { eventNumber: eventCount, collectedTextLength: collectedText.length },
          "transcription"
        );
      }
      finalText = finalText ?? collectedText;
      return true;
    }

    try {
      handleEvent(JSON.parse(data));
      return true;
    } catch (error) {
      if (trace) {
        logger?.trace?.(
          "OpenAI stream JSON parse deferred",
          {
            error: error?.message || String(error),
            dataLength: data.length,
          },
          "transcription"
        );
      }
      return false;
    }
  };

  logger?.debug?.("Starting to read transcription stream", {}, "transcription");

  while (true) {
    let readResult;
    try {
      readResult = await reader.read();
    } catch (cause) {
      const error = new Error("Transcription stream ended before completion.", { cause });
      error.code = "TRANSCRIPTION_STREAM_INCOMPLETE";
      throw error;
    }
    const { value, done } = readResult;
    if (done) {
      logger?.debug?.(
        "Stream reading complete",
        {
          eventCount,
          eventTypes,
          collectedTextLength: collectedText.length,
          hasFinalText: finalText !== null,
          finalTextLength: finalText ? finalText.length : 0,
        },
        "transcription"
      );
      break;
    }

    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;

    if (eventCount === 0 && chunk.length > 0) {
      logger?.debug?.(
        "First stream chunk received",
        {
          chunkLength: chunk.length,
        },
        "transcription"
      );
    }

    // Process complete lines from the buffer. Keep any trailing partial line in `buffer`.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!handleSseLine(line)) {
        buffer = line + "\n" + buffer;
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    handleSseLine(buffer);
  }

  if (!completionMarkerReceived) {
    logger?.warn?.(
      "OpenAI transcription stream closed without a completion marker",
      { collectedTextLength: collectedText.length, eventCount, eventTypes },
      "transcription"
    );
    const error = new Error("Transcription stream ended before completion.");
    error.code = "TRANSCRIPTION_STREAM_INCOMPLETE";
    throw error;
  }

  const collectedTextLength = collectedText.length;
  const finalTextLength = finalText ? finalText.length : 0;
  const shouldUseFinalText = Boolean(finalText) && finalTextLength >= collectedTextLength;
  const result = shouldUseFinalText ? finalText : collectedText;
  const lengthMismatch = Boolean(finalText) && finalTextLength !== collectedTextLength;

  if (
    !shouldUseFinalText &&
    finalText &&
    finalTextLength > 0 &&
    finalTextLength < collectedTextLength
  ) {
    logger?.warn?.(
      "OpenAI stream final text shorter than collected deltas; using collected text",
      {
        collectedTextLength,
        finalTextLength,
        eventCount,
        eventTypes,
      },
      "transcription"
    );
  }

  logger?.debug?.(
    "Stream processing complete",
    {
      resultLength: result.length,
      collectedTextLength,
      finalTextLength,
      usedFinalText: shouldUseFinalText,
      lengthMismatch,
      eventCount,
      eventTypes,
    },
    "transcription"
  );

  if (trace) {
    logger?.trace?.(
      "OpenAI stream result",
      {
        resultLength: result.length,
        collectedTextLength,
        finalTextLength,
        usedFinalText: shouldUseFinalText,
        lengthMismatch,
        eventCount,
        eventTypes,
      },
      "transcription"
    );
  }

  return result;
}
