import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const toast = vi.fn();

vi.mock("./ui/toastContext", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("../utils/logger", () => ({
  default: { refreshLogLevel: vi.fn() },
}));

import DeveloperSection from "./DeveloperSection";

describe("DeveloperSection", () => {
  const purgeDebugArtifacts = vi.fn(async () => ({
    success: true,
    filesDeleted: 3,
    bytesDeleted: 2048,
    freshLogStarted: true,
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (window as any).electronAPI = {
      getDebugState: vi.fn(async () => ({
        enabled: true,
        logPath: "C:\\EchoDraft\\logs\\echodraft-debug-2026-07-13.jsonl",
        logsDir: "C:\\EchoDraft\\logs",
        logsDirSource: "install",
        fileLoggingEnabled: true,
        fileLoggingError: null,
        logLevel: "debug",
      })),
      setDebugLogging: vi.fn(),
      openLogsFolder: vi.fn(async () => ({ success: true })),
      purgeDebugArtifacts,
    };
  });

  it("makes debug privacy and cleanup controls prominent", async () => {
    render(<DeveloperSection />);

    expect(await screen.findByText("Stores sensitive diagnostic data")).toBeInTheDocument();
    expect(screen.getByText(/input recordings containing your voice/i)).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Enable debug logging and voice recording capture" })
    ).toHaveAccessibleDescription(/may include dictated text/i);
    expect(screen.getByRole("button", { name: "Delete Diagnostic Data" })).toBeInTheDocument();
  });

  it("warns and asks for confirmation before enabling capture", async () => {
    window.electronAPI.getDebugState = vi.fn(async () => ({
      enabled: false,
      logPath: null,
      logsDir: "C:\\EchoDraft\\logs",
      logsDirSource: "install",
      fileLoggingEnabled: false,
      fileLoggingError: null,
      logLevel: "info",
    }));
    window.electronAPI.setDebugLogging = vi.fn(async () => ({ success: true }));

    render(<DeveloperSection />);
    const toggle = await screen.findByRole("switch", {
      name: "Enable debug logging and voice recording capture",
    });
    expect(screen.getByText("Stores sensitive diagnostic data")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(
      screen.getByRole("heading", { name: "Enable sensitive diagnostics?" })
    ).toBeInTheDocument();
    expect(window.electronAPI.setDebugLogging).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Enable Debug Mode" }));
    await waitFor(() => expect(window.electronAPI.setDebugLogging).toHaveBeenCalledWith(true));
  });

  it("delegates deletion confirmation to the main-process purge API", async () => {
    render(<DeveloperSection />);
    const deleteButton = await screen.findByRole("button", { name: "Delete Diagnostic Data" });

    fireEvent.click(deleteButton);

    await waitFor(() => expect(purgeDebugArtifacts).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Diagnostic data deleted",
          description: expect.stringContaining("A fresh log was started"),
        })
      )
    );
  });
});
