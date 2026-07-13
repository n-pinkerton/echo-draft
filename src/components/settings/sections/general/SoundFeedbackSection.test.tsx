import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const cueMocks = vi.hoisted(() => ({
  playStartCue: vi.fn(),
  playStopCue: vi.fn(),
  playCompletionCue: vi.fn(),
  playErrorCue: vi.fn(),
  playCancelCue: vi.fn(),
}));

vi.mock("../../../../utils/dictationCues", () => ({
  DEFAULT_DICTATION_SOUND_VOLUME: 65,
  DICTATION_FEEDBACK_STORAGE_KEYS: {
    soundsEnabled: "dictationSoundsEnabled",
    soundVolume: "dictationSoundVolume",
    recordingIndicatorEnabled: "recordingIndicatorEnabled",
    longRecordingReminderEnabled: "longRecordingReminderEnabled",
  },
  ...cueMocks,
}));

import SoundFeedbackSection from "./SoundFeedbackSection";

describe("SoundFeedbackSection", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("stores feedback preferences and previews a disabled sound on demand", async () => {
    const user = userEvent.setup();
    render(<SoundFeedbackSection />);

    await user.click(screen.getByRole("switch", { name: "Enable dictation sounds" }));
    expect(localStorage.getItem("dictationSoundsEnabled")).toBe("false");

    fireEvent.change(screen.getByRole("slider", { name: "Dictation sound volume" }), {
      target: { value: "45" },
    });
    expect(localStorage.getItem("dictationSoundVolume")).toBe("45");

    await user.click(screen.getByRole("button", { name: "Preview recording started sound" }));
    expect(cueMocks.playStartCue).toHaveBeenCalledWith({ force: true, volume: 45 });

    await user.click(screen.getByRole("switch", { name: "Show recording timer" }));
    expect(localStorage.getItem("recordingIndicatorEnabled")).toBe("false");
  });

  it("stores the optional silent long-recording reminder", async () => {
    const user = userEvent.setup();
    render(<SoundFeedbackSection />);

    await user.click(screen.getByRole("switch", { name: "Show long recording reminder" }));

    expect(localStorage.getItem("longRecordingReminderEnabled")).toBe("false");
  });
});
