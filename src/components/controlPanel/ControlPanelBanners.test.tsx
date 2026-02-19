import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import ControlPanelBanners from "./ControlPanelBanners";

describe("ControlPanelBanners", () => {
  it("renders cloud migration banner and triggers actions", () => {
    const onDismissCloudMigration = vi.fn();
    const onViewCloudSettings = vi.fn();

    render(
      <ControlPanelBanners
        showCloudMigrationBanner
        onDismissCloudMigration={onDismissCloudMigration}
        onViewCloudSettings={onViewCloudSettings}
        useReasoningModel
        aiCTADismissed
        onDismissAiCTA={vi.fn()}
        onEnableAiEnhancement={vi.fn()}
      />
    );

    expect(screen.getByText("Welcome to EchoDraft Pro")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View Settings" }));
    expect(onViewCloudSettings).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss cloud migration banner" }));
    expect(onDismissCloudMigration).toHaveBeenCalledTimes(1);
  });

  it("renders AI enhancement CTA when applicable", () => {
    const onDismissAiCTA = vi.fn();
    const onEnableAiEnhancement = vi.fn();

    render(
      <ControlPanelBanners
        showCloudMigrationBanner={false}
        onDismissCloudMigration={vi.fn()}
        onViewCloudSettings={vi.fn()}
        useReasoningModel={false}
        aiCTADismissed={false}
        onDismissAiCTA={onDismissAiCTA}
        onEnableAiEnhancement={onEnableAiEnhancement}
      />
    );

    expect(screen.getByText("Enhance your transcriptions with AI")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enable AI Enhancement" }));
    expect(onEnableAiEnhancement).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss AI enhancement prompt" }));
    expect(onDismissAiCTA).toHaveBeenCalledTimes(1);
  });
});

