import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

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
  useToast: () => ({ toast: mocks.toast }),
}));

import App from "./App";

describe("App recording indicator routing", () => {
  beforeEach(() => {
    mocks.recordingState = {
      ...mocks.recordingState,
      isRecording: true,
      isProcessing: false,
      progress: {
        stage: "listening",
        stageLabel: "Listening",
        recordedMs: 2_000,
        elapsedMs: 2_000,
      },
    };
    (window as any).electronAPI = {
      onHotkeyFallbackUsed: vi.fn(() => vi.fn()),
      onHotkeyRegistrationFailed: vi.fn(() => vi.fn()),
      onWindowsPushToTalkUnavailable: vi.fn(() => vi.fn()),
      updateTrayStatus: vi.fn(),
      showRecordingIndicator: vi.fn(async () => ({ success: true })),
      hideWindow: vi.fn(async () => undefined),
    };
  });

  it("shows only after listening begins and hides as soon as processing starts", () => {
    const { rerender } = render(<App />);

    expect(window.electronAPI.showRecordingIndicator).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.hideWindow).not.toHaveBeenCalled();

    mocks.recordingState = {
      ...mocks.recordingState,
      isRecording: false,
      isProcessing: true,
      progress: {
        ...mocks.recordingState.progress,
        stage: "transcribing",
        stageLabel: "Transcribing",
      },
    };
    rerender(<App />);

    expect(window.electronAPI.hideWindow).toHaveBeenCalledTimes(1);
  });
});
