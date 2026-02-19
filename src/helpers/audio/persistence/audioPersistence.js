export async function safePaste(manager, text, options = {}) {
  try {
    await window.electronAPI.pasteText(text, options);
    return true;
  } catch (error) {
    const message =
      error?.message ?? (typeof error?.toString === "function" ? error.toString() : String(error));
    manager.emitError(
      {
        title: "Paste Error",
        description: `Failed to insert text automatically. ${message}`,
      },
      error
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

