import { describe, expect, it, vi } from "vitest";

import { INITIAL_PROGRESS } from "./stages";
import { createStageUpdater } from "./stageUpdater";

describe("createStageUpdater", () => {
  it("updates progress stage + label and tracks elapsed/recorded", () => {
    let progress = { ...INITIAL_PROGRESS };

    const latestProgressRef = { current: progress };
    const sessionStartedAtRef = { current: null as number | null };
    const recordingStartedAtRef = { current: null as number | null };
    const progressResetTimerRef = { current: null as any };
    const jobsBySessionIdRef = { current: new Map() };
    const audioManagerRef = {
      current: {
        getState: () => ({ isRecording: false, isProcessing: false }),
      },
    };

    const clearProgressResetTimer = vi.fn();
    const resetProgress = vi.fn();

    const setProgress = (updater: any) => {
      progress = typeof updater === "function" ? updater(progress) : updater;
    };

    const updateStage = createStageUpdater({
      audioManagerRef,
      clearProgressResetTimer,
      jobsBySessionIdRef,
      latestProgressRef,
      progressResetTimerRef,
      recordingStartedAtRef,
      resetProgress,
      sessionStartedAtRef,
      setProgress,
    });

    updateStage("starting", { sessionId: "s-1", jobId: 1 });
    latestProgressRef.current = progress;

    expect(progress.stage).toBe("starting");
    expect(progress.stageLabel).toBe("Starting");
    expect(progress.sessionId).toBe("s-1");
    expect(progress.jobId).toBe(1);
  });

  it("schedules an auto-reset after terminal stages when idle", async () => {
    vi.useFakeTimers();
    let progress = { ...INITIAL_PROGRESS };

    const latestProgressRef = { current: progress };
    const sessionStartedAtRef = { current: null as number | null };
    const recordingStartedAtRef = { current: null as number | null };
    const progressResetTimerRef = { current: null as any };
    const jobsBySessionIdRef = { current: new Map() };
    const audioManagerRef = {
      current: {
        getState: () => ({ isRecording: false, isProcessing: false }),
      },
    };

    const clearProgressResetTimer = vi.fn();
    const resetProgress = vi.fn();

    const setProgress = (updater: any) => {
      progress = typeof updater === "function" ? updater(progress) : updater;
    };

    const updateStage = createStageUpdater({
      audioManagerRef,
      clearProgressResetTimer,
      jobsBySessionIdRef,
      latestProgressRef,
      progressResetTimerRef,
      recordingStartedAtRef,
      resetProgress,
      sessionStartedAtRef,
      setProgress,
    });

    updateStage("done", { sessionId: "s-1" });
    latestProgressRef.current = progress;

    await vi.advanceTimersByTimeAsync(3000);
    expect(resetProgress).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});

