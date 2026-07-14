import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HotkeyInput } from "../HotkeyInput";

describe("useHotkeyCapture lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (window as any).electronAPI;
  });

  it("persists the candidate before blur releases main-process capture mode", async () => {
    let resolveRegistration!: () => void;
    const registration = new Promise<void>((resolve) => {
      resolveRegistration = resolve;
    });
    const onChange = vi.fn(() => registration);
    const setHotkeyListeningMode = vi.fn(async () => ({ success: true }));
    (window as any).electronAPI = {
      getPlatform: () => "win32",
      setHotkeyListeningMode,
    };

    const { getByRole } = render(<HotkeyInput value="F10" onChange={onChange} />);
    const input = getByRole("button", { name: /set hotkey/i });

    act(() => input.focus());
    fireEvent.keyDown(input, { key: "F11", code: "F11" });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith("F11");
    expect(setHotkeyListeningMode).toHaveBeenCalledTimes(1);
    expect(setHotkeyListeningMode).toHaveBeenLastCalledWith(true, null, "insert");

    await act(async () => resolveRegistration());
    await waitFor(() => {
      expect(setHotkeyListeningMode).toHaveBeenLastCalledWith(false, "F11", "insert");
    });
  });

  it("releases capture after a bounded deadline when registration never settles", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn(() => new Promise<void>(() => {}));
    const setHotkeyListeningMode = vi.fn(async () => ({ success: true }));
    (window as any).electronAPI = {
      getPlatform: () => "win32",
      setHotkeyListeningMode,
    };

    const { getByRole } = render(<HotkeyInput value="F10" onChange={onChange} />);
    const input = getByRole("button", { name: /set hotkey/i });

    act(() => input.focus());
    fireEvent.keyDown(input, { key: "F11", code: "F11" });
    expect(setHotkeyListeningMode).toHaveBeenLastCalledWith(true, null, "insert");

    await act(async () => vi.advanceTimersByTimeAsync(3001));

    expect(setHotkeyListeningMode).toHaveBeenLastCalledWith(false, "F11", "insert");
  });
});
