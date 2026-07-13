import { EventEmitter } from "events";
import http from "http";
import { describe, expect, it, vi } from "vitest";

const debugLogger = require("../debugLogger");
const WhisperServerManager = require("./WhisperServerManager");

class FakeProcess extends EventEmitter {
  exitCode: number | null = null;
  signalCode: string | null = null;
  kill = vi.fn();
}

describe("WhisperServerManager cancellation", () => {
  it("logs dictionary prompt metadata without logging its terms", async () => {
    const marker = "PRIVATE_DICTIONARY_MARKER";
    const logSpy = vi.spyOn(debugLogger, "info");
    const manager = new WhisperServerManager();
    const servingProcess = new FakeProcess();
    const request = Object.assign(new EventEmitter(), {
      destroy: vi.fn(),
      end: vi.fn(),
      write: vi.fn(),
    });
    const requestSpy = vi.spyOn(http, "request").mockReturnValue(request as never);
    manager.process = servingProcess;
    manager.port = 43123;
    manager.ready = true;
    manager.canConvert = true;
    manager.modelPath = "ggml-base.bin";
    manager.convertAudioBuffer = vi.fn(async (buffer: Buffer) => buffer);
    const controller = new AbortController();

    const observed = manager
      .transcribe(Buffer.from("audio"), { initialPrompt: marker, signal: controller.signal })
      .catch(() => null);
    await vi.waitFor(() => expect(request.write).toHaveBeenCalledOnce());
    controller.abort();
    manager._handleProcessClose(servingProcess, 0);
    servingProcess.exitCode = 0;
    servingProcess.emit("close", 0);
    await observed;

    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(marker);
    expect(logSpy).toHaveBeenCalledWith(
      "Using custom dictionary prompt",
      expect.objectContaining({ promptPresent: true, promptLength: marker.length })
    );
    logSpy.mockRestore();
    requestSpy.mockRestore();
  });

  it("waits for the serving process to exit without clearing or killing a replacement", async () => {
    const manager = new WhisperServerManager();
    const servingProcess = new FakeProcess();
    const replacementProcess = new FakeProcess();
    const request = Object.assign(new EventEmitter(), {
      destroy: vi.fn(),
      end: vi.fn(),
      write: vi.fn(),
    });
    const requestSpy = vi.spyOn(http, "request").mockReturnValue(request as never);

    manager.process = servingProcess;
    manager.port = 43123;
    manager.ready = true;
    manager.canConvert = true;
    manager.modelPath = "ggml-base.bin";
    manager.convertAudioBuffer = vi.fn(async (buffer: Buffer) => buffer);

    const controller = new AbortController();
    const transcription = manager.transcribe(Buffer.from("uploaded audio"), {
      signal: controller.signal,
    });
    const observed = transcription.then(
      () => ({ resolved: true }),
      (error: Error) => ({ resolved: false, error })
    );

    await vi.waitFor(() => expect(request.write).toHaveBeenCalledOnce());
    controller.abort();

    expect(request.destroy).toHaveBeenCalledOnce();
    expect(manager.ready).toBe(false);
    expect(manager.process).toBeNull();

    let cancellationSettled = false;
    observed.then(() => {
      cancellationSettled = true;
    });
    await Promise.resolve();
    expect(cancellationSettled).toBe(false);

    manager.process = replacementProcess;
    manager.port = 43124;
    manager.ready = true;
    manager._handleProcessClose(servingProcess, 0);
    servingProcess.exitCode = 0;
    servingProcess.emit("close", 0);

    const outcome = await observed;
    expect(outcome.resolved).toBe(false);
    expect(outcome.error?.name).toBe("AbortError");
    expect(servingProcess.kill).toHaveBeenCalledOnce();
    expect(replacementProcess.kill).not.toHaveBeenCalled();
    expect(manager.process).toBe(replacementProcess);
    expect(manager.port).toBe(43124);
    expect(manager.ready).toBe(true);

    requestSpy.mockRestore();
  });

  it("does not release a timed-out inference until its hung server has terminated", async () => {
    const manager = new WhisperServerManager();
    const servingProcess = new FakeProcess();
    const request = Object.assign(new EventEmitter(), {
      destroy: vi.fn(),
      end: vi.fn(),
      write: vi.fn(),
    });
    const requestSpy = vi.spyOn(http, "request").mockReturnValue(request as never);

    manager.process = servingProcess;
    manager.port = 43123;
    manager.ready = true;
    manager.canConvert = true;
    manager.modelPath = "ggml-base.bin";
    manager.convertAudioBuffer = vi.fn(async (buffer: Buffer) => buffer);

    const observed = manager.transcribe(Buffer.from("uploaded audio")).then(
      () => ({ resolved: true }),
      (error: Error) => ({ resolved: false, error })
    );
    await vi.waitFor(() => expect(request.write).toHaveBeenCalledOnce());
    request.emit("timeout");

    expect(request.destroy).toHaveBeenCalledOnce();
    expect(manager.ready).toBe(false);
    expect(manager.process).toBeNull();
    let settled = false;
    observed.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    servingProcess.exitCode = 1;
    servingProcess.emit("close", 1);

    const outcome = await observed;
    expect(outcome.resolved).toBe(false);
    expect(outcome.error?.message).toBe("whisper-server request timed out");
    expect(servingProcess.kill).toHaveBeenCalledOnce();
    requestSpy.mockRestore();
  });
});
