import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DictationQuickStart from "./DictationQuickStart";

describe("DictationQuickStart", () => {
  it("explains both dictation modes and opens settings", () => {
    const onOpenSettings = vi.fn();
    render(
      <DictationQuickStart
        insertHotkey="F10"
        clipboardHotkey="Control+Alt"
        activationMode="tap"
        cleanupEnabled={true}
        cleanupModel="gpt-5.6-terra"
        cleanupManagedByCloud={false}
        latestCleanup={null}
        preferBuiltInMic={true}
        selectedMicDeviceId=""
        onPreferBuiltInChange={vi.fn()}
        onDeviceSelect={vi.fn()}
        onOpenHotkeySettings={onOpenSettings}
        onOpenMicrophoneSettings={vi.fn()}
        onOpenCleanupSettings={vi.fn()}
      />
    );

    expect(screen.getByText("Insert in active app")).toBeInTheDocument();
    expect(screen.getByText("Copy to clipboard")).toBeInTheDocument();
    expect(screen.getByText(/GPT-5.6 Terra/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("surfaces a safely skipped cleanup without calling the dictation an error", () => {
    render(
      <DictationQuickStart
        insertHotkey="F10"
        clipboardHotkey="Control+Alt"
        activationMode="tap"
        cleanupEnabled={true}
        cleanupModel="gpt-5.6-terra"
        cleanupManagedByCloud={false}
        latestCleanup={{ status: "fallback", fallbackReason: "provider_error" }}
        preferBuiltInMic={true}
        selectedMicDeviceId=""
        onPreferBuiltInChange={vi.fn()}
        onDeviceSelect={vi.fn()}
        onOpenHotkeySettings={vi.fn()}
        onOpenMicrophoneSettings={vi.fn()}
        onOpenCleanupSettings={vi.fn()}
      />
    );

    expect(screen.getByText("Last cleanup was unavailable · original kept")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Configure AI cleanup. Last cleanup was unavailable · original kept",
      })
    ).toBeInTheDocument();
  });
});
