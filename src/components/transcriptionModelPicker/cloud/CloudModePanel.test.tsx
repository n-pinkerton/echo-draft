import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import CloudModePanel from "./CloudModePanel";
import { MODEL_PICKER_COLORS } from "../../../utils/modelPickerStyles";

vi.mock("../../ui/ProviderTabs", () => ({
  ProviderTabs: () => <div data-testid="ProviderTabs" />,
}));

vi.mock("../../ui/ModelCardList", () => ({
  default: () => <div data-testid="ModelCardList" />,
}));

describe("CloudModePanel", () => {
  const baseProps = {
    styles: MODEL_PICKER_COLORS.purple,
    tabColorScheme: "purple" as const,
    selectedCloudProvider: "openai",
    selectedCloudModel: "whisper-1",
    onCloudProviderChange: vi.fn(),
    onCloudModelSelect: vi.fn(),
    cloudModelOptions: [{ value: "whisper-1", label: "Whisper" }],
    cloudTranscriptionBaseUrl: "https://api.openai.com/v1",
    setCloudTranscriptionBaseUrl: vi.fn(),
    onBaseUrlBlur: vi.fn(),
    openaiApiKey: "sk-test",
    setOpenaiApiKey: vi.fn(),
    groqApiKey: "",
    setGroqApiKey: vi.fn(),
    mistralApiKey: "",
    setMistralApiKey: vi.fn(),
    customTranscriptionApiKey: "",
    setCustomTranscriptionApiKey: vi.fn(),
  };

  it("renders managed provider API key + model selection", () => {
    render(<CloudModePanel {...baseProps} />);

    expect(screen.getByText("API Key")).toBeInTheDocument();
    expect(screen.getByText("Get key →")).toBeInTheDocument();
    expect(screen.getByTestId("ProviderTabs")).toBeInTheDocument();
    expect(screen.getByTestId("ModelCardList")).toBeInTheDocument();
    expect(screen.queryByText("Endpoint URL")).not.toBeInTheDocument();
  });

  it("renders custom endpoint inputs when provider is custom", () => {
    render(
      <CloudModePanel
        {...baseProps}
        selectedCloudProvider="custom"
        cloudTranscriptionBaseUrl="https://example.com/v1"
      />
    );

    expect(screen.getByText("Endpoint URL")).toBeInTheDocument();
    expect(screen.getByText("API Key (Optional)")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.queryByText("Get key →")).not.toBeInTheDocument();
  });
});

