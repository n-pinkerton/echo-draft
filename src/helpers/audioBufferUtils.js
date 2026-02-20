const coerceAudioBlobToBuffer = (audioBlob) => {
  let audioBuffer;

  if (Buffer.isBuffer(audioBlob)) {
    audioBuffer = audioBlob;
  } else if (ArrayBuffer.isView(audioBlob)) {
    audioBuffer = Buffer.from(audioBlob.buffer, audioBlob.byteOffset, audioBlob.byteLength);
  } else if (audioBlob instanceof ArrayBuffer) {
    audioBuffer = Buffer.from(audioBlob);
  } else if (typeof audioBlob === "string") {
    audioBuffer = Buffer.from(audioBlob, "base64");
  } else if (audioBlob && audioBlob.buffer && typeof audioBlob.byteLength === "number") {
    audioBuffer = Buffer.from(audioBlob.buffer, audioBlob.byteOffset || 0, audioBlob.byteLength);
  } else {
    throw new Error(`Unsupported audio data type: ${typeof audioBlob}`);
  }

  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error("Audio buffer is empty - no audio data received");
  }

  return audioBuffer;
};

module.exports = { coerceAudioBlobToBuffer };

