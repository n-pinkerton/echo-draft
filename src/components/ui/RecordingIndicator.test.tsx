import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import RecordingIndicator from "./RecordingIndicator";
import { formatRecordingDuration } from "./recordingIndicatorUtils";

describe("RecordingIndicator", () => {
  it("keeps the live microphone state and elapsed time unambiguous", () => {
    const { rerender } = render(<RecordingIndicator recordedMs={134_000} />);

    expect(screen.getByText("REC")).toBeInTheDocument();
    expect(screen.getByText("Microphone live")).toBeInTheDocument();
    expect(screen.getByText("2:14")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Recording, microphone live");
    expect(screen.getByText("2:14")).toHaveAttribute("aria-live", "off");
    expect(screen.getByTestId("recording-pulse")).toHaveClass("motion-reduce:animate-none");

    rerender(<RecordingIndicator recordedMs={135_000} />);
    expect(screen.getByRole("status")).toHaveTextContent("Recording, microphone live");
    expect(screen.getByText("2:15")).toHaveAccessibleName("Recording elapsed time 2:15");
  });

  it("never formats a negative duration", () => {
    expect(formatRecordingDuration(-500)).toBe("0:00");
  });
});
