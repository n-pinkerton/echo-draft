import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import DictationStatusBar from "./DictationStatusBar";

describe("DictationStatusBar", () => {
  it("renders the timer next to the stage and triggers copy and launch actions", () => {
    const onCopyTranscript = vi.fn();
    const onLaunchApp = vi.fn();

    render(
      <DictationStatusBar
        progress={{
          stage: "listening",
          stageLabel: "Listening",
          recordedMs: 12500,
          elapsedMs: 12500,
          stageProgress: 0.25,
        }}
        canCopyTranscript
        onCopyTranscript={onCopyTranscript}
        onLaunchApp={onLaunchApp}
      />
    );

    expect(screen.getByText("Listening")).toBeInTheDocument();
    expect(screen.getByText("0:12")).toBeInTheDocument();
    expect(screen.getByText("Recording")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy last transcript" }));
    fireEvent.click(screen.getByRole("button", { name: "Open main app" }));

    expect(onCopyTranscript).toHaveBeenCalledTimes(1);
    expect(onLaunchApp).toHaveBeenCalledTimes(1);
  });

  it("does not copy when no transcript is available", () => {
    const onCopyTranscript = vi.fn();

    render(
      <DictationStatusBar
        progress={{
          stage: "idle",
          stageLabel: "Ready",
          elapsedMs: 0,
          stageProgress: 0,
        }}
        canCopyTranscript={false}
        onCopyTranscript={onCopyTranscript}
        onLaunchApp={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "No transcript to copy yet" }));

    expect(onCopyTranscript).not.toHaveBeenCalled();
  });
});
