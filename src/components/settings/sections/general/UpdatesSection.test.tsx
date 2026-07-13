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
    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      openVerifiedReleases: vi.fn(async () => ({ success: true })),
    };
    useUpdaterMock.mockReturnValue({
      status: {
        isDevelopment: false,
        updateAvailable: false,
        updateDownloaded: false,
        hasCheckedForUpdates: true,
        isChecking: false,
        updatesEnabled: true,
      },
      info: null,
      downloadProgress: 0,
      isChecking: false,
      isDownloading: false,
      isInstalling: false,
      isInitialized: true,
      isInitializing: false,
      checkForUpdates: vi.fn(async () => ({
        updateAvailable: false,
        message: "No updates available",
      })),
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

    render(
      <UpdatesSection showAlertDialog={showAlertDialog} showConfirmDialog={showConfirmDialog} />
    );

    expect(screen.getByText("Current version")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("1.2.3")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Check for Updates" }));

    await waitFor(() =>
      expect(showAlertDialog).toHaveBeenCalledWith(expect.objectContaining({ title: "No Updates" }))
    );
  });

  it("labels unsigned builds as manual-update only and disables network checks", async () => {
    const checkForUpdates = vi.fn();
    useUpdaterMock.mockReturnValue({
      ...useUpdaterMock(),
      status: {
        isDevelopment: false,
        updateAvailable: false,
        updateDownloaded: false,
        updatesEnabled: false,
        disabledReason: "Automatic updates are disabled for this unsigned Windows build.",
      },
      checkForUpdates,
    });

    render(<UpdatesSection showAlertDialog={vi.fn()} showConfirmDialog={vi.fn()} />);

    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText(/unsigned Windows build/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check for Updates" })).toBeDisabled();
    expect(screen.getByText(/portable build runs separately/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open verified releases" }));
    expect(window.electronAPI.openVerifiedReleases).toHaveBeenCalledOnce();
    expect(checkForUpdates).not.toHaveBeenCalled();
  });

  it("shows loading instead of Latest and disables actions before initialization", () => {
    useUpdaterMock.mockReturnValue({
      ...useUpdaterMock(),
      isInitialized: false,
      isInitializing: true,
    });

    render(<UpdatesSection showAlertDialog={vi.fn()} showConfirmDialog={vi.fn()} />);

    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(screen.queryByText("Latest")).not.toBeInTheDocument();
    expect(screen.getByText("Checking update status...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check for Updates" })).toBeDisabled();
  });

  it("shows an honest not-checked state before the delayed startup check", () => {
    useUpdaterMock.mockReturnValue({
      ...useUpdaterMock(),
      status: {
        ...useUpdaterMock().status,
        hasCheckedForUpdates: false,
        isChecking: false,
      },
    });

    render(<UpdatesSection showAlertDialog={vi.fn()} showConfirmDialog={vi.fn()} />);

    expect(screen.getByText("Not checked")).toBeInTheDocument();
    expect(screen.getByText("Updates have not been checked yet")).toBeInTheDocument();
    expect(screen.queryByText("Latest")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check for Updates" })).toBeEnabled();
  });

  it("shows checking while the startup update request is in flight", () => {
    useUpdaterMock.mockReturnValue({
      ...useUpdaterMock(),
      status: {
        ...useUpdaterMock().status,
        hasCheckedForUpdates: false,
        isChecking: true,
      },
      isChecking: false,
    });

    render(<UpdatesSection showAlertDialog={vi.fn()} showConfirmDialog={vi.fn()} />);

    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.getByText("Checking for updates...")).toBeInTheDocument();
    expect(screen.queryByText("Latest")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checking..." })).toBeDisabled();
  });

  it("shows manual recovery copy when status initialization fails", () => {
    useUpdaterMock.mockReturnValue({
      ...useUpdaterMock(),
      status: {
        isDevelopment: false,
        updateAvailable: false,
        updateDownloaded: false,
        updatesEnabled: false,
        disabledReason:
          "Automatic update status is unavailable. Try again later or download updates manually.",
      },
      error: null,
    });

    render(<UpdatesSection showAlertDialog={vi.fn()} showConfirmDialog={vi.fn()} />);

    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText(/download updates manually/i)).toBeInTheDocument();
    expect(screen.queryByText("Latest")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check for Updates" })).toBeDisabled();
  });

  it("does not claim Latest after an updater IPC failure", () => {
    useUpdaterMock.mockReturnValue({
      ...useUpdaterMock(),
      error: new Error("updater IPC unavailable"),
    });

    render(<UpdatesSection showAlertDialog={vi.fn()} showConfirmDialog={vi.fn()} />);

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText(/update status is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText("Latest")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check for Updates" })).toBeEnabled();
  });

  it("does not open a second dialog from the rejected button action", async () => {
    const checkForUpdates = vi.fn(async () => {
      throw new Error("update endpoint unavailable");
    });
    useUpdaterMock.mockReturnValue({
      ...useUpdaterMock(),
      checkForUpdates,
    });
    const showAlertDialog = vi.fn();
    const user = userEvent.setup();
    render(<UpdatesSection showAlertDialog={showAlertDialog} showConfirmDialog={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Check for Updates" }));
    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledOnce());
    expect(showAlertDialog).not.toHaveBeenCalled();
  });
});
