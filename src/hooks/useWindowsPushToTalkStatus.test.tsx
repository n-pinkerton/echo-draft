import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWindowsPushToTalkStatus } from "./useWindowsPushToTalkStatus";

describe("useWindowsPushToTalkStatus", () => {
  let unavailable: (payload: Record<string, unknown>) => void;
  let recovered: (payload: Record<string, unknown>) => void;
  const disposeUnavailable = vi.fn();
  const disposeRecovered = vi.fn();
  const updateTrayStatus = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = {
      onWindowsPushToTalkUnavailable: vi.fn((callback) => {
        unavailable = callback;
        return disposeUnavailable;
      }),
      onWindowsPushToTalkRecovered: vi.fn((callback) => {
        recovered = callback;
        return disposeRecovered;
      }),
      updateTrayStatus,
    };
  });

  it("shows stable fallback guidance without exposing a raw native error", () => {
    const toast = vi.fn(() => "warning-id");
    const dismiss = vi.fn();
    renderHook(() => useWindowsPushToTalkStatus({ toast, dismiss, updateTray: true }));

    act(() => {
      unavailable({
        reason: "listener_error",
        routeId: "insert",
        fallbackActive: true,
        recoveryPending: true,
        recordingSafetyStopped: true,
        message: "C:\\private\\windows-key-listener.exe exited with code 7",
      });
    });

    const rendered = JSON.stringify(toast.mock.calls);
    expect(rendered).toContain("tap-to-toggle");
    expect(rendered).toContain("stopped safely");
    expect(rendered).not.toContain("private");
    expect(rendered).not.toContain("code 7");
    expect(updateTrayStatus).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "error", stageLabel: "Insert Shortcut Recovery" })
    );
  });

  it("does not promise recovery when the helper is missing and no retry is scheduled", () => {
    const toast = vi.fn(() => "warning-id");
    renderHook(() => useWindowsPushToTalkStatus({ toast, updateTray: true }));

    act(() => {
      unavailable({
        reason: "binary_not_found",
        routeId: "insert",
        fallbackActive: true,
        recoveryPending: false,
      });
    });

    const notice = (toast.mock.calls as unknown as Array<[Record<string, string>]>).at(-1)?.[0];
    expect(notice?.title).toBe("Windows shortcuts need attention");
    expect(notice?.description).toContain("no automatic retry is scheduled");
    expect(notice?.description).not.toMatch(/recover(?:y|ing|s)/i);
  });

  it("aggregates both shortcut routes and their different recovery states", () => {
    const toast = vi.fn(() => "warning-id");
    renderHook(() => useWindowsPushToTalkStatus({ toast, updateTray: true }));

    act(() => {
      unavailable({
        routeId: "clipboard",
        unavailableRoutes: [
          {
            routeId: "insert",
            reason: "listener_exited",
            fallbackActive: true,
            recoveryPending: true,
          },
          {
            routeId: "clipboard",
            reason: "listener_start_failed",
            fallbackActive: false,
            recoveryPending: false,
          },
        ],
      });
    });

    const notice = (toast.mock.calls as unknown as Array<[Record<string, string>]>).at(-1)?.[0];
    expect(notice?.title).toBe("Windows shortcuts recovering");
    expect(notice?.description).toContain("Insert is using tap-to-toggle");
    expect(notice?.description).toContain("Clipboard is unavailable");
    expect(notice?.description).toContain("no automatic retry is scheduled");
    expect(updateTrayStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ stageLabel: "Shortcut Recovery" })
    );
  });

  it("dismisses the stale warning and publishes recovery", () => {
    const toast = vi.fn().mockReturnValueOnce("warning-id").mockReturnValueOnce("recovered-id");
    const dismiss = vi.fn();
    const { unmount } = renderHook(() =>
      useWindowsPushToTalkStatus({ toast, dismiss, updateTray: true })
    );

    act(() =>
      unavailable({
        reason: "listener_exited",
        routeId: "insert",
        recoveryPending: true,
      })
    );
    act(() => recovered({ routeId: "insert", remainingUnavailableRoutes: [] }));

    expect(dismiss).toHaveBeenCalledWith("warning-id");
    expect(toast).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Windows shortcuts recovered", variant: "success" })
    );
    expect(updateTrayStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ stage: "done", stageLabel: "Shortcuts Recovered" })
    );

    unmount();
    expect(disposeUnavailable).toHaveBeenCalledOnce();
    expect(disposeRecovered).toHaveBeenCalledOnce();
  });
});
