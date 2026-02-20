import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/neonAuth", () => ({
  withSessionRefresh: async (fn: any) => await fn(),
}));

vi.mock("../../services/ReasoningService", () => ({
  default: {
    processText: vi.fn(async (text: string) => text),
    isAvailable: vi.fn(async () => true),
  },
}));

import AudioManager from "../audioManager.js";

describe("AudioManager.warmupMicrophoneDriver", () => {
  const originalPermissions = (navigator as any).permissions;
  const originalMediaDevices = (navigator as any).mediaDevices;

  beforeEach(() => {
    localStorage.clear();
    (window as any).electronAPI = {};
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("skips when permission is prompt", async () => {
    const manager = new AudioManager();
    localStorage.setItem("preferBuiltInMic", "false");

    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    Object.defineProperty(navigator, "permissions", {
      value: { query: vi.fn(async () => ({ state: "prompt" })) },
      configurable: true,
    });

    const result = await manager.warmupMicrophoneDriver();
    expect(result).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();

    manager.cleanup();
  });

  it("skips when permission state is unknown and not previously granted", async () => {
    const manager = new AudioManager();
    localStorage.setItem("preferBuiltInMic", "false");

    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    Object.defineProperty(navigator, "permissions", {
      value: undefined,
      configurable: true,
    });

    const result = await manager.warmupMicrophoneDriver();
    expect(result).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();

    manager.cleanup();
  });

  it("pre-warms when permission is granted", async () => {
    const manager = new AudioManager();
    localStorage.setItem("preferBuiltInMic", "false");

    const trackStop = vi.fn();
    const fakeStream = { getTracks: () => [{ stop: trackStop }] };
    const getUserMedia = vi.fn(async () => fakeStream);

    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    Object.defineProperty(navigator, "permissions", {
      value: { query: vi.fn(async () => ({ state: "granted" })) },
      configurable: true,
    });

    expect(localStorage.getItem("micPermissionGranted")).toBe(null);

    const result = await manager.warmupMicrophoneDriver();
    expect(result).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(trackStop).toHaveBeenCalled();
    expect(localStorage.getItem("micPermissionGranted")).toBe("true");

    const result2 = await manager.warmupMicrophoneDriver();
    expect(result2).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    manager.cleanup();
  });
});

