import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import QuickMicrophoneSelect from "./QuickMicrophoneSelect";

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
const mediaDevices = {
  enumerateDevices: vi.fn(),
  getUserMedia: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

function installMediaDevices() {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: mediaDevices,
  });
}

describe("QuickMicrophoneSelect", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.values(mediaDevices).forEach((mock) => mock.mockReset());
    if (originalMediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    } else {
      Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });

  it("lists detected microphones without requesting capture permission", async () => {
    mediaDevices.enumerateDevices.mockResolvedValue([
      { kind: "audioinput", deviceId: "usb-mic", label: "USB Condenser Microphone" },
      { kind: "audiooutput", deviceId: "speaker", label: "Speakers" },
    ]);
    installMediaDevices();

    render(
      <QuickMicrophoneSelect
        preferBuiltInMic={true}
        selectedMicDeviceId=""
        onPreferBuiltInChange={vi.fn()}
        onDeviceSelect={vi.fn()}
      />
    );

    expect(
      await screen.findByRole("option", { name: "USB Condenser Microphone" })
    ).toBeInTheDocument();
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Microphone used for dictation" })).toHaveValue(
      "__automatic_builtin__"
    );
  });

  it("switches between a specific device and the Windows default", async () => {
    mediaDevices.enumerateDevices.mockResolvedValue([
      { kind: "audioinput", deviceId: "usb-mic", label: "USB Condenser Microphone" },
    ]);
    installMediaDevices();
    const setPreferBuiltIn = vi.fn();
    const selectDevice = vi.fn();

    render(
      <QuickMicrophoneSelect
        preferBuiltInMic={false}
        selectedMicDeviceId=""
        onPreferBuiltInChange={setPreferBuiltIn}
        onDeviceSelect={selectDevice}
      />
    );

    const select = screen.getByRole("combobox", { name: "Microphone used for dictation" });
    await screen.findByRole("option", { name: "USB Condenser Microphone" });
    fireEvent.change(select, { target: { value: "usb-mic" } });
    expect(setPreferBuiltIn).toHaveBeenLastCalledWith(false);
    expect(selectDevice).toHaveBeenLastCalledWith("usb-mic");

    fireEvent.change(select, { target: { value: "__system_default__" } });
    expect(setPreferBuiltIn).toHaveBeenLastCalledWith(false);
    expect(selectDevice).toHaveBeenLastCalledWith("");
  });

  it("keeps an unplugged selection visible after device discovery finishes", async () => {
    mediaDevices.enumerateDevices.mockResolvedValue([
      {
        kind: "audioinput",
        deviceId: "default",
        label: "Default - USB Cond. Mic external",
      },
    ]);
    installMediaDevices();
    const selectDevice = vi.fn();
    const openSettings = vi.fn();

    render(
      <QuickMicrophoneSelect
        preferBuiltInMic={false}
        selectedMicDeviceId="missing-device"
        onPreferBuiltInChange={vi.fn()}
        onDeviceSelect={selectDevice}
        onOpenMicrophoneSettings={openSettings}
      />
    );

    expect(
      screen.getByRole("option", { name: "Checking selected microphone…" })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("option", { name: "Previously selected microphone (unavailable)" })
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "temporarily using USB Cond. Mic external"
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your saved microphone will be tried again"
    );
    fireEvent.click(screen.getByRole("button", { name: "Switch to Windows default" }));
    expect(selectDevice).toHaveBeenCalledWith("");
    fireEvent.click(screen.getByRole("button", { name: "Mic settings" }));
    expect(openSettings).toHaveBeenCalledOnce();
  });

  it("surfaces fallback as soon as a selected microphone disconnects", async () => {
    let deviceChange: () => void = () => {};
    mediaDevices.enumerateDevices
      .mockResolvedValueOnce([
        { kind: "audioinput", deviceId: "usb-mic", label: "USB Condenser Microphone" },
      ])
      .mockResolvedValueOnce([
        { kind: "audioinput", deviceId: "default", label: "Default - Laptop Microphone" },
      ]);
    mediaDevices.addEventListener.mockImplementation((_event, listener) => {
      deviceChange = listener;
    });
    installMediaDevices();

    render(
      <QuickMicrophoneSelect
        preferBuiltInMic={false}
        selectedMicDeviceId="usb-mic"
        onPreferBuiltInChange={vi.fn()}
        onDeviceSelect={vi.fn()}
      />
    );
    await screen.findByRole("option", { name: "USB Condenser Microphone" });
    expect(screen.queryByText("Selected microphone disconnected")).not.toBeInTheDocument();

    act(() => deviceChange());

    expect(await screen.findByText("Selected microphone disconnected")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Laptop Microphone");
  });

  it("stops saying a saved device is being checked after discovery fails", async () => {
    mediaDevices.enumerateDevices.mockRejectedValue(new Error("device service unavailable"));
    installMediaDevices();

    render(
      <QuickMicrophoneSelect
        preferBuiltInMic={false}
        selectedMicDeviceId="missing-device"
        onPreferBuiltInChange={vi.fn()}
        onDeviceSelect={vi.fn()}
      />
    );

    expect(
      await screen.findByRole("option", { name: "Could not verify selected microphone" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Checking selected microphone…" })
    ).not.toBeInTheDocument();
  });

  it("filters pseudo, blank, and duplicate device IDs", async () => {
    mediaDevices.enumerateDevices.mockResolvedValue([
      { kind: "audioinput", deviceId: "default", label: "Default microphone" },
      { kind: "audioinput", deviceId: "communications", label: "Communications microphone" },
      { kind: "audioinput", deviceId: "", label: "" },
      { kind: "audioinput", deviceId: "usb-mic", label: "USB Condenser Microphone" },
      { kind: "audioinput", deviceId: "usb-mic", label: "Duplicate USB microphone" },
    ]);
    installMediaDevices();

    render(
      <QuickMicrophoneSelect
        preferBuiltInMic={true}
        selectedMicDeviceId=""
        onPreferBuiltInChange={vi.fn()}
        onDeviceSelect={vi.fn()}
      />
    );

    await screen.findByRole("option", { name: "USB Condenser Microphone" });
    expect(screen.queryByRole("option", { name: "Default microphone" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Duplicate USB microphone" })
    ).not.toBeInTheDocument();
  });

  it("requests microphone access only after the user asks to show device names", async () => {
    const stop = vi.fn();
    mediaDevices.enumerateDevices
      .mockResolvedValueOnce([{ kind: "audioinput", deviceId: "usb-mic", label: "" }])
      .mockResolvedValueOnce([
        { kind: "audioinput", deviceId: "usb-mic", label: "USB Condenser Microphone" },
      ]);
    mediaDevices.getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] });
    installMediaDevices();

    render(
      <QuickMicrophoneSelect
        preferBuiltInMic={true}
        selectedMicDeviceId=""
        onPreferBuiltInChange={vi.fn()}
        onDeviceSelect={vi.fn()}
      />
    );

    const revealButton = await screen.findByRole("button", { name: "Show device names" });
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(revealButton);

    expect(
      await screen.findByRole("option", { name: "USB Condenser Microphone" })
    ).toBeInTheDocument();
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("keeps the newest device list when overlapping refreshes finish out of order", async () => {
    let resolveFirst: (devices: unknown[]) => void = () => {};
    let resolveSecond: (devices: unknown[]) => void = () => {};
    let deviceChange: () => void = () => {};
    mediaDevices.enumerateDevices
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve as (devices: unknown[]) => void))
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveSecond = resolve as (devices: unknown[]) => void))
      );
    mediaDevices.addEventListener.mockImplementation((_event, listener) => {
      deviceChange = listener;
    });
    installMediaDevices();

    render(
      <QuickMicrophoneSelect
        preferBuiltInMic={true}
        selectedMicDeviceId=""
        onPreferBuiltInChange={vi.fn()}
        onDeviceSelect={vi.fn()}
      />
    );
    await waitFor(() => expect(mediaDevices.addEventListener).toHaveBeenCalled());
    act(() => deviceChange());
    act(() =>
      resolveSecond([{ kind: "audioinput", deviceId: "new-mic", label: "New microphone" }])
    );
    await screen.findByRole("option", { name: "New microphone" });
    act(() => resolveFirst([{ kind: "audioinput", deviceId: "old-mic", label: "Old microphone" }]));

    await waitFor(() =>
      expect(screen.queryByRole("option", { name: "Old microphone" })).not.toBeInTheDocument()
    );
    expect(screen.getByRole("option", { name: "New microphone" })).toBeInTheDocument();
  });
});
