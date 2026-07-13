import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SAVED_KEY_PLACEHOLDER } from "../../config/apiKeys";
import ApiKeyInput from "./ApiKeyInput";

describe("ApiKeyInput", () => {
  it("keeps the saved marker out of the editable value and submits only the replacement", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => {});
    render(<ApiKeyInput apiKey={SAVED_KEY_PLACEHOLDER} setApiKey={save} />);

    const input = screen.getByLabelText("API Key");
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", expect.stringMatching(/saved securely/i));
    await user.type(input, "replacement-key");
    await user.click(screen.getByRole("button", { name: "Replace key" }));

    expect(save).toHaveBeenCalledWith("replacement-key");
    expect(save).not.toHaveBeenCalledWith(expect.stringContaining(SAVED_KEY_PLACEHOLDER));
  });

  it("shows one accessible error and no success state when persistence rejects", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => {
      throw new Error("storage failed");
    });
    render(<ApiKeyInput apiKey="" setApiKey={save} />);

    await user.type(screen.getByLabelText("API Key"), "replacement-key");
    await user.click(screen.getByRole("button", { name: "Save key" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be saved/i);
    expect(screen.queryByText("Saved securely")).not.toBeInTheDocument();
  });

  it("never treats a whitespace-only replacement as removal", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => {});
    render(<ApiKeyInput apiKey={SAVED_KEY_PLACEHOLDER} setApiKey={save} />);

    await user.type(screen.getByLabelText("API Key"), "   ");
    await user.click(screen.getByRole("button", { name: "Replace key" }));

    expect(save).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/enter a key to save/i);
  });
});
