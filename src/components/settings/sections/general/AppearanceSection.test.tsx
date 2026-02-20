import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AppearanceSection from "./AppearanceSection";

const useThemeMock = vi.fn();

vi.mock("../../../../hooks/useTheme", () => ({
  useTheme: () => useThemeMock(),
}));

describe("AppearanceSection", () => {
  beforeEach(() => {
    useThemeMock.mockReturnValue({ theme: "light", setTheme: vi.fn() });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("updates theme when clicking an option", async () => {
    const user = userEvent.setup();

    render(<AppearanceSection />);

    const { setTheme } = useThemeMock.mock.results[0].value;
    await user.click(screen.getByRole("button", { name: "Dark" }));
    expect(setTheme).toHaveBeenCalledWith("dark");
  });
});

