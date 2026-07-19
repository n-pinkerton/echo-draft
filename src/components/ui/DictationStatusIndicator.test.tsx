import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DictationStatusIndicator from "./DictationStatusIndicator";

describe("DictationStatusIndicator", () => {
  it("shows the active stage, destination, queue, timer, and cancellation guidance", () => {
    render(
      <DictationStatusIndicator
        stage="transcribing"
        stageLabel="Transcribing"
        stageElapsedMs={12_000}
        canCancel
        outputMode="clipboard"
        queuedWaitingCount={2}
      />
    );

    const indicator = screen.getByTestId("dictation-status-indicator");
    expect(indicator).toHaveAttribute("data-stage", "transcribing");
    expect(indicator).not.toHaveAttribute("role");
    expect(screen.getByText("Transcribing")).toBeInTheDocument();
    expect(screen.getByText("0:12")).toBeInTheDocument();
    expect(
      screen.getByText("Clipboard · 2 waiting · Cancel from the EchoDraft tray menu")
    ).toBeInTheDocument();
    expect(indicator.querySelector("svg")).toHaveClass("animate-spin");
  });

  it.each([
    {
      stage: "done",
      label: "Complete",
      message: "Text delivered",
      borderClass: "border-success/50",
      iconClass: "text-success",
    },
    {
      stage: "warning",
      label: "Needs attention",
      message: "Insert failed; text kept in clipboard.",
      borderClass: "border-warning/60",
      iconClass: "text-warning-text",
    },
    {
      stage: "error",
      label: "Delivery failed",
      message: "Automatic text delivery failed.",
      borderClass: "border-destructive/50",
      iconClass: "text-destructive",
    },
  ])("renders $stage with a distinct terminal treatment", (state) => {
    render(
      <DictationStatusIndicator
        stage={state.stage}
        stageLabel={state.label}
        message={state.message}
      />
    );

    const indicator = screen.getByTestId("dictation-status-indicator");
    expect(indicator).toHaveAttribute("data-stage", state.stage);
    expect(indicator).toHaveClass(state.borderClass);
    expect(screen.getByText(state.label)).toBeInTheDocument();
    expect(screen.getByText(state.message)).toBeInTheDocument();
    expect(indicator.querySelector("svg")?.parentElement).toHaveClass(state.iconClass);
    expect(indicator.querySelector("time")).not.toBeInTheDocument();
  });
});
