import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import MicrophoneSection from "./MicrophoneSection";

const useSettingsMock = vi.fn();

vi.mock("../../../../hooks/useSettings", () => ({
  useSettings: () => useSettingsMock(),
}));

vi.mock("../../../ui/MicrophoneSettings", () => ({
  default: () => <div>MicrophoneSettings</div>,
}));

describe("MicrophoneSection", () => {
  beforeEach(() => {
    useSettingsMock.mockReturnValue({
      preferBuiltInMic: false,
      selectedMicDeviceId: null,
      setPreferBuiltInMic: vi.fn(),
      setSelectedMicDeviceId: vi.fn(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders microphone settings panel", () => {
    render(<MicrophoneSection />);
    expect(screen.getByText("Microphone")).toBeInTheDocument();
    expect(screen.getByText("MicrophoneSettings")).toBeInTheDocument();
  });
});

