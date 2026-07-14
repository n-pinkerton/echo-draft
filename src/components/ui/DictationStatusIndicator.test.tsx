import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DictationStatusIndicator from "./DictationStatusIndicator";

describe("DictationStatusIndicator terminal states", () => {
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
  ])("renders $stage with a distinct visual treatment", (state) => {
    render(
      <DictationStatusIndicator
        stage={state.stage}
        stageLabel={state.label}
        message={state.message}
      />
    );

    const indicator = screen.getByTestId("dictation-status-indicator");
    expect(indicator.parentElement).toHaveClass(
      "fixed",
      "bottom-0",
      "right-0",
      "h-[72px]",
      "w-[260px]"
    );
    expect(indicator).toHaveAttribute("data-stage", state.stage);
    expect(indicator).toHaveClass(state.borderClass);
    expect(screen.getByText(state.label)).toBeInTheDocument();
    expect(screen.getByText(state.message)).toBeInTheDocument();
    expect(indicator.querySelector("svg")?.parentElement).toHaveClass(state.iconClass);
    expect(indicator.querySelector("time")).not.toBeInTheDocument();
  });

  it("shows the active destination and waiting work while processing", () => {
    render(
      <DictationStatusIndicator
        stage="transcribing"
        stageLabel="Transcribing"
        canCancel
        outputMode="clipboard"
        queuedWaitingCount={2}
      />
    );

    expect(
      screen.getByText("Clipboard · 2 waiting · Cancel from the EchoDraft tray menu")
    ).toBeInTheDocument();
  });
});
