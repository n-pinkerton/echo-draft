import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MicrophoneLevelTest from "./MicrophoneLevelTest";

describe("MicrophoneLevelTest", () => {
  const originalMediaDevices = navigator.mediaDevices;
  const originalAudioContext = window.AudioContext;
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  let frameCallbacks: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let endedHandler: (() => void) | null;
  let trackStop: ReturnType<typeof vi.fn>;
  let contextClose: ReturnType<typeof vi.fn>;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let sampleValue: number;

  beforeEach(() => {
    frameCallbacks = new Map();
    nextFrameId = 0;
    endedHandler = null;
    trackStop = vi.fn();
    contextClose = vi.fn(async () => {});
    sampleValue = 0.1;

    const track = {
      label: "USB Cond. Mic external",
      stop: trackStop,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === "ended") endedHandler = handler;
      }),
    };
    const stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    };
    getUserMedia = vi.fn(async () => stream);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });

    class MockAudioContext {
      state = "running";
      createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
      createAnalyser = vi.fn(() => ({
        fftSize: 512,
        smoothingTimeConstant: 0,
        disconnect: vi.fn(),
        getFloatTimeDomainData: (samples: Float32Array) => samples.fill(sampleValue),
      }));
      close = contextClose;
    }
    Object.defineProperty(window, "AudioContext", {
      value: MockAudioContext,
      configurable: true,
    });
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      nextFrameId += 1;
      frameCallbacks.set(nextFrameId, callback);
      return nextFrameId;
    });
    window.cancelAnimationFrame = vi.fn((frameId: number) => {
      frameCallbacks.delete(frameId);
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: originalMediaDevices,
      configurable: true,
    });
    Object.defineProperty(window, "AudioContext", {
      value: originalAudioContext,
      configurable: true,
    });
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    vi.restoreAllMocks();
  });

  it("tests only on demand, shows a live level, and releases every audio resource", async () => {
    render(<MicrophoneLevelTest deviceId="usb-device" deviceLabel="USB Cond. Mic external" />);
    expect(getUserMedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start microphone test" }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ deviceId: { exact: "usb-device" } }),
    });
    await screen.findByText("USB Cond. Mic external");

    const frame = [...frameCallbacks.values()][0];
    act(() => frame?.(performance.now()));

    expect(screen.getByText("Good signal")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Live microphone input level" })
    ).toHaveAttribute("aria-valuenow", "45");

    fireEvent.click(screen.getByRole("button", { name: "Stop microphone test" }));
    expect(trackStop).toHaveBeenCalled();
    expect(contextClose).toHaveBeenCalled();
    expect(screen.getByText(/Last result: Good signal/i)).toBeInTheDocument();
  });

  it("reports a device disconnect instead of silently losing the signal", async () => {
    render(<MicrophoneLevelTest deviceLabel="System Default" />);
    fireEvent.click(screen.getByRole("button", { name: "Start microphone test" }));
    await waitFor(() => expect(endedHandler).toBeTypeOf("function"));

    act(() => endedHandler?.());

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The microphone disconnected during the test."
    );
    expect(trackStop).toHaveBeenCalled();
  });

  it("keeps the strongest observed result when speech ends before the test", async () => {
    render(<MicrophoneLevelTest deviceLabel="System Default" />);
    fireEvent.click(screen.getByRole("button", { name: "Start microphone test" }));
    await waitFor(() => expect(frameCallbacks.size).toBeGreaterThan(0));

    const speechFrame = [...frameCallbacks.values()][0];
    act(() => speechFrame?.(performance.now()));
    expect(screen.getByText("Good signal")).toBeInTheDocument();

    sampleValue = 0;
    const silenceFrame = [...frameCallbacks.values()].at(-1);
    act(() => silenceFrame?.(performance.now()));
    expect(screen.getByText(/No signal yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop microphone test" }));
    expect(screen.getByText("Last result: Good signal")).toBeInTheDocument();
  });

  it("releases the stream and context when audio graph setup fails", async () => {
    class ThrowingAudioContext {
      state = "running";
      createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
      createAnalyser = vi.fn(() => {
        throw new Error("Audio graph unavailable");
      });
      close = contextClose;
    }
    Object.defineProperty(window, "AudioContext", {
      value: ThrowingAudioContext,
      configurable: true,
    });

    render(<MicrophoneLevelTest deviceLabel="System Default" />);
    fireEvent.click(screen.getByRole("button", { name: "Start microphone test" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Audio graph unavailable");
    expect(trackStop).toHaveBeenCalledOnce();
    expect(contextClose).toHaveBeenCalledOnce();
  });
});
