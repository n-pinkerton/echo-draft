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

describe("AudioManager reasoning cleanup flags", () => {
  beforeEach(() => {
    localStorage.clear();
    (window as any).electronAPI = {};
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shouldApplyReasoningCleanup respects per-job cleanupEnabled override", () => {
    const manager = new AudioManager();

    localStorage.setItem("reasoningModel", "test-model");

    localStorage.setItem("useReasoningModel", "true");
    (manager as any).activeProcessingContext = { cleanupEnabled: false };
    expect(manager.shouldApplyReasoningCleanup()).toBe(false);

    localStorage.setItem("useReasoningModel", "false");
    (manager as any).activeProcessingContext = { cleanupEnabled: true };
    expect(manager.shouldApplyReasoningCleanup()).toBe(true);

    manager.cleanup();
  });

  it("isReasoningAvailable respects per-job cleanupEnabled override", async () => {
    const manager = new AudioManager();

    localStorage.setItem("useReasoningModel", "false");
    (manager as any).activeProcessingContext = { cleanupEnabled: true };
    await expect(manager.isReasoningAvailable()).resolves.toBe(true);

    localStorage.setItem("useReasoningModel", "true");
    (manager as any).activeProcessingContext = { cleanupEnabled: false };
    await expect(manager.isReasoningAvailable()).resolves.toBe(false);

    manager.cleanup();
  });
});

