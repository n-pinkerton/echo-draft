const redactEnvSnapshot = (env) => {
  const snapshot = {};
  const redact = (value) => {
    if (!value) return "";
    return "[REDACTED]";
  };

  const safeString = (value) => (value == null ? "" : String(value));

  // Non-secret settings that help debugging.
  snapshot.ACTIVATION_MODE = safeString(env.ACTIVATION_MODE);
  snapshot.DICTATION_KEY = safeString(env.DICTATION_KEY);
  snapshot.DICTATION_KEY_CLIPBOARD = safeString(env.DICTATION_KEY_CLIPBOARD);
  snapshot.LOCAL_TRANSCRIPTION_PROVIDER = safeString(env.LOCAL_TRANSCRIPTION_PROVIDER);
  snapshot.PARAKEET_MODEL = safeString(env.PARAKEET_MODEL);
  snapshot.LOCAL_WHISPER_MODEL = safeString(env.LOCAL_WHISPER_MODEL);
  snapshot.REASONING_PROVIDER = safeString(env.REASONING_PROVIDER);
  snapshot.LOCAL_REASONING_MODEL = safeString(env.LOCAL_REASONING_MODEL);

  // Secret presence flags (never include actual values).
  snapshot.OPENAI_API_KEY = env.OPENAI_API_KEY ? redact(env.OPENAI_API_KEY) : "";
  snapshot.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY ? redact(env.ANTHROPIC_API_KEY) : "";
  snapshot.GEMINI_API_KEY = env.GEMINI_API_KEY ? redact(env.GEMINI_API_KEY) : "";
  snapshot.GROQ_API_KEY = env.GROQ_API_KEY ? redact(env.GROQ_API_KEY) : "";
  snapshot.MISTRAL_API_KEY = env.MISTRAL_API_KEY ? redact(env.MISTRAL_API_KEY) : "";
  snapshot.CUSTOM_TRANSCRIPTION_API_KEY = env.CUSTOM_TRANSCRIPTION_API_KEY
    ? redact(env.CUSTOM_TRANSCRIPTION_API_KEY)
    : "";
  snapshot.CUSTOM_REASONING_API_KEY = env.CUSTOM_REASONING_API_KEY
    ? redact(env.CUSTOM_REASONING_API_KEY)
    : "";

  return snapshot;
};

module.exports = { redactEnvSnapshot };

