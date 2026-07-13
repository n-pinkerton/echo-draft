import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ModelCardList from "./ModelCardList";
import { ProviderTabs } from "./ProviderTabs";

describe("model picker accessibility", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("exposes radio selection and supports Enter, Space, and arrow navigation", () => {
    const onSelect = vi.fn();
    render(
      <ModelCardList
        models={[
          { value: "alpha", label: "Alpha" },
          { value: "beta", label: "Beta" },
        ]}
        selectedModel="alpha"
        onModelSelect={onSelect}
      />
    );

    const alpha = screen.getByRole("radio", { name: "Alpha" });
    const beta = screen.getByRole("radio", { name: "Beta" });
    expect(screen.getByRole("radiogroup", { name: "Models" })).toBeInTheDocument();
    expect(alpha).toHaveAttribute("aria-checked", "true");
    expect(beta).toHaveAttribute("aria-checked", "false");
    expect(alpha).toHaveAccessibleDescription("Selected model.");
    expect(beta).toHaveAccessibleDescription("Available model.");

    beta.focus();
    fireEvent.keyDown(beta, { key: "Enter" });
    fireEvent.keyDown(beta, { key: " " });
    expect(onSelect).toHaveBeenNthCalledWith(1, "beta");
    expect(onSelect).toHaveBeenNthCalledWith(2, "beta");

    alpha.focus();
    fireEvent.keyDown(alpha, { key: "ArrowRight" });
    expect(document.activeElement).toBe(beta);
    expect(onSelect).toHaveBeenLastCalledWith("beta");
  });

  it("keeps local model actions outside the radio control", () => {
    render(
      <ModelCardList
        models={[{ value: "local", label: "Local", isDownloaded: true }]}
        selectedModel="local"
        onModelSelect={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const deleteButton = screen.getByRole("button", { name: "Delete Local" });
    expect(deleteButton.closest('[role="radio"]')).toBeNull();
    expect(deleteButton).toHaveClass("group-focus-within:opacity-100");
    expect(deleteButton).toHaveClass("focus-visible:ring-2");
    expect(deleteButton).toHaveClass("focus-visible:ring-destructive");
    expect(screen.getByRole("radio", { name: "Local" })).toHaveAccessibleDescription(
      "Selected model."
    );
  });

  it("announces the active provider", () => {
    render(
      <ProviderTabs
        providers={[
          { id: "openai", name: "OpenAI" },
          { id: "custom", name: "Custom" },
        ]}
        selectedId="custom"
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "OpenAI" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });
});
