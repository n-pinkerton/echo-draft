import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMicrophoneSettings } from "../../hooks/settings/useMicrophoneSettings";
import QuickMicrophoneSelect from "../controlPanel/QuickMicrophoneSelect";
import MicrophoneSettings from "./MicrophoneSettings";

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
const mediaDevices = {
  enumerateDevices: vi.fn(),
  getUserMedia: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

function MicrophoneSyncHarness() {
  const quickSettings = useMicrophoneSettings();
  const preferenceSettings = useMicrophoneSettings();

  return (
    <>
      <QuickMicrophoneSelect
        preferBuiltInMic={quickSettings.preferBuiltInMic}
        selectedMicDeviceId={quickSettings.selectedMicDeviceId}
        onPreferBuiltInChange={quickSettings.setPreferBuiltInMic}
        onDeviceSelect={quickSettings.setSelectedMicDeviceId}
      />
      <MicrophoneSettings
        preferBuiltInMic={preferenceSettings.preferBuiltInMic}
        selectedMicDeviceId={preferenceSettings.selectedMicDeviceId}
        onPreferBuiltInChange={preferenceSettings.setPreferBuiltInMic}
        onDeviceSelect={preferenceSettings.setSelectedMicDeviceId}
      />
    </>
  );
}

describe("MicrophoneSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    mediaDevices.enumerateDevices.mockResolvedValue([
      { kind: "audioinput", deviceId: "default", label: "Default - USB microphone" },
      { kind: "audioinput", deviceId: "usb-mic", label: "USB Condenser Microphone" },
    ]);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: mediaDevices,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.values(mediaDevices).forEach((mock) => mock.mockReset());
    if (originalMediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    } else {
      Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });

  it("preserves Windows default without auto-selecting or requesting permission", async () => {
    const selectDevice = vi.fn();
    render(
      <MicrophoneSettings
        preferBuiltInMic={false}
        selectedMicDeviceId=""
        onPreferBuiltInChange={vi.fn()}
        onDeviceSelect={selectDevice}
      />
    );

    const select = await screen.findByRole("combobox", { name: "Input device" });
    expect(select).toHaveTextContent("System Default");
    await waitFor(() => expect(mediaDevices.enumerateDevices).toHaveBeenCalled());
    expect(selectDevice).not.toHaveBeenCalled();
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("keeps the quick selector and Preferences synchronized", async () => {
    render(<MicrophoneSyncHarness />);
    const quickSelect = screen.getByRole("combobox", { name: "Microphone used for dictation" });
    await screen.findByRole("option", { name: "USB Condenser Microphone" });

    fireEvent.change(quickSelect, { target: { value: "__system_default__" } });
    const preferenceSelect = await screen.findByRole("combobox", { name: "Input device" });
    expect(preferenceSelect).toHaveTextContent("System Default");

    fireEvent.change(quickSelect, { target: { value: "usb-mic" } });
    await waitFor(() => expect(preferenceSelect).toHaveTextContent("USB Condenser Microphone"));
    expect(localStorage.getItem("preferBuiltInMic")).toBe("false");
    expect(localStorage.getItem("selectedMicDeviceId")).toBe("usb-mic");
  });

  it("does not claim an unlabeled input is not built-in", async () => {
    mediaDevices.enumerateDevices.mockResolvedValue([
      { kind: "audioinput", deviceId: "unknown-mic", label: "" },
    ]);

    render(
      <MicrophoneSettings
        preferBuiltInMic={true}
        selectedMicDeviceId=""
        onPreferBuiltInChange={vi.fn()}
        onDeviceSelect={vi.fn()}
      />
    );

    expect(await screen.findByRole("button", { name: "Show device names" })).toBeInTheDocument();
    expect(
      screen.queryByText("No built-in microphone detected. Using system default.")
    ).not.toBeInTheDocument();
  });

  it("shows an announced retry action when Automatic device discovery fails", async () => {
    mediaDevices.enumerateDevices.mockRejectedValue(new Error("device service unavailable"));

    render(
      <MicrophoneSettings
        preferBuiltInMic={true}
        selectedMicDeviceId=""
        onPreferBuiltInChange={vi.fn()}
        onDeviceSelect={vi.fn()}
      />
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Unable to list microphones. Check Windows microphone permissions."
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("explains temporary fallback and lets the user switch permanently to the default", async () => {
    mediaDevices.enumerateDevices.mockResolvedValue([
      { kind: "audioinput", deviceId: "built-in", label: "Built-in microphone" },
    ]);
    const onDeviceSelect = vi.fn();

    render(
      <MicrophoneSettings
        preferBuiltInMic={false}
        selectedMicDeviceId="missing-usb"
        onPreferBuiltInChange={vi.fn()}
        onDeviceSelect={onDeviceSelect}
      />
    );

    expect(await screen.findByText("Selected microphone disconnected")).toBeInTheDocument();
    expect(screen.getByText(/temporarily using System Default/i)).toBeInTheDocument();
    expect(screen.getByText(/saved microphone will be tried again/i)).toBeInTheDocument();
    expect(screen.getByText(/Testing System Default because/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch to Windows default" }));
    expect(onDeviceSelect).toHaveBeenCalledWith("");
  });
});
