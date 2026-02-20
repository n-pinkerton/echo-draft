import { describe, expect, it, vi } from "vitest";

const ParakeetManager = require("./ParakeetManager");

describe("ParakeetManager", () => {
  it("throws when the parakeet server binary is unavailable", async () => {
    const manager = new ParakeetManager();
    manager.serverManager = {
      isAvailable: () => false,
    };

    await expect(manager.transcribeLocalParakeet(Buffer.from("abc"), {})).rejects.toThrow(
      /sherpa-onnx binary not found/i
    );
  });

  it("throws when the selected model is not downloaded", async () => {
    const manager = new ParakeetManager();
    manager.serverManager = {
      isAvailable: () => true,
      isModelDownloaded: () => false,
    };

    await expect(
      manager.transcribeLocalParakeet(Buffer.from("abc"), { model: "parakeet-tdt-0.6b-v3" })
    ).rejects.toThrow(/not downloaded/i);
  });

  it("returns trimmed text for a successful transcription", async () => {
    const transcribe = vi.fn().mockResolvedValue({ text: " hello " });
    const manager = new ParakeetManager();
    manager.serverManager = {
      isAvailable: () => true,
      isModelDownloaded: () => true,
      transcribe,
    };

    const audio = Buffer.from("abc");
    const result = await manager.transcribeLocalParakeet(audio, { model: "parakeet-tdt-0.6b-v3" });

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledWith(audio, {
      modelName: "parakeet-tdt-0.6b-v3",
      language: "auto",
    });
    expect(result).toEqual({ success: true, text: "hello" });
  });
});

