import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MicrophoneService } from "./microphoneService";

describe("MicrophoneService", () => {
  const originalPermissions = (navigator as any).permissions;
  const originalMediaDevices = (navigator as any).mediaDevices;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "permissions", {
      value: originalPermissions,
      configurable: true,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      value: originalMediaDevices,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("getAudioConstraints uses cached built-in device id when available", async () => {
    const logger = { debug: vi.fn() };
    const service = new MicrophoneService({ logger, isBuiltInMicrophoneFn: vi.fn() as any });
    service.cachedMicDeviceId = "device-123";

    const constraints = await service.getAudioConstraints();
    expect(constraints.audio.deviceId.exact).toBe("device-123");
  });

  it("getAudioConstraints enumerates devices and caches built-in mic", async () => {
    const logger = { debug: vi.fn() };
    const enumerateDevices = vi.fn(async () => [
      { kind: "audioinput", deviceId: "not-built-in", label: "USB Mic" },
      { kind: "audioinput", deviceId: "built-in-1", label: "Built-in Microphone" },
    ]);

    Object.defineProperty(navigator, "mediaDevices", {
      value: { enumerateDevices },
      configurable: true,
    });

    const service = new MicrophoneService({
      logger,
      isBuiltInMicrophoneFn: (label: string) => label.toLowerCase().includes("built-in"),
    });

    const constraints = await service.getAudioConstraints();
    expect(constraints.audio.deviceId.exact).toBe("built-in-1");
    expect(service.cachedMicDeviceId).toBe("built-in-1");
  });

  it("getAudioConstraints uses selected device when preferBuiltInMic is disabled", async () => {
    localStorage.setItem("preferBuiltInMic", "false");
    localStorage.setItem("selectedMicDeviceId", "selected-99");

    const logger = { debug: vi.fn() };
    const service = new MicrophoneService({ logger, isBuiltInMicrophoneFn: vi.fn() as any });

    const constraints = await service.getAudioConstraints();
    expect(constraints.audio.deviceId.exact).toBe("selected-99");
  });

  it("warmupMicrophoneDriver skips when permission is prompt", async () => {
    const logger = { debug: vi.fn() };
    const service = new MicrophoneService({ logger, isBuiltInMicrophoneFn: vi.fn() as any });

    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia, enumerateDevices: vi.fn(async () => []) },
      configurable: true,
    });
    Object.defineProperty(navigator, "permissions", {
      value: { query: vi.fn(async () => ({ state: "prompt" })) },
      configurable: true,
    });

    const result = await service.warmupMicrophoneDriver();
    expect(result).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("warmupMicrophoneDriver uses persisted grant when Permissions API is unavailable", async () => {
    const logger = { debug: vi.fn() };
    const service = new MicrophoneService({ logger, isBuiltInMicrophoneFn: vi.fn() as any });

    localStorage.setItem("micPermissionGranted", "true");

    const trackStop = vi.fn();
    const fakeStream = { getTracks: () => [{ stop: trackStop }] };
    const getUserMedia = vi.fn(async () => fakeStream);

    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia, enumerateDevices: vi.fn(async () => []) },
      configurable: true,
    });
    Object.defineProperty(navigator, "permissions", {
      value: undefined,
      configurable: true,
    });

    const result = await service.warmupMicrophoneDriver();
    expect(result).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(trackStop).toHaveBeenCalled();
  });

  it("warmupMicrophoneDriver is idempotent after successful warmup", async () => {
    const logger = { debug: vi.fn() };
    const service = new MicrophoneService({ logger, isBuiltInMicrophoneFn: vi.fn() as any });

    const trackStop = vi.fn();
    const fakeStream = { getTracks: () => [{ stop: trackStop }] };
    const getUserMedia = vi.fn(async () => fakeStream);

    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia, enumerateDevices: vi.fn(async () => []) },
      configurable: true,
    });
    Object.defineProperty(navigator, "permissions", {
      value: { query: vi.fn(async () => ({ state: "granted" })) },
      configurable: true,
    });

    await expect(service.warmupMicrophoneDriver()).resolves.toBe(true);
    await expect(service.warmupMicrophoneDriver()).resolves.toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

