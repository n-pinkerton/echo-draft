import logger from "../../../utils/logger";

const readBlobAsArrayBuffer = async (blob) => {
  if (typeof blob?.arrayBuffer === "function") return await blob.arrayBuffer();
  if (typeof FileReader === "undefined") throw new Error("Audio capture cannot read the recording");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Audio capture cannot read the recording"));
    reader.readAsArrayBuffer(blob);
  });
};

export async function saveAudioCapture(audioBlob, payload = {}) {
  const electronAPI = typeof window !== "undefined" ? window.electronAPI : null;
  if (!electronAPI?.debugSaveAudio) {
    throw new Error("Audio capture is unavailable");
  }

  try {
    const audioBuffer = await readBlobAsArrayBuffer(audioBlob);
    const result = await electronAPI.debugSaveAudio({
      audioBuffer,
      mimeType: audioBlob?.type || payload?.mimeType,
      ...payload,
    });

    if (!result?.success) {
      throw new Error(result?.error || result?.reason || "Audio capture could not be saved");
    }

    logger.debug(
      "Audio capture saved",
      {
        bytes: result.bytes,
        kept: result.kept,
        deleted: result.deleted,
        bytesKept: result.bytesKept,
      },
      "audio"
    );
    return result;
  } catch (error) {
    logger.debug("Audio capture failed", { error: error?.message || String(error) }, "audio");
    throw error;
  }
}
