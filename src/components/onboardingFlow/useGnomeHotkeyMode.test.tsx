import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGnomeHotkeyMode } from "./useGnomeHotkeyMode";

function TestComponent({ onMode }: { onMode: (mode: "tap" | "push") => void }) {
  const isUsingGnomeHotkeys = useGnomeHotkeyMode(onMode);
  return <div>{String(isUsingGnomeHotkeys)}</div>;
}

describe("useGnomeHotkeyMode", () => {
  it("sets tap mode when GNOME hotkeys are detected", async () => {
    const setActivationMode = vi.fn();
    (window as any).electronAPI = {
      getHotkeyModeInfo: vi.fn(async () => ({ isUsingGnome: true })),
    };

    render(<TestComponent onMode={setActivationMode} />);

    await waitFor(() => expect(setActivationMode).toHaveBeenCalledWith("tap"));
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("is a no-op when electronAPI is missing", async () => {
    const setActivationMode = vi.fn();
    (window as any).electronAPI = undefined;

    render(<TestComponent onMode={setActivationMode} />);

    await waitFor(() => expect(screen.getByText("false")).toBeInTheDocument());
    expect(setActivationMode).not.toHaveBeenCalled();
  });
});

