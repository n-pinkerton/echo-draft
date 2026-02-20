import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import UpdatesSection from "./UpdatesSection";

const useUpdaterMock = vi.fn();

vi.mock("../../../../hooks/useUpdater", () => ({
  useUpdater: () => useUpdaterMock(),
}));

describe("UpdatesSection", () => {
  beforeEach(() => {
    useUpdaterMock.mockReturnValue({
      status: { isDevelopment: false, updateAvailable: false, updateDownloaded: false },
      info: null,
      downloadProgress: 0,
      isChecking: false,
      isDownloading: false,
      isInstalling: false,
      checkForUpdates: vi.fn(async () => ({ updateAvailable: false, message: "No updates available" })),
      downloadUpdate: vi.fn(async () => {}),
      installUpdate: vi.fn(async () => {}),
      getAppVersion: vi.fn(async () => "1.2.3"),
      error: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders current version and checks for updates", async () => {
    const showAlertDialog = vi.fn();
    const showConfirmDialog = vi.fn();
    const user = userEvent.setup();

    render(<UpdatesSection showAlertDialog={showAlertDialog} showConfirmDialog={showConfirmDialog} />);

    expect(screen.getByText("Current version")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("1.2.3")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Check for Updates" }));

    await waitFor(() =>
      expect(showAlertDialog).toHaveBeenCalledWith(
        expect.objectContaining({ title: "No Updates" })
      )
    );
  });
});
