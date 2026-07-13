import { describe, expect, it, vi } from "vitest";

import { VERIFIED_RELEASES_URL } from "../../../updater.js";
import { registerUpdateHandlers } from "./updateHandlers.js";

describe("update handler release recovery", () => {
  it("opens only the pinned release page from the trusted control panel", async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const sender: any = { id: 8, getURL: () => "file:///app/index.html?view=control-panel" };
    sender.mainFrame = { processId: 1, routingId: 1, url: sender.getURL() };
    const shell = { openExternal: vi.fn(async () => {}) };
    registerUpdateHandlers(
      {
        ipcMain: { handle: (channel: string, handler: any) => handlers.set(channel, handler) },
        shell,
      } as any,
      {
        updateManager: {},
        windowManager: {
          controlPanelWindow: {
            __echoDraftTrustedUrl: sender.getURL(),
            webContents: sender,
            isDestroyed: () => false,
          },
        },
      } as any
    );

    await expect(
      handlers.get("open-verified-releases")?.({ sender, senderFrame: sender.mainFrame })
    ).resolves.toEqual({ success: true });
    expect(shell.openExternal).toHaveBeenCalledWith(VERIFIED_RELEASES_URL);

    await expect(
      handlers.get("open-verified-releases")?.({
        sender,
        senderFrame: { processId: 1, routingId: 2, url: sender.getURL() },
      })
    ).rejects.toMatchObject({ code: "UNTRUSTED_RENDERER" });
    expect(shell.openExternal).toHaveBeenCalledOnce();
  });
});
