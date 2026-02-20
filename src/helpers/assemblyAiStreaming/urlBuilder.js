const { SAMPLE_RATE } = require("./constants");

function buildAssemblyAiWebSocketUrl(options = {}) {
  const sampleRate = options.sampleRate || SAMPLE_RATE;
  const params = new URLSearchParams({
    sample_rate: String(sampleRate),
    encoding: "pcm_s16le",
    format_turns: "true",
    token: options.token,
  });

  if (options.language && options.language !== "auto") {
    params.set("speech_model", "universal-streaming-multilingual");
  }

  return `wss://streaming.assemblyai.com/v3/ws?${params.toString()}`;
}

module.exports = { buildAssemblyAiWebSocketUrl };

