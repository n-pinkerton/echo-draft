import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StartupSection from "./StartupSection";

vi.mock("../../../ui/toggle", () => ({
  Toggle: (props: any) => (
    <button type="button" data-testid="toggle" onClick={() => props.onChange(!props.checked)}>
      {props.checked ? "on" : "off"}
    </button>
  ),
}));

describe("StartupSection", () => {
  beforeEach(() => {
    (window as any).electronAPI = undefined;
  });

  afterEach(() => {
    delete (window as any).electronAPI;
    vi.clearAllMocks();
  });

  it("does not render on linux", () => {
    (window as any).electronAPI = { getPlatform: () => "linux" };
    render(<StartupSection />);
    expect(screen.queryByText("Startup")).not.toBeInTheDocument();
  });

  it("renders and toggles auto-start on windows", async () => {
    const getAutoStartEnabled = vi.fn(async () => true);
    const setAutoStartEnabled = vi.fn(async () => ({ success: true }));
    (window as any).electronAPI = {
      getPlatform: () => "win32",
      getAutoStartEnabled,
      setAutoStartEnabled,
    };

    const user = userEvent.setup();
    render(<StartupSection />);

    await waitFor(() => expect(screen.getByText("Startup")).toBeInTheDocument());
    await user.click(screen.getByTestId("toggle"));

    expect(setAutoStartEnabled).toHaveBeenCalledWith(false);
  });
});

