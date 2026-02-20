const buildWhisperMultipartBody = ({
  audioBuffer,
  language,
  initialPrompt,
  responseFormat = "json",
  fileName = "audio.wav",
  contentType = "audio/wav",
  boundary = `----WhisperBoundary${Date.now()}`,
} = {}) => {
  const parts = [];

  parts.push(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
  );
  parts.push(audioBuffer);
  parts.push("\r\n");

  if (language && language !== "auto") {
    parts.push(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="language"\r\n\r\n` +
        `${language}\r\n`
    );
  }

  if (initialPrompt) {
    parts.push(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="prompt"\r\n\r\n` +
        `${initialPrompt}\r\n`
    );
  }

  parts.push(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
      `${responseFormat}\r\n`
  );
  parts.push(`--${boundary}--\r\n`);

  const bodyParts = parts.map((part) => (typeof part === "string" ? Buffer.from(part) : part));
  return { boundary, body: Buffer.concat(bodyParts) };
};

module.exports = { buildWhisperMultipartBody };

