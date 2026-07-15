import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  recordingState: {
    isRecording: true,
    isProcessing: false,
    progress: {
      stage: "listening",
      stageLabel: "Listening",
      recordedMs: 2_000,
      elapsedMs: 2_000,
    },
    jobs: [],
    transcript: "",
    partialTranscript: "",
    warmupStreaming: vi.fn(),
  } as any,
  toast: vi.fn(),
  toastState: {
    toastCount: 0,
    toastViewportSize: "default" as "default" | "compact",
  },
}));

vi.mock("./hooks/useAudioRecording", () => ({
  useAudioRecording: () => mocks.recordingState,
}));
vi.mock("./hooks/useAuth", () => ({
  useAuth: () => ({ isSignedIn: false }),
}));
vi.mock("./hooks/useLocalStorage", () => ({
  useLocalStorage: () => [true, vi.fn(), vi.fn()],
}));
vi.mock("./components/ui/toastContext", () => ({
  useToast: () => ({ toast: mocks.toast, ...mocks.toastState }),
}));

import App from "./App";

describe("App recording indicator routing", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dictation-window-surface");
    mocks.recordingState = {
      ...mocks.recordingState,
      isRecording: true,
      isProcessing: false,
      jobs: [],
      progress: {
        stage: "listening",
        stageLabel: "Listening",
        recordedMs: 2_000,
        elapsedMs: 2_000,
      },
    };
    mocks.toastState = { toastCount: 0, toastViewportSize: "default" };
    (window as any).electronAPI = {
      onHotkeyFallbackUsed: vi.fn(() => vi.fn()),
      onHotkeyRegistrationFailed: vi.fn(() => vi.fn()),
      onWindowsPushToTalkUnavailable: vi.fn(() => vi.fn()),
      updateTrayStatus: vi.fn(),
      showRecordingIndicator: vi.fn(async () => ({ success: true })),
      hideWindow: vi.fn(async () => undefined),
    };
  });

  it("keeps a stage timer and cancellation guidance visible while processing", () => {
    const { rerender } = render(<App />);

    expect(window.electronAPI.showRecordingIndicator).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.showRecordingIndicator).toHaveBeenCalledWith("RECORDING_INDICATOR");
    expect(window.electronAPI.hideWindow).not.toHaveBeenCalled();

    mocks.recordingState = {
      ...mocks.recordingState,
      isRecording: false,
      isProcessing: true,
      progress: {
        ...mocks.recordingState.progress,
        stage: "transcribing",
        stageLabel: "Transcribing",
        stageElapsedMs: 12_000,
        canCancel: true,
        outputMode: "insert",
      },
    };
    rerender(<App />);

    expect(window.electronAPI.hideWindow).not.toHaveBeenCalled();
    expect(screen.getByTestId("dictation-status-indicator")).toHaveAttribute(
      "data-stage",
      "transcribing"
    );
    expect(screen.getByText("0:12")).toBeInTheDocument();
    expect(screen.getByText("Insert · Cancel from the EchoDraft tray menu")).toBeInTheDocument();
  });

  it("keeps the overlay transparent through the final hide frame", () => {
    const { rerender, unmount } = render(<App />);

    expect(document.documentElement).toHaveClass("dictation-window-surface");

    mocks.recordingState = {
      ...mocks.recordingState,
      isRecording: false,
      isProcessing: false,
      progress: {
        stage: "idle",
        stageLabel: "Ready",
      },
    };
    rerender(<App />);

    expect(screen.queryByTestId("recording-indicator")).not.toBeInTheDocument();
    expect((window as any).electronAPI.hideWindow).toHaveBeenCalledTimes(1);
    expect(document.documentElement).toHaveClass("dictation-window-surface");

    unmount();
    expect(document.documentElement).not.toHaveClass("dictation-window-surface");
  });

  it("shows earlier queued work without hiding the live recording state", () => {
    mocks.recordingState = {
      ...mocks.recordingState,
      isRecording: true,
      isProcessing: true,
      jobs: [
        { sessionId: "first", jobId: 1, status: "processing" },
        { sessionId: "second", jobId: 2, status: "recording" },
      ],
      progress: {
        ...mocks.recordingState.progress,
        stage: "listening",
        outputMode: "insert",
      },
    };

    render(<App />);

    expect(screen.getByText("Mic live · Insert · 1 ahead")).toBeInTheDocument();
    expect((window as any).electronAPI.updateTrayStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        isRecording: true,
        isProcessing: true,
        jobCount: 2,
        queuedJobCount: 1,
        waitingJobCount: 1,
      })
    );
  });

  it("makes a background recovery notice visible while a newer recording owns the status", async () => {
    mocks.recordingState = {
      ...mocks.recordingState,
      isRecording: true,
      isProcessing: true,
      jobs: [
        { sessionId: "older-job", jobId: 1, status: "processing" },
        { sessionId: "live-job", jobId: 2, status: "recording" },
      ],
      progress: {
        ...mocks.recordingState.progress,
        stage: "listening",
        outputMode: "insert",
      },
    };
    mocks.toastState = { toastCount: 1, toastViewportSize: "default" };

    render(<App />);

    expect((window as any).electronAPI.showRecordingIndicator).toHaveBeenCalledWith("WITH_TOAST");
    expect(screen.getByTestId("recording-indicator")).toBeInTheDocument();
  });

  it("resizes atomically only when toast presence or viewport size changes", () => {
    const showRecordingIndicator = (window as any).electronAPI.showRecordingIndicator as ReturnType<
      typeof vi.fn
    >;
    const { rerender } = render(<App />);

    expect(showRecordingIndicator).toHaveBeenLastCalledWith("RECORDING_INDICATOR");
    showRecordingIndicator.mockClear();

    mocks.toastState = { toastCount: 1, toastViewportSize: "default" };
    rerender(<App />);
    expect(showRecordingIndicator).toHaveBeenCalledTimes(1);
    expect(showRecordingIndicator).toHaveBeenLastCalledWith("WITH_TOAST");

    mocks.toastState = { toastCount: 2, toastViewportSize: "default" };
    rerender(<App />);
    mocks.toastState = { toastCount: 1, toastViewportSize: "default" };
    rerender(<App />);
    expect(showRecordingIndicator).toHaveBeenCalledTimes(1);

    mocks.toastState = { toastCount: 1, toastViewportSize: "compact" };
    rerender(<App />);
    expect(showRecordingIndicator).toHaveBeenCalledTimes(2);
    expect(showRecordingIndicator).toHaveBeenLastCalledWith("WITH_COMPACT_TOAST");

    mocks.toastState = { toastCount: 0, toastViewportSize: "default" };
    rerender(<App />);
    expect(showRecordingIndicator).toHaveBeenCalledTimes(3);
    expect(showRecordingIndicator).toHaveBeenLastCalledWith("RECORDING_INDICATOR");
    expect((window as any).electronAPI.hideWindow).not.toHaveBeenCalled();
  });
});
