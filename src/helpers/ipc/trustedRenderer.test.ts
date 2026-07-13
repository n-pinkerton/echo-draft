import { describe, expect, it } from "vitest";

import {
  getTrustedRendererRole,
  isTrustedAppNavigation,
  normalizeDocumentUrl,
  requireTrustedRenderer,
} from "./trustedRenderer.js";

const createTrustedHarness = () => {
  const controlFrame = { url: "file:///C:/EchoDraft/index.html?controlPanel=true#settings" };
  const dictationFrame = { url: "file:///C:/EchoDraft/index.html" };
  const controlSender = { mainFrame: controlFrame, getURL: () => controlFrame.url };
  const dictationSender = { mainFrame: dictationFrame, getURL: () => dictationFrame.url };
  const windowManager = {
    controlPanelWindow: {
      __echoDraftTrustedUrl: "file:///C:/EchoDraft/index.html?controlPanel=true",
      webContents: controlSender,
      isDestroyed: () => false,
    },
    mainWindow: {
      __echoDraftTrustedUrl: dictationFrame.url,
      webContents: dictationSender,
      isDestroyed: () => false,
    },
  };
  return { controlFrame, controlSender, dictationFrame, dictationSender, windowManager };
};

describe("trustedRenderer", () => {
  it("accepts only the exact trusted document while allowing an in-document hash", () => {
    const harness = createTrustedHarness();
    const event = { sender: harness.controlSender, senderFrame: harness.controlFrame };

    expect(getTrustedRendererRole(event, harness.windowManager)).toBe("control-panel");
    expect(requireTrustedRenderer(event, harness.windowManager, ["control-panel"])).toBe(
      "control-panel"
    );
    expect(normalizeDocumentUrl(harness.controlFrame.url)).toBe(
      "file:///C:/EchoDraft/index.html?controlPanel=true"
    );
  });

  it("rejects a subframe even when it reports the trusted URL", () => {
    const harness = createTrustedHarness();
    const subframe = { url: harness.controlFrame.url };
    const event = { sender: harness.controlSender, senderFrame: subframe };

    expect(getTrustedRendererRole(event, harness.windowManager)).toBeNull();
    expect(() => requireTrustedRenderer(event, harness.windowManager)).toThrow(
      /renderer is not trusted/i
    );
  });

  it("accepts distinct Electron wrappers only when both native frame identifiers match", () => {
    const harness = createTrustedHarness();
    (harness.controlSender as any).mainFrame = {
      url: harness.controlFrame.url,
      processId: 31,
      routingId: 7,
    };

    expect(
      getTrustedRendererRole(
        {
          sender: harness.controlSender,
          senderFrame: {
            url: harness.controlFrame.url,
            processId: 31,
            routingId: 7,
          },
        },
        harness.windowManager
      )
    ).toBe("control-panel");

    expect(
      getTrustedRendererRole(
        {
          sender: harness.controlSender,
          senderFrame: {
            url: harness.controlFrame.url,
            processId: 31,
            routingId: 8,
          },
        },
        harness.windowManager
      )
    ).toBeNull();
  });

  it("rejects a different path, query, sender, or destroyed window", () => {
    const harness = createTrustedHarness();
    const wrongPath = { url: "file:///C:/EchoDraft/other.html?controlPanel=true" };
    const wrongQuery = { url: "file:///C:/EchoDraft/index.html?controlPanel=false" };

    harness.controlSender.mainFrame = wrongPath;
    expect(
      getTrustedRendererRole(
        { sender: harness.controlSender, senderFrame: wrongPath },
        harness.windowManager
      )
    ).toBeNull();
    harness.controlSender.mainFrame = harness.controlFrame;
    expect(isTrustedAppNavigation(harness.windowManager.controlPanelWindow, wrongQuery.url)).toBe(
      false
    );
    expect(
      getTrustedRendererRole(
        {
          sender: { mainFrame: harness.controlFrame, getURL: () => harness.controlFrame.url },
          senderFrame: harness.controlFrame,
        },
        harness.windowManager
      )
    ).toBeNull();
    expect(
      getTrustedRendererRole({ sender: harness.controlSender }, harness.windowManager)
    ).toBeNull();
    harness.windowManager.controlPanelWindow.isDestroyed = () => true;
    expect(
      getTrustedRendererRole(
        { sender: harness.controlSender, senderFrame: harness.controlFrame },
        harness.windowManager
      )
    ).toBeNull();
  });
});
