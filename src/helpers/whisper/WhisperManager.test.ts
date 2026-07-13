import { describe, expect, it, vi } from "vitest";

const WhisperManager = require("./WhisperManager");

describe("WhisperManager transcription serialization", () => {
  it("starts a fresh server only after cancelled inference has terminated", async () => {
    const manager = new WhisperManager();
    const events: string[] = [];
    const controller = new AbortController();
    let finishTermination!: () => void;
    const termination = new Promise<void>((resolve) => {
      finishTermination = resolve;
    });
    let transcriptionCount = 0;

    manager.currentServerModel = "base";
    manager.getModelPath = vi.fn(() => "ggml-base.bin");
    manager.serverManager = {
      port: 43123,
      ready: true,
      start: vi.fn(async () => {
        events.push("start-fresh");
        manager.serverManager.ready = true;
        manager.serverManager.port = 43124;
      }),
      transcribe: vi.fn(async (_audio: Buffer, options: { signal?: AbortSignal }) => {
        transcriptionCount += 1;
        if (transcriptionCount === 1) {
          events.push("transcribe-cancelled");
          return await new Promise((resolve, reject) => {
            options.signal?.addEventListener(
              "abort",
              () => {
                events.push("terminate-old");
                manager.serverManager.ready = false;
                termination.then(() => {
                  events.push("old-terminated");
                  const error = new Error("Request cancelled");
                  error.name = "AbortError";
                  reject(error);
                });
              },
              { once: true }
            );
          });
        }

        events.push("transcribe-fresh");
        return { text: "recovered" };
      }),
    };

    const cancelled = manager.transcribeViaServer(
      Buffer.from("first"),
      "base",
      "en",
      null,
      controller.signal
    );
    await vi.waitFor(() => expect(events).toEqual(["transcribe-cancelled"]));

    const next = manager.transcribeViaServer(Buffer.from("second"), "base", "en");
    controller.abort();
    await Promise.resolve();
    expect(events).toEqual(["transcribe-cancelled", "terminate-old"]);
    expect(manager.serverManager.start).not.toHaveBeenCalled();

    finishTermination();

    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await expect(next).resolves.toEqual({ success: true, text: "recovered" });
    expect(events).toEqual([
      "transcribe-cancelled",
      "terminate-old",
      "old-terminated",
      "start-fresh",
      "transcribe-fresh",
    ]);
  });
});
