import { describe, expect, it, vi } from "vitest";

const LlamaServerManager = require("./llamaServer");

describe("LlamaServerManager cancellation", () => {
  it("stops readiness polling immediately when startup is cancelled", async () => {
    const manager = new LlamaServerManager();
    manager.process = { killed: false };
    manager.checkHealth = vi.fn(async () => false);
    const controller = new AbortController();
    const pending = manager.waitForReady(() => ({ stderr: "", exitCode: null }), controller.signal);
    await vi.waitFor(() => expect(manager.checkHealth).toHaveBeenCalledOnce());

    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
  });
});
