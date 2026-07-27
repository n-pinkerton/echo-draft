const writeAscii = (view, offset, value) => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

export const createPcmWavBlob = (chunks = [], sampleRate = 48_000) => {
  const validChunks = chunks.filter(
    (chunk) => chunk instanceof ArrayBuffer && chunk.byteLength > 0
  );
  const dataLength = validChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  if (!dataLength) return null;

  const normalizedRate = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.round(sampleRate) : 48_000;
  const wav = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wav);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, normalizedRate, true);
  view.setUint32(28, normalizedRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (const chunk of validChunks) {
    new Uint8Array(wav, offset, chunk.byteLength).set(new Uint8Array(chunk));
    offset += chunk.byteLength;
  }

  return new Blob([wav], { type: "audio/wav" });
};
