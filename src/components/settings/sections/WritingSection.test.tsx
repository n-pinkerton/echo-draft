import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import WritingSection from "./WritingSection";

const rule = {
  id: 7,
  sourcePhrase: "eco draft",
  replacementText: "EchoDraft",
  enabled: true,
  createdAt: "2026-08-09 00:00:00",
  updatedAt: "2026-08-09 00:00:00",
};
const profile = {
  id: 9,
  processName: "winword.exe",
  style: "document" as const,
  enabled: true,
  createdAt: "2026-08-09 00:00:00",
  updatedAt: "2026-08-09 00:00:00",
};

describe("WritingSection", () => {
  const toast = vi.fn();
  const showConfirmDialog = vi.fn();
  const getCorrectionRules = vi.fn(async () => [rule]);
  const getAppStyleProfiles = vi.fn(async () => [profile]);
  const saveCorrectionRule = vi.fn(async () => rule);
  const deleteCorrectionRule = vi.fn(async () => ({ success: true, deleted: 1 }));
  const saveAppStyleProfile = vi.fn(async () => profile);
  const deleteAppStyleProfile = vi.fn(async () => ({ success: true, deleted: 1 }));

  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = {
      getCorrectionRules,
      getAppStyleProfiles,
      saveCorrectionRule,
      deleteCorrectionRule,
      saveAppStyleProfile,
      deleteAppStyleProfile,
    };
  });

  it("previews boundary-aware local replacements and exposes edit, disable, and delete", async () => {
    render(<WritingSection toast={toast} showConfirmDialog={showConfirmDialog} />);

    expect(await screen.findByText("Always replace this")).toBeInTheDocument();
    expect(
      screen.getByText(/stored locally.*separate from the speech dictionary/i)
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Correction source phrase"), {
      target: { value: "eco draft" },
    });
    fireEvent.change(screen.getByLabelText("Correction replacement text"), {
      target: { value: "EchoDraft" },
    });
    fireEvent.change(screen.getByLabelText("Correction preview text"), {
      target: { value: "eco draft and eco drafter" },
    });
    expect(screen.getByText("EchoDraft and eco drafter")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Enable correction eco draft" }));
    await waitFor(() =>
      expect(saveCorrectionRule).toHaveBeenCalledWith(
        expect.objectContaining({ id: 7, enabled: false })
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit correction eco draft" }));
    expect(screen.getByRole("button", { name: "Save correction" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete correction eco draft" }));
    expect(showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Delete This Correction?",
        confirmText: "Delete Correction",
        variant: "destructive",
      })
    );
    showConfirmDialog.mock.calls.at(-1)?.[0].onConfirm();
    await waitFor(() => expect(deleteCorrectionRule).toHaveBeenCalledWith(7));
  });

  it("limits application mappings to fixed styles and states the privacy boundary", async () => {
    render(<WritingSection toast={toast} showConfirmDialog={showConfirmDialog} />);

    expect(await screen.findByText("Application styles")).toBeInTheDocument();
    expect(
      screen.getByText(
        /does not capture or send window titles, selected text, clipboard contents, or surrounding content/i
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/Prompt hotkeys ignore these styles/i)).toBeInTheDocument();
    const styleSelect = screen.getByLabelText("Application writing style");
    expect(
      Array.from((styleSelect as HTMLSelectElement).options).map((option) => option.text)
    ).toEqual(["Document", "Message", "Technical"]);

    fireEvent.change(screen.getByLabelText("Application process name"), {
      target: { value: "slack.exe" },
    });
    fireEvent.change(styleSelect, { target: { value: "message" } });
    fireEvent.click(screen.getByRole("button", { name: "Add mapping" }));
    await waitFor(() =>
      expect(saveAppStyleProfile).toHaveBeenCalledWith({
        processName: "slack.exe",
        style: "message",
        enabled: true,
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete application style winword.exe" }));
    expect(showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Delete This Application Style?",
        confirmText: "Delete Mapping",
        variant: "destructive",
      })
    );
    showConfirmDialog.mock.calls.at(-1)?.[0].onConfirm();
    await waitFor(() => expect(deleteAppStyleProfile).toHaveBeenCalledWith(9));
  });

  it("reports bounded rule and profile mutation failures locally", async () => {
    deleteCorrectionRule.mockRejectedValueOnce(new Error("database locked"));
    saveAppStyleProfile.mockRejectedValueOnce(new Error("profile unavailable"));
    render(<WritingSection toast={toast} showConfirmDialog={showConfirmDialog} />);

    await screen.findByText("Always replace this");
    fireEvent.click(screen.getByRole("button", { name: "Delete correction eco draft" }));
    showConfirmDialog.mock.calls.at(-1)?.[0].onConfirm();
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable application style winword.exe" }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Could not delete correction", variant: "destructive" })
      )
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Could not update application style",
          variant: "destructive",
        })
      )
    );
  });
});
