import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";

vi.mock("../../utils/hotkeys", () => ({
  getDefaultHotkey: () => "DEFAULT-HOTKEY",
}));

import {
  shouldAutoRegisterHotkey,
  useAutoRegisterDefaultHotkey,
} from "./useAutoRegisterDefaultHotkey";

function TestComponent({
  currentStep,
  activationStepIndex,
  initialHotkey,
  registerHotkey,
}: {
  currentStep: number;
  activationStepIndex: number;
  initialHotkey: string;
  registerHotkey: (hotkey: string) => Promise<boolean>;
}) {
  const [hotkey, setHotkey] = useState(initialHotkey);
  useAutoRegisterDefaultHotkey({
    currentStep,
    activationStepIndex,
    hotkey,
    registerHotkey,
    setHotkey,
  });
  return <div>{hotkey}</div>;
}

describe("useAutoRegisterDefaultHotkey", () => {
  it("shouldAutoRegisterHotkey respects platform and placeholder hotkeys", () => {
    expect(shouldAutoRegisterHotkey({ hotkey: "", platform: "darwin" })).toBe(true);
    expect(shouldAutoRegisterHotkey({ hotkey: "CTRL+K", platform: "darwin" })).toBe(false);
    expect(shouldAutoRegisterHotkey({ hotkey: "GLOBE", platform: "darwin" })).toBe(false);
    expect(shouldAutoRegisterHotkey({ hotkey: "GLOBE", platform: "win32" })).toBe(true);
  });

  it("auto-registers when entering activation step and hotkey is empty", async () => {
    const registerHotkey = vi.fn(async () => true);
    (window as any).electronAPI = { getPlatform: () => "win32" };

    const { rerender } = render(
      <TestComponent
        currentStep={0}
        activationStepIndex={2}
        initialHotkey=""
        registerHotkey={registerHotkey}
      />
    );

    expect(registerHotkey).not.toHaveBeenCalled();

    rerender(
      <TestComponent
        currentStep={2}
        activationStepIndex={2}
        initialHotkey=""
        registerHotkey={registerHotkey}
      />
    );

    await waitFor(() => expect(registerHotkey).toHaveBeenCalledWith("DEFAULT-HOTKEY"));
    await waitFor(() => expect(screen.getByText("DEFAULT-HOTKEY")).toBeInTheDocument());
  });

  it("does not auto-register when hotkey is already set", async () => {
    const registerHotkey = vi.fn(async () => true);
    (window as any).electronAPI = { getPlatform: () => "darwin" };

    render(
      <TestComponent
        currentStep={2}
        activationStepIndex={2}
        initialHotkey="CTRL+K"
        registerHotkey={registerHotkey}
      />
    );

    await waitFor(() => expect(screen.getByText("CTRL+K")).toBeInTheDocument());
    expect(registerHotkey).not.toHaveBeenCalled();
  });
});

