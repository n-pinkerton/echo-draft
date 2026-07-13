import logger from "../../../utils/logger";

export async function safePaste(_manager, text, options = {}) {
  try {
    await window.electronAPI.pasteText(text, options);
    return true;
  } catch (error) {
    // Delivery orchestration owns the user-visible fallback, toast, stage, and single error cue.
    logger.warn(
      "Automatic insertion failed; delivery fallback will handle the result",
      { error: error?.message || String(error) },
      "paste"
    );
    return false;
  }
}

export async function saveTranscription(payload) {
  try {
    return await window.electronAPI.saveTranscription(payload);
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
}
