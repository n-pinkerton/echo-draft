import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CustomEndpointPanel } from "./CustomEndpointPanel";

vi.mock("../ui/ModelCardList", () => ({
  default: () => <div data-testid="model-list" />,
}));

const createEndpoint = (overrides: Record<string, unknown> = {}) => ({
  customBaseInput: "http://remote.example/v1",
  handleCustomBaseInputChange: vi.fn(),
  customModelOptions: [],
  displayedCustomModels: [],
  customModelsLoading: false,
  customModelsError: "Enter a valid HTTPS endpoint.",
  defaultOpenAIBase: "https://api.openai.com/v1",
  effectiveReasoningBase: "https://api.openai.com/v1",
  hasCustomBase: false,
  hasSavedCustomBase: false,
  isCustomBaseDirty: true,
  trimmedCustomBase: "http://remote.example/v1",
  handleBaseUrlBlur: vi.fn(),
  handleResetCustomBase: vi.fn(),
  handleRefreshCustomModels: vi.fn(),
  ...overrides,
});

describe("CustomEndpointPanel", () => {
  it("keeps a rejected endpoint editable and exposes its validation message", () => {
    const endpoint = createEndpoint();
    render(
      <CustomEndpointPanel
        endpoint={endpoint as any}
        customReasoningApiKey=""
        setCustomReasoningApiKey={vi.fn()}
        reasoningModel=""
        onModelSelect={vi.fn()}
      />
    );

    const input = screen.getByRole("textbox", { name: "Endpoint URL" });
    expect(input).toHaveValue("http://remote.example/v1");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Enter a valid HTTPS endpoint.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", alert.id);
    const apiKeyInput = screen.getByLabelText("API Key (Optional)");
    expect(apiKeyInput).toHaveAttribute("type", "password");
    expect(apiKeyInput).toHaveAccessibleDescription(/separate from your OpenAI API key/i);

    fireEvent.change(input, { target: { value: "https://remote.example/v1" } });
    expect(endpoint.handleCustomBaseInputChange).toHaveBeenCalledWith("https://remote.example/v1");
  });
});
