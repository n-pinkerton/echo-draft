const { requireTrustedRenderer } = require("../trustedRenderer");

const normalizeApprovedEndpoint = (value) => {
  const parsed = new URL(String(value || "").trim());
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.username || parsed.password || parsed.hash) throw new Error("Invalid custom endpoint");
  if (parsed.protocol !== "https:" && !(isLoopback && parsed.protocol === "http:")) {
    throw new Error("Custom endpoints must use HTTPS (except localhost)");
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
};

function registerEnvironmentHandlers({ ipcMain, dialog }, { environmentManager, windowManager }) {
  ipcMain.handle("save-openai-key", async (event, key) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    return environmentManager.saveOpenAIKey(key);
  });

  ipcMain.handle("approve-custom-provider-endpoint", async (event, purpose, value) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    if (purpose !== "transcription" && purpose !== "reasoning") {
      throw new Error("Invalid custom provider purpose");
    }
    const normalized = normalizeApprovedEndpoint(value);
    const isTranscription = purpose === "transcription";
    const current = isTranscription
      ? environmentManager.getCustomTranscriptionBaseUrl()
      : environmentManager.getCustomReasoningBaseUrl();
    if (current === normalized) return { success: true, endpoint: normalized, unchanged: true };

    const confirmation = await dialog.showMessageBox(windowManager.controlPanelWindow, {
      type: "warning",
      title: "Trust custom AI endpoint?",
      message: `Allow EchoDraft to send ${isTranscription ? "recordings" : "dictated text"} to this endpoint?`,
      detail: `${new URL(normalized).origin}\n\nEchoDraft will send the configured custom API key only to this approved endpoint.`,
      buttons: ["Cancel", "Trust Endpoint"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1) return { success: false, cancelled: true };

    if (isTranscription) environmentManager.saveCustomTranscriptionBaseUrl(normalized);
    else environmentManager.saveCustomReasoningBaseUrl(normalized);
    environmentManager.saveAllKeysToEnvFile();
    return { success: true, endpoint: normalized };
  });
}

module.exports = { normalizeApprovedEndpoint, registerEnvironmentHandlers };
