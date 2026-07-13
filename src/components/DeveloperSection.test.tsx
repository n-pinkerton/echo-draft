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

    expect(await screen.findByText("Sensitive diagnostic data")).toBeInTheDocument();
    expect(screen.getByText(/captured recordings contain your voice/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Diagnostic Data" })).toBeInTheDocument();
  });

  it("requires confirmation before invoking the pathless purge API", async () => {
    render(<DeveloperSection />);
    const deleteButton = await screen.findByRole("button", { name: "Delete Diagnostic Data" });

    fireEvent.click(deleteButton);
    expect(screen.getByRole("heading", { name: "Delete diagnostic data?" })).toBeInTheDocument();
    expect(purgeDebugArtifacts).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete Data" }));

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
