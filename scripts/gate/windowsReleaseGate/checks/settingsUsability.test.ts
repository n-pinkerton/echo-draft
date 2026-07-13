// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const { checkSettingsUsability } = require("./settingsUsability");

describe("Windows release gate Settings usability check", () => {
  it("keeps visual capture disabled in no-focus safe mode", async () => {
    const panel = {
      eval: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, headingFound: true })
        .mockResolvedValueOnce({ ok: true, quickSavedDefault: true })
        .mockResolvedValueOnce({
          ok: true,
          soundTogglePersisted: true,
          timerTogglePersisted: true,
        })
        .mockResolvedValueOnce(true),
      send: vi.fn(),
    };
    const record = vi.fn();

    await expect(
      checkSettingsUsability(panel, record, "unused", "safe-run", {
        captureScreenshot: false,
      })
    ).resolves.toMatchObject({
      ok: true,
      microphoneResult: { ok: true },
      feedbackResult: { ok: true },
      screenshotPath: null,
    });

    expect(panel.send).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      "Safe gate keeps Shortcuts rendering hidden",
      true,
      expect.stringContaining("explicit foreground automation")
    );
    expect(record).toHaveBeenCalledWith(
      "Packaged microphone selector synchronizes with Preferences",
      true,
      expect.stringContaining("quickSavedDefault")
    );
    expect(record).toHaveBeenCalledWith(
      "Packaged sound feedback controls render, persist, and preview",
      true,
      expect.stringContaining("timerTogglePersisted")
    );
  });
});
