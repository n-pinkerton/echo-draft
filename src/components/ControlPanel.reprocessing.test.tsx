import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  initializeTranscriptions: vi.fn(async () => []),
  getPendingTodos: vi.fn(async () => []),
  reprocessStoredItem: vi.fn(),
  latestViewProps: null as any,
  dialogs: {
    confirmDialog: null,
    alertDialog: null,
    showConfirmDialog: vi.fn(),
    showAlertDialog: vi.fn(),
    hideConfirmDialog: vi.fn(),
    hideAlertDialog: vi.fn(),
  },
  settings: {
    useReasoningModel: true,
    reasoningModel: "Luna",
    cloudReasoningMode: "echodraft-cloud",
    dictationKey: "F10",
    dictationKeyClipboard: "F9",
    activationMode: "push-to-talk",
    preferBuiltInMic: false,
    selectedMicDeviceId: null,
    setPreferBuiltInMic: vi.fn(),
    setSelectedMicDeviceId: vi.fn(),
    setUseLocalWhisper: vi.fn(),
    setCloudTranscriptionMode: vi.fn(),
  },
  updater: {
    status: { updateAvailable: false, updateDownloaded: false },
    downloadProgress: 0,
    isDownloading: false,
    isInstalling: false,
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
    error: null,
  },
  fileTranscription: {
    showFileTranscribeDialog: false,
    handleDialogOpenChange: vi.fn(),
    fileCleanupEnabled: true,
    setFileCleanupEnabled: vi.fn(),
    fileTranscribeStageLabel: "",
    fileTranscribeMessage: "",
    fileTranscribeFileName: "",
    isFileTranscribing: false,
    transcribeAudioFile: vi.fn(),
  },
}));

vi.mock("../stores/transcriptionStore", () => ({
  useTranscriptions: () => [],
  initializeTranscriptions: mocks.initializeTranscriptions,
  removeTranscription: vi.fn(),
  clearTranscriptions: vi.fn(),
}));

vi.mock("../hooks/useDialogs", () => ({ useDialogs: () => mocks.dialogs }));
vi.mock("./ui/toastContext", () => ({
  useToast: () => ({ toast: mocks.toast, dismiss: vi.fn() }),
}));
vi.mock("../hooks/useUpdater", () => ({ useUpdater: () => mocks.updater }));
vi.mock("../hooks/useSettings", () => ({ useSettings: () => mocks.settings }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ isSignedIn: true, isLoaded: true }) }));
vi.mock("./controlPanel/useFileTranscription", () => ({
  useFileTranscription: () => mocks.fileTranscription,
}));
vi.mock("../hooks/useWindowsPushToTalkStatus", () => ({
  useWindowsPushToTalkStatus: vi.fn(),
}));
vi.mock("../services/reprocessingService", () => ({
  reprocessStoredItem: mocks.reprocessStoredItem,
}));
vi.mock("./controlPanel/ControlPanelView", () => ({
  default: (props: any) => {
    mocks.latestViewProps = props;
    return null;
  },
}));

import ControlPanel from "./ControlPanel";

const savedAlternative = {
  id: 41,
  mode: "cleanup",
  text: "Saved alternative",
  created_at: "2026-08-09 00:00:00",
};

describe("ControlPanel reprocessing outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.latestViewProps = null;
    mocks.initializeTranscriptions.mockResolvedValue([]);
    mocks.getPendingTodos.mockResolvedValue([]);
    mocks.reprocessStoredItem.mockResolvedValue({ alternative: savedAlternative, copied: false });
    (window as any).electronAPI = {
      getPendingTodos: mocks.getPendingTodos,
      getMobileInboxStatus: vi.fn(async () => null),
      onTodoAdded: vi.fn(() => vi.fn()),
      onRetentionDataChanged: vi.fn(() => vi.fn()),
      onLimitReached: vi.fn(() => vi.fn()),
    };
  });

  const renderPanel = async () => {
    render(<ControlPanel />);
    await waitFor(() => expect(mocks.latestViewProps).not.toBeNull());
    await waitFor(() => expect(mocks.getPendingTodos).toHaveBeenCalled());
    mocks.initializeTranscriptions.mockClear();
    mocks.getPendingTodos.mockClear();
    mocks.toast.mockClear();
  };

  it("refreshes History and reports a saved alternative when copying failed", async () => {
    await renderPanel();
    const item = { id: 7, text: "Original", raw_text: "Exact raw" };

    await act(async () => {
      await mocks.latestViewProps.reprocessTranscription(item, "cleanup");
    });

    expect(mocks.reprocessStoredItem).toHaveBeenCalledOnce();
    expect(mocks.initializeTranscriptions).toHaveBeenCalledWith(250);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Alternative saved, but not copied",
        description: "Copy the saved alternative from History.",
      })
    );
    expect(mocks.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Could not process again" })
    );
  });

  it.each(["pending", "actioned"])(
    "refreshes %s To Do and reports a saved alternative when copying failed",
    async (status) => {
      await renderPanel();
      const item = { id: 9, status, text: "Original", raw_text: "Exact raw" };
      const previousArchiveRefreshKey = mocks.latestViewProps.archiveRefreshKey;

      await act(async () => {
        await mocks.latestViewProps.reprocessTodo(item, "cleanup");
      });

      expect(mocks.reprocessStoredItem).toHaveBeenCalledOnce();
      expect(mocks.getPendingTodos).toHaveBeenCalledWith(100);
      expect(mocks.latestViewProps.archiveRefreshKey).toBe(previousArchiveRefreshKey + 1);
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Alternative saved, but not copied",
          description: "Copy the saved alternative from To Do.",
        })
      );
      expect(mocks.toast).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: "Could not process again" })
      );
    }
  );
});
