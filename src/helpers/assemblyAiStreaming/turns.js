function normalizeTurnText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function applyEndOfTurnTranscript(turns, transcript, turnIsFormatted) {
  const trimmedTranscript = String(transcript || "").trim();
  const normalizedTranscript = normalizeTurnText(trimmedTranscript);

  if (!trimmedTranscript || !normalizedTranscript) {
    return {
      action: "ignored-empty",
      accumulatedText: turns.map((turn) => turn.text).join(" "),
      lastTurnText: turns.length ? turns[turns.length - 1].text : "",
    };
  }

  const previousTurn = turns.length ? turns[turns.length - 1] : null;
  if (previousTurn && previousTurn.normalized === normalizedTranscript) {
    if (turnIsFormatted && previousTurn.text !== trimmedTranscript) {
      previousTurn.text = trimmedTranscript;
      return {
        action: "replaced-previous",
        accumulatedText: turns.map((turn) => turn.text).join(" "),
        lastTurnText: trimmedTranscript,
      };
    }

    return {
      action: "ignored-duplicate",
      accumulatedText: turns.map((turn) => turn.text).join(" "),
      lastTurnText: previousTurn.text,
    };
  }

  turns.push({ text: trimmedTranscript, normalized: normalizedTranscript });
  return {
    action: "added",
    accumulatedText: turns.map((turn) => turn.text).join(" "),
    lastTurnText: trimmedTranscript,
  };
}

module.exports = { applyEndOfTurnTranscript, normalizeTurnText };

