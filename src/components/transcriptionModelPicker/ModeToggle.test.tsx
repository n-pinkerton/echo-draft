import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ModeToggle } from "./ModeToggle";

describe("ModeToggle", () => {
  it("switches between cloud and local modes", async () => {
    const onModeChange = vi.fn();
    const user = userEvent.setup();

    render(<ModeToggle useLocalWhisper={false} onModeChange={onModeChange} />);

    await user.click(screen.getByRole("button", { name: "Local" }));
    expect(onModeChange).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole("button", { name: "Cloud" }));
    expect(onModeChange).toHaveBeenCalledWith(false);
  });
});

