const debugLogger = require("../../debugLogger");
const { requireTrustedRenderer } = require("../trustedRenderer");

const MAX_RENDERER_LOG_BYTES = 128 * 1024;
const RENDERER_LOG_WINDOW_MS = 10_000;
const MAX_RENDERER_LOG_ENTRIES_PER_WINDOW = 200;
const MAX_RENDERER_LOG_BYTES_PER_WINDOW = 2 * 1024 * 1024;
const MAX_RENDERER_LOG_ENTRIES_GLOBAL_PER_WINDOW = 300;
const MAX_RENDERER_LOG_BYTES_GLOBAL_PER_WINDOW = 2 * 1024 * 1024;

function registerRendererLogHandlers({ ipcMain }, { windowManager }) {
  const senderBudgets = new WeakMap();
  let globalBudget = { startedAt: 0, entries: 0, bytes: 0 };

  ipcMain.handle("get-log-level", async (event) => {
    requireTrustedRenderer(event, windowManager);
    return debugLogger.getLevel();
  });

  ipcMain.handle("app-log", async (event, entry) => {
    requireTrustedRenderer(event, windowManager);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Invalid renderer log entry");
    }
    const message = typeof entry.message === "string" ? entry.message : String(entry.message || "");
    if (message.length > 50_000) throw new Error("Renderer log entry is too large");
    let serialized;
    try {
      serialized = JSON.stringify(entry);
    } catch {
      throw new Error("Renderer log entry must be serializable");
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_RENDERER_LOG_BYTES) {
      throw new Error("Renderer log entry is too large");
    }
    const serializedBytes = Buffer.byteLength(serialized, "utf8");
    const now = Date.now();
    let budget = senderBudgets.get(event.sender);
    if (!budget || now - budget.startedAt >= RENDERER_LOG_WINDOW_MS) {
      budget = { startedAt: now, entries: 0, bytes: 0 };
      senderBudgets.set(event.sender, budget);
    }
    if (
      budget.entries >= MAX_RENDERER_LOG_ENTRIES_PER_WINDOW ||
      budget.bytes + serializedBytes > MAX_RENDERER_LOG_BYTES_PER_WINDOW
    ) {
      throw new Error("Renderer logging is temporarily rate limited");
    }
    if (now - globalBudget.startedAt >= RENDERER_LOG_WINDOW_MS) {
      globalBudget = { startedAt: now, entries: 0, bytes: 0 };
    }
    if (
      globalBudget.entries >= MAX_RENDERER_LOG_ENTRIES_GLOBAL_PER_WINDOW ||
      globalBudget.bytes + serializedBytes > MAX_RENDERER_LOG_BYTES_GLOBAL_PER_WINDOW
    ) {
      throw new Error("Renderer logging is temporarily rate limited");
    }
    budget.entries += 1;
    budget.bytes += serializedBytes;
    globalBudget.entries += 1;
    globalBudget.bytes += serializedBytes;
    debugLogger.logEntry(entry);
    return { success: true };
  });
}

module.exports = {
  MAX_RENDERER_LOG_BYTES,
  MAX_RENDERER_LOG_BYTES_PER_WINDOW,
  MAX_RENDERER_LOG_ENTRIES_PER_WINDOW,
  MAX_RENDERER_LOG_BYTES_GLOBAL_PER_WINDOW,
  MAX_RENDERER_LOG_ENTRIES_GLOBAL_PER_WINDOW,
  RENDERER_LOG_WINDOW_MS,
  registerRendererLogHandlers,
};
