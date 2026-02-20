import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import LocalModePanel from "./LocalModePanel";
import { MODEL_PICKER_COLORS } from "../../../utils/modelPickerStyles";

vi.mock("../../ui/ProviderTabs", () => ({
  ProviderTabs: () => <div data-testid="ProviderTabs" />,
}));

vi.mock("../LocalModelCard", () => ({
  LocalModelCard: (props: any) => (
    <div>
      <span>{props.name}</span>
    </div>
  ),
}));

describe("LocalModePanel", () => {
  const baseProps = {
    styles: MODEL_PICKER_COLORS.purple,
    tabColorScheme: "purple" as const,
    internalLocalProvider: "whisper",
    onLocalProviderChange: vi.fn(),
    useLocalWhisper: true,
    selectedLocalModel: "base",
    localModels: [{ model: "base", downloaded: true, size_mb: 142 }],
    parakeetModels: [{ model: "parakeet-tdt-0.6b-v3", downloaded: true, size_mb: 900 }],
    downloadingModel: "base",
    downloadProgress: { percentage: 25, downloadedBytes: 1, totalBytes: 4, speed: 1.2, eta: 3 },
    isInstalling: false,
    downloadingParakeetModel: null,
    parakeetDownloadProgress: { percentage: 0, downloadedBytes: 0, totalBytes: 0 },
    isInstallingParakeet: false,
    isDownloadingModel: vi.fn(() => false),
    isCancelling: false,
    downloadModel: vi.fn(async () => {}),
    cancelDownload: vi.fn(),
    isDownloadingParakeetModel: vi.fn(() => false),
    isCancellingParakeet: false,
    downloadParakeetModel: vi.fn(async () => {}),
    cancelParakeetDownload: vi.fn(),
    onWhisperModelSelect: vi.fn(),
    onWhisperModelDelete: vi.fn(),
    onParakeetModelSelect: vi.fn(),
    onParakeetModelDelete: vi.fn(),
  };

  it("renders whisper models by default", () => {
    render(<LocalModePanel {...baseProps} />);

    expect(screen.getByTestId("ProviderTabs")).toBeInTheDocument();
    expect(screen.getByText("Base")).toBeInTheDocument();
    expect(screen.getByText("Downloading Base")).toBeInTheDocument();
  });

  it("renders parakeet models when NVIDIA provider is selected", () => {
    render(<LocalModePanel {...baseProps} internalLocalProvider="nvidia" downloadingModel={null} />);
    expect(screen.getByText("Parakeet TDT 0.6B")).toBeInTheDocument();
  });
});

