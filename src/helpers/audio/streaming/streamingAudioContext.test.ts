import { afterEach, describe, expect, it, vi } from "vitest";

import { getOrCreateAudioContext } from "./streamingAudioContext";

describe("streamingAudioContext", () => {
  const OriginalAudioContext = (globalThis as any).AudioContext;

  afterEach(() => {
    (globalThis as any).AudioContext = OriginalAudioContext;
    vi.restoreAllMocks();
  });

  it("creates a new AudioContext with 16kHz sample rate when none exists", async () => {
    class FakeAudioContext {
      sampleRate: number;
      state: string;
      constructor(opts: any) {
        this.sampleRate = opts.sampleRate;
        this.state = "running";
      }
      resume = vi.fn(async () => {
        this.state = "running";
      });
    }

    (globalThis as any).AudioContext = FakeAudioContext;

    const manager: any = { persistentAudioContext: null, workletModuleLoaded: true };
    const ctx = await getOrCreateAudioContext(manager);
    expect(ctx).toBeInstanceOf(FakeAudioContext);
    expect((ctx as any).sampleRate).toBe(16000);
    expect(manager.workletModuleLoaded).toBe(false);
  });

  it("resumes and returns existing suspended context", async () => {
    const resume = vi.fn(async () => {});
    const existing = { state: "suspended", resume };

    const manager: any = { persistentAudioContext: existing, workletModuleLoaded: true };
    const ctx = await getOrCreateAudioContext(manager);
    expect(ctx).toBe(existing);
    expect(resume).toHaveBeenCalledTimes(1);
  });
});

