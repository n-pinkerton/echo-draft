function normalizeWhitespace(text) {
  return text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

function isBlankAudioMarker(text) {
  const normalized = text.trim().toLowerCase();
  return normalized === "[blank_audio]" || normalized === "[ blank_audio ]";
}

function parseWhisperResult(output) {
  let result;
  if (typeof output === "string") {
    try {
      result = JSON.parse(output);
    } catch (parseError) {
      const text = normalizeWhitespace(output);
      if (text && !isBlankAudioMarker(text)) {
        return { success: true, text };
      }
      throw new Error(`Failed to parse Whisper output: ${parseError.message}`);
    }
  } else if (typeof output === "object" && output !== null) {
    result = output;
  } else {
    throw new Error(`Unexpected Whisper output type: ${typeof output}`);
  }

  if (result.transcription && Array.isArray(result.transcription)) {
    const text = normalizeWhitespace(result.transcription.map((seg) => seg.text).join(""));
    if (!text || isBlankAudioMarker(text)) {
      return { success: false, message: "No audio detected" };
    }
    return { success: true, text };
  }

  if (result.text !== undefined) {
    const text = typeof result.text === "string" ? normalizeWhitespace(result.text) : "";
    if (!text || isBlankAudioMarker(text)) {
      return { success: false, message: "No audio detected" };
    }
    return { success: true, text };
  }

  return { success: false, message: "No audio detected" };
}

module.exports = {
  isBlankAudioMarker,
  normalizeWhitespace,
  parseWhisperResult,
};

