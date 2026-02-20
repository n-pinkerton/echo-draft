import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PromptStudio from "./PromptStudio";

describe("PromptStudio", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads existing prompt and saves edits", async () => {
    localStorage.setItem("agentName", "Nigel");
    localStorage.setItem("customUnifiedPrompt", JSON.stringify("hello {{agentName}}"));

    const user = userEvent.setup();
    render(<PromptStudio />);

    expect(screen.getByText("hello Nigel")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Customize" }));

    const textarea = screen.getByPlaceholderText("Enter your custom system prompt...");
    await user.clear(textarea);
    await user.type(textarea, "new prompt");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(localStorage.getItem("customUnifiedPrompt")).toBe(JSON.stringify("new prompt"));
  });
});

