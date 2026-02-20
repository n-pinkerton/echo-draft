import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import HotkeysSection from "./HotkeysSection";

const useSettingsMock = vi.fn();
const useHotkeyRegistrationMock = vi.fn();

vi.mock("../../../../hooks/useSettings", () => ({
  useSettings: () => useSettingsMock(),
}));

vi.mock("../../../../hooks/useHotkeyRegistration", () => ({
  useHotkeyRegistration: (opts: any) => useHotkeyRegistrationMock(opts),
}));

vi.mock("../../../ui/HotkeyInput", () => ({
  HotkeyInput: (props: any) => (
    <button
      type="button"
      data-testid={`hotkey-${props.captureTarget}`}
      onClick={() => props.onChange(`${props.captureTarget}-hotkey`)}
    >
      {props.value}
    </button>
  ),
}));

describe("HotkeysSection", () => {
  beforeEach(() => {
    useSettingsMock.mockReturnValue({
      dictationKey: "CTRL+ALT+D",
      dictationKeyClipboard: "CTRL+ALT+C",
      activationMode: "tap",
      setActivationMode: vi.fn(),
      setDictationKey: vi.fn(),
      setDictationKeyClipboard: vi.fn(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("routes insert/clipboard hotkeys to separate registrations", async () => {
    const insertRegisterHotkey = vi.fn(async () => ({ success: true }));
    const clipboardRegisterHotkey = vi.fn(async () => ({ success: true }));
    let call = 0;
    useHotkeyRegistrationMock.mockImplementation(() => {
      call += 1;
      return call === 1
        ? { registerHotkey: insertRegisterHotkey, isRegistering: false }
        : { registerHotkey: clipboardRegisterHotkey, isRegistering: false };
    });

    const user = userEvent.setup();
    render(<HotkeysSection showAlertDialog={vi.fn()} />);

    await user.click(screen.getByTestId("hotkey-insert"));
    expect(insertRegisterHotkey).toHaveBeenCalledWith("insert-hotkey");

    await user.click(screen.getByTestId("hotkey-clipboard"));
    expect(clipboardRegisterHotkey).toHaveBeenCalledWith("clipboard-hotkey");
  });
});

