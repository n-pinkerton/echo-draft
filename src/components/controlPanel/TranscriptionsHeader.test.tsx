import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import TranscriptionsHeader from "./TranscriptionsHeader";

describe("TranscriptionsHeader", () => {
  it("renders counts and triggers actions", () => {
    const onOpenFileTranscribeDialog = vi.fn();
    const onClearHistory = vi.fn(async () => {});

    render(
      <TranscriptionsHeader
        historyLength={10}
        filteredHistoryLength={3}
        isFileTranscribing={false}
        onOpenFileTranscribeDialog={onOpenFileTranscribeDialog}
        onClearHistory={onClearHistory}
      />
    );

    expect(screen.getByText("(3 / 10)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Transcribe Audio File…" }));
    expect(onOpenFileTranscribeDialog).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClearHistory).toHaveBeenCalledTimes(1);
  });

  it("hides Clear action when there is no history", () => {
    render(
      <TranscriptionsHeader
        historyLength={0}
        filteredHistoryLength={0}
        isFileTranscribing={false}
        onOpenFileTranscribeDialog={vi.fn()}
        onClearHistory={vi.fn(async () => {})}
      />
    );

    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });
});

