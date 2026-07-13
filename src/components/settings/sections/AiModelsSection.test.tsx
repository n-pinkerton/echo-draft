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
  cleanupReasoningEffort: "low",
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
  it("shows the Luna effort selector and reports a changed choice", () => {
    const props = createProps();
    render(<AiModelsSection {...props} />);

    const selector = screen.getByRole("combobox", { name: "Cleanup reasoning effort" });
    expect(selector).toHaveValue("low");
    expect(screen.getByRole("option", { name: "Low — recommended" })).toBeInTheDocument();

    fireEvent.change(selector, { target: { value: "medium" } });

    expect(props.setCleanupReasoningEffort).toHaveBeenCalledWith("medium");
  });

  it("hides the selector for providers that do not support OpenAI reasoning controls", () => {
    render(<AiModelsSection {...createProps({ reasoningProvider: "anthropic" })} />);

    expect(
      screen.queryByRole("combobox", { name: "Cleanup reasoning effort" })
    ).not.toBeInTheDocument();
  });
});
