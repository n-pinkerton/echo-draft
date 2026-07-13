import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import RecordingIndicator from "./RecordingIndicator";
import {
  formatRecordingDuration,
  shouldShowLongRecordingReminder,
} from "./recordingIndicatorUtils";

describe("RecordingIndicator", () => {
  it("keeps the live microphone state and elapsed time unambiguous", () => {
    const { rerender } = render(<RecordingIndicator recordedMs={34_000} />);

    expect(screen.getByText("REC")).toBeInTheDocument();
    expect(screen.getByText("Microphone live")).toBeInTheDocument();
    expect(screen.getByText("0:34")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Recording, microphone live");
    expect(screen.getByText("0:34")).toHaveAttribute("aria-live", "off");
    expect(screen.getByTestId("recording-pulse")).toHaveClass("motion-reduce:animate-none");

    rerender(<RecordingIndicator recordedMs={35_000} />);
    expect(screen.getByRole("status")).toHaveTextContent("Recording, microphone live");
    expect(screen.getByText("0:35")).toHaveAccessibleName("Recording elapsed time 0:35");
  });

  it("never formats a negative duration", () => {
    expect(formatRecordingDuration(-500)).toBe("0:00");
  });

  it("uses a silent visual reminder after one minute and keeps it optional", () => {
    const { rerender } = render(<RecordingIndicator recordedMs={59_999} />);
    expect(screen.getByTestId("recording-indicator")).toHaveAttribute(
      "data-long-recording",
      "false"
    );

    rerender(<RecordingIndicator recordedMs={60_000} />);
    expect(screen.getByText("Mic live · still recording")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Still recording, microphone live, one minute elapsed"
    );
    expect(screen.getByTestId("recording-indicator")).toHaveAttribute(
      "data-long-recording",
      "true"
    );

    rerender(<RecordingIndicator recordedMs={60_000} longRecordingReminderEnabled={false} />);
    expect(screen.getByText("Microphone live")).toBeInTheDocument();
    expect(shouldShowLongRecordingReminder(60_000, false)).toBe(false);
  });
});
