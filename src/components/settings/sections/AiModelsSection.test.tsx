import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AiModelsSection, { type AiModelsSectionProps } from "./AiModelsSection";

vi.mock("../../ReasoningModelSelector", () => ({
  default: () => <div data-testid="reasoning-model-selector" />,
}));

const createProps = (overrides: Partial<AiModelsSectionProps> = {}): AiModelsSectionProps => ({
  isSignedIn: false,
  cloudReasoningMode: "byok",
  setCloudReasoningMode: vi.fn(),
  useReasoningModel: true,
  setUseReasoningModel: vi.fn(),
  reasoningModel: "gpt-5.6-luna",
  setReasoningModel: vi.fn(),
  reasoningProvider: "openai",
  setReasoningProvider: vi.fn(),
  cleanupReasoningEffort: "none",
  setCleanupReasoningEffort: vi.fn(),
  cloudReasoningBaseUrl: "https://api.openai.com/v1",
  setCloudReasoningBaseUrl: vi.fn(),
  openaiApiKey: "",
  setOpenaiApiKey: vi.fn(),
  anthropicApiKey: "",
  setAnthropicApiKey: vi.fn(),
  geminiApiKey: "",
  setGeminiApiKey: vi.fn(),
  groqApiKey: "",
  setGroqApiKey: vi.fn(),
  customReasoningApiKey: "",
  setCustomReasoningApiKey: vi.fn(),
  showAlertDialog: vi.fn(),
  toast: vi.fn(),
  ...overrides,
});

describe("AiModelsSection cleanup reasoning", () => {
  it("labels and describes the text-cleanup switch", () => {
    render(<AiModelsSection {...createProps()} />);

    const toggle = screen.getByRole("switch", { name: "Enable text cleanup" });
    expect(toggle).toHaveAttribute("id", "enable-text-cleanup");
    expect(toggle).toHaveAccessibleDescription("AI improves transcription quality");
  });

  it("shows the Luna effort selector and reports a changed choice", () => {
    const props = createProps();
    render(<AiModelsSection {...props} />);

    const selector = screen.getByRole("combobox", { name: "Cleanup reasoning effort" });
    expect(selector).toHaveValue("none");
    expect(screen.getByRole("option", { name: "Low — more reasoning" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "None — recommended for Luna" })).toBeInTheDocument();
    expect(screen.getByText(/None is recommended for Luna/)).toBeInTheDocument();
    expect(selector).toHaveAccessibleDescription(/same usable output quality/i);
    expect(selector).toHaveAccessibleDescription(/second request.*latency.*BYOK API usage/i);

    fireEvent.change(selector, { target: { value: "medium" } });

    expect(props.setCleanupReasoningEffort).toHaveBeenCalledWith("medium");
  });

  it("hides the selector for providers that do not support OpenAI reasoning controls", () => {
    render(<AiModelsSection {...createProps({ reasoningProvider: "anthropic" })} />);

    expect(
      screen.queryByRole("combobox", { name: "Cleanup reasoning effort" })
    ).not.toBeInTheDocument();
  });

  it("does not present the Luna-specific recommendation for another GPT-5 model", () => {
    render(<AiModelsSection {...createProps({ reasoningModel: "gpt-5.6-terra" })} />);

    expect(screen.getByRole("option", { name: "None — fastest" })).toBeInTheDocument();
    expect(screen.queryByText(/None is recommended for Luna/)).not.toBeInTheDocument();
  });
});
