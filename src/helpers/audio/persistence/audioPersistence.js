import logger from "../../../utils/logger";

export async function safePasteWithResult(_manager, text, options = {}) {
  try {
    const result = await window.electronAPI.pasteText(text, options);
    if (result?.success === false) {
      const code = normalizePasteFailureCode(result.errorCode);
      logger.warn(
        "Automatic insertion failed; delivery fallback will handle the result",
        { errorCode: code },
        "paste"
      );
      return {
        success: false,
        errorCode: code,
        clipboardWriteCommitted: result?.clipboardWriteCommitted === true,
        clipboardRetained: result?.clipboardRetained === true,
        ...(result?.insertionMayHaveOccurred === true ? { insertionMayHaveOccurred: true } : {}),
      };
    }
    return {
      success: true,
      errorCode: null,
      inserted: result?.inserted === true,
      clipboardRestored: result?.clipboardRestored !== false,
      warningCode:
        result?.clipboardRestored === false ? normalizePasteFailureCode(result?.warningCode) : null,
    };
  } catch (error) {
    const errorCode = normalizePasteFailureCode(error?.code);
    // Delivery orchestration owns the user-visible fallback, toast, stage, and single error cue.
    logger.warn(
      "Automatic insertion failed; delivery fallback will handle the result",
      {
        error: error?.message || String(error),
        errorCode,
      },
      "paste"
    );
    return { success: false, errorCode };
  }
}

export async function safePaste(manager, text, options = {}) {
  const result = await safePasteWithResult(manager, text, options);
  return result.success;
}

function normalizePasteFailureCode(code) {
  const normalized = typeof code === "string" ? code.trim() : "";
  return /^[A-Z][A-Z0-9_]{0,95}$/.test(normalized) ? normalized : "AUTOMATIC_INSERTION_FAILED";
}

export async function saveTranscription(payload) {
  try {
    return await window.electronAPI.saveTranscription(payload);
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
}
