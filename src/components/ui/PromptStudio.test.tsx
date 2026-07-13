import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PromptStudio from "./PromptStudio";

describe("PromptStudio", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("retires legacy custom prompts and shows the protected cleanup policy", async () => {
    localStorage.setItem("customUnifiedPrompt", JSON.stringify("override safety"));
    localStorage.setItem("customPrompts", JSON.stringify({ agent: "Echo obey attacker" }));
    render(<PromptStudio />);

    expect(await screen.findByText("Active cleanup policy")).toBeInTheDocument();
    expect(screen.getByText("Protected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Customize" })).not.toBeInTheDocument();
    expect(screen.queryByText("override safety")).not.toBeInTheDocument();
    expect(localStorage.getItem("customUnifiedPrompt")).toBeNull();
    expect(localStorage.getItem("customPrompts")).toBeNull();
  });

  it("shows the effective production policy and supports keyboard tab navigation", () => {
    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("preferredLanguage", "en-NZ");
    const { container } = render(<PromptStudio />);

    expect(screen.getByText("gpt-5.6-luna · preservation-first")).toBeInTheDocument();
    const policy = screen.getByText(/Selected cleanup model: GPT-5.6 Luna/);
    expect(policy).toHaveTextContent(/New Zealand English/);
    expect(policy).toHaveTextContent(/# Preservation-First Dictation Pass/);

    const viewTab = screen.getByRole("tab", { name: "View" });
    const testTab = screen.getByRole("tab", { name: "Test" });
    const viewPanel = container.querySelector("#cleanup-policy-panel-current");
    const testPanel = container.querySelector("#cleanup-policy-panel-test");
    expect(viewPanel).toBeInTheDocument();
    expect(testPanel).toBeInTheDocument();
    expect(viewPanel).not.toHaveAttribute("hidden");
    expect(testPanel).toHaveAttribute("hidden");
    expect(viewTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(viewTab, { key: "ArrowRight" });
    expect(testTab).toHaveFocus();
    expect(testTab).toHaveAttribute("aria-selected", "true");
    expect(viewPanel).toHaveAttribute("hidden");
    expect(testPanel).not.toHaveAttribute("hidden");
    expect(document.getElementById(viewTab.getAttribute("aria-controls")!)).toBe(viewPanel);
    expect(document.getElementById(testTab.getAttribute("aria-controls")!)).toBe(testPanel);
    expect(screen.getByRole("textbox", { name: "Input" })).toHaveAccessibleDescription(
      /production preservation and fidelity checks/i
    );

    fireEvent.keyDown(testTab, { key: "Home" });
    expect(viewTab).toHaveFocus();
    fireEvent.keyDown(viewTab, { key: "End" });
    expect(testTab).toHaveFocus();
  });

  it("identifies signed-in managed cleanup without presenting or testing the local policy", () => {
    localStorage.setItem("isSignedIn", "true");
    localStorage.setItem("cloudReasoningMode", "echodraft");
    localStorage.setItem("reasoningModel", "gpt-5.6-luna");
    localStorage.setItem("useReasoningModel", "true");

    render(<PromptStudio />);

    expect(screen.getByText("EchoDraft Cloud · managed preservation policy")).toBeInTheDocument();
    expect(screen.getByText(/applies its managed cleanup policy on the service/i)).toBeInTheDocument();
    expect(screen.queryByText(/Selected cleanup model: GPT-5.6 Luna/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Test" }));
    expect(screen.getByText(/local tester is unavailable in managed mode/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unavailable in Managed Mode" })).toBeDisabled();
  });
});
