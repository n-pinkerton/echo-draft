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
  const purgeDataOlderThan30Days = vi.fn(async () => ({
    success: true,
    database: { success: true, historyDeleted: 2, todosDeleted: 3 },
    logs: { success: true, filesDeleted: 4, bytesDeleted: 4096, residualFiles: 0 },
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
      purgeDataOlderThan30Days,
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
    expect(
      screen.getByRole("button", { name: "Delete logs and transcripts older than 30 days" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Captured audio and mobile inbox data are excluded/i)
    ).toBeInTheDocument();
  });

  it("keeps the warning visible and delegates enablement consent to the main process", async () => {
    window.electronAPI.getDebugState = vi.fn(async () => ({
      enabled: false,
      logPath: null,
      logsDir: "C:\\EchoDraft\\logs",
      logsDirSource: "install",
      fileLoggingEnabled: false,
      fileLoggingError: null,
      logLevel: "info",
    }));
    window.electronAPI.setDebugLogging = vi.fn(async () => ({
      success: false,
      cancelled: true,
      enabled: false,
    }));

    render(<DeveloperSection />);
    const toggle = await screen.findByRole("switch", {
      name: "Enable debug logging and voice recording capture",
    });
    expect(screen.getByText("Stores sensitive diagnostic data")).toBeInTheDocument();

    fireEvent.click(toggle);
    await waitFor(() => expect(window.electronAPI.setDebugLogging).toHaveBeenCalledWith(true));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
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

  it("delegates the separate 30-day flow and reports each deletion surface", async () => {
    render(<DeveloperSection />);
    const deleteButton = await screen.findByRole("button", {
      name: "Delete logs and transcripts older than 30 days",
    });

    fireEvent.click(deleteButton);

    await waitFor(() => expect(purgeDataOlderThan30Days).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Old local data deleted",
          description: expect.stringMatching(/2 History items.*3 To Dos.*4 desktop log files/i),
        })
      )
    );
  });

  it("does not show invented deletion counts when the result is uncertain", async () => {
    (purgeDataOlderThan30Days as any).mockResolvedValueOnce({
      success: false,
      aborted: false,
      uncertain: true,
      error: "Review the local data before trying again.",
    });
    render(<DeveloperSection />);
    const deleteButton = await screen.findByRole("button", {
      name: "Delete logs and transcripts older than 30 days",
    });

    fireEvent.click(deleteButton);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Deletion result unconfirmed",
          description: expect.stringContaining(
            "EchoDraft could not confirm how much of the reviewed data was deleted."
          ),
        })
      )
    );
    expect(toast.mock.calls.at(-1)?.[0]?.description).not.toMatch(/Deleted 0/i);
  });
});
