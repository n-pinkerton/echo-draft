// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  E2E_SESSION_MINTS_PER_RUN,
  E2E_SESSION_MINTS_PER_SENDER,
  registerE2eHandlers,
  writeExclusiveE2eFile,
} from "./e2eHandlers.js";

const trustedUrl = "file:///app/index.html";

function createSender(id: number) {
  const mainFrame = { processId: id, routingId: 1, url: trustedUrl };
  const sender = { mainFrame, getURL: vi.fn(() => trustedUrl) };
  return { sender, event: { sender, senderFrame: mainFrame } };
}

function createHarness() {
  const handlers = new Map<string, (...args: any[]) => any>();
  const createSessionPayload = vi.fn((outputMode: string) => ({
    sessionId: `issued-session-${createSessionPayload.mock.calls.length}`,
    outputMode,
    triggeredAt: 123,
  }));
  const initial = createSender(1);
  const windowManager = {
    mainWindow: {
      __echoDraftTrustedUrl: trustedUrl,
      isDestroyed: vi.fn(() => false),
      webContents: initial.sender,
    },
    controlPanelWindow: undefined as any,
    createSessionPayload,
  };

  registerE2eHandlers(
    {
      ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
          handlers.set(channel, handler);
        }),
      },
      app: { getPath: vi.fn(() => os.tmpdir()) },
      fs: {} as any,
      path,
      globalShortcut: { isRegistered: vi.fn(() => false) },
    } as any,
    {
      databaseManager: {},
      windowManager,
      trayManager: {},
    } as any
  );

  return {
    createSessionPayload,
    handlers,
    handler: handlers.get("e2e-create-dictation-session")!,
    initial,
    windowManager,
  };
}

function createFileHarness({
  runId = "safe-run",
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-e2e-handler-")),
  fsImpl = fs,
}: {
  runId?: string;
  tempRoot?: string;
  fsImpl?: typeof fs;
} = {}) {
  process.env.OPENWHISPR_E2E_RUN_ID = runId;
  const handlers = new Map<string, (...args: any[]) => any>();
  const control = createSender(501);
  const windowManager = {
    mainWindow: undefined,
    controlPanelWindow: {
      __echoDraftTrustedUrl: trustedUrl,
      isDestroyed: vi.fn(() => false),
      webContents: control.sender,
    },
  };
  registerE2eHandlers(
    {
      ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
          handlers.set(channel, handler);
        }),
      },
      app: { getPath: vi.fn(() => tempRoot) },
      fs: fsImpl,
      path,
      globalShortcut: { isRegistered: vi.fn(() => false) },
    } as any,
    {
      databaseManager: {
        getAllTranscriptions: vi.fn(() => []),
        getDictionary: vi.fn(() => ["Alpha", "Beta"]),
      },
      windowManager,
      trayManager: {},
    } as any
  );

  return {
    control,
    handlers,
    runRoot: path.join(tempRoot, "echodraft-e2e", runId),
    tempRoot,
  };
}

afterEach(() => {
  delete process.env.OPENWHISPR_E2E_RUN_ID;
});

function trustSender(windowManager: any, sender: any) {
  windowManager.mainWindow = {
    __echoDraftTrustedUrl: trustedUrl,
    isDestroyed: vi.fn(() => false),
    webContents: sender,
  };
}

describe("E2E authenticated dictation sessions", () => {
  it("mints supported modes for the trusted dictation main frame", async () => {
    const { createSessionPayload, handler, initial } = createHarness();

    await expect(handler(initial.event, "insert")).resolves.toEqual({
      sessionId: "issued-session-1",
      outputMode: "insert",
      triggeredAt: 123,
    });
    expect(createSessionPayload).toHaveBeenCalledWith("insert");
  });

  it("rejects unsupported modes without minting", async () => {
    const { createSessionPayload, handler, initial } = createHarness();

    await expect(handler(initial.event, "unsupported")).rejects.toThrow(/unsupported/i);
    expect(createSessionPayload).not.toHaveBeenCalled();
  });

  it.each([
    ["stale frame", "stale"],
    ["control-panel role", "control-panel"],
    ["subframe", "subframe"],
  ])("rejects an untrusted %s without minting", async (_label, scenario) => {
    const { createSessionPayload, handler, initial, windowManager } = createHarness();
    let event: any = initial.event;

    if (scenario === "stale") {
      event = createSender(2).event;
    } else if (scenario === "control-panel") {
      windowManager.controlPanelWindow = {
        __echoDraftTrustedUrl: trustedUrl,
        isDestroyed: vi.fn(() => false),
        webContents: initial.sender,
      };
      windowManager.mainWindow = undefined as any;
    } else {
      event = {
        sender: initial.sender,
        senderFrame: { processId: 1, routingId: 2, url: trustedUrl },
      };
    }

    await expect(handler(event, "insert")).rejects.toMatchObject({
      code: "UNTRUSTED_RENDERER",
    });
    expect(createSessionPayload).not.toHaveBeenCalled();
  });

  it("rejects a sender flood at the exact per-sender cap", async () => {
    const { createSessionPayload, handler, initial } = createHarness();

    for (let index = 0; index < E2E_SESSION_MINTS_PER_SENDER; index += 1) {
      await handler(initial.event, "clipboard");
    }

    await expect(handler(initial.event, "clipboard")).rejects.toThrow(/sender limit/i);
    expect(createSessionPayload).toHaveBeenCalledTimes(E2E_SESSION_MINTS_PER_SENDER);
  });

  it("rejects aggregate flooding at the exact per-run cap", async () => {
    const { createSessionPayload, handler, windowManager } = createHarness();

    for (let index = 0; index < E2E_SESSION_MINTS_PER_RUN; index += 1) {
      const current = createSender(index + 10);
      trustSender(windowManager, current.sender);
      await handler(current.event, "file");
    }

    const overflow = createSender(E2E_SESSION_MINTS_PER_RUN + 10);
    trustSender(windowManager, overflow.sender);
    await expect(handler(overflow.event, "file")).rejects.toThrow(/run limit/i);
    expect(createSessionPayload).toHaveBeenCalledTimes(E2E_SESSION_MINTS_PER_RUN);
  });

  it("requires the intended trusted renderer role on every diagnostic handler", async () => {
    const { handlers, initial, windowManager } = createHarness();
    for (const channel of [
      "e2e-export-transcriptions",
      "e2e-export-dictionary",
      "e2e-import-dictionary",
      "e2e-get-hotkey-status",
    ]) {
      await expect(handlers.get(channel)?.(initial.event, {})).rejects.toMatchObject({
        code: "UNTRUSTED_RENDERER",
      });
    }

    const control = createSender(77);
    windowManager.mainWindow = undefined;
    windowManager.controlPanelWindow = {
      __echoDraftTrustedUrl: trustedUrl,
      isDestroyed: vi.fn(() => false),
      webContents: control.sender,
    };
    for (const channel of ["e2e-get-tray-status", "e2e-get-main-window-state"] as const) {
      await expect(handlers.get(channel)?.(control.event)).rejects.toMatchObject({
        code: "UNTRUSTED_RENDERER",
      });
    }
  });

  it("publishes exports exclusively and leaves no temporary artifacts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-e2e-publish-"));
    const output = path.join(root, "export.json");
    try {
      writeExclusiveE2eFile({ fs, path }, root, output, '{"safe":true}');
      expect(fs.readFileSync(output, "utf8")).toBe('{"safe":true}');
      expect(fs.readdirSync(root)).toEqual(["export.json"]);
      expect(() => writeExclusiveE2eFile({ fs, path }, root, output, '{"safe":false}')).toThrow(
        /already exists/i
      );
      expect(fs.readFileSync(output, "utf8")).toBe('{"safe":true}');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed through registered handlers for invalid run IDs and nested paths", async () => {
    const invalid = createFileHarness({ runId: "../escape" });
    try {
      await expect(
        invalid.handlers.get("e2e-export-transcriptions")?.(invalid.control.event, {
          format: "json",
          filePath: "export.json",
        })
      ).rejects.toThrow(/valid E2E run capability/i);
    } finally {
      fs.rmSync(invalid.tempRoot, { recursive: true, force: true });
    }

    const valid = createFileHarness();
    try {
      for (const filePath of ["nested/export.json", "../outside.json"]) {
        await expect(
          valid.handlers.get("e2e-export-transcriptions")?.(valid.control.event, {
            format: "json",
            filePath,
          })
        ).rejects.toThrow(/directly within/i);
      }
      expect(fs.existsSync(path.join(valid.tempRoot, "outside.json"))).toBe(false);
    } finally {
      fs.rmSync(valid.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects a linked run-root ancestor through a registered export handler", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-e2e-linked-"));
    const base = path.join(tempRoot, "echodraft-e2e");
    const target = path.join(tempRoot, "real-run-root");
    const linkedRun = path.join(base, "linked-run");
    fs.mkdirSync(base, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    fs.symlinkSync(target, linkedRun, process.platform === "win32" ? "junction" : "dir");
    const harness = createFileHarness({ runId: "linked-run", tempRoot });

    try {
      await expect(
        harness.handlers.get("e2e-export-dictionary")?.(harness.control.event, {
          format: "txt",
          filePath: "dictionary.txt",
        })
      ).rejects.toThrow(/linked E2E paths/i);
      expect(fs.readdirSync(target)).toEqual([]);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves a racing destination and removes its temporary export", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-e2e-race-"));
    const fsImpl = Object.create(fs) as typeof fs;
    fsImpl.linkSync = vi.fn((source: fs.PathLike, destination: fs.PathLike) => {
      fs.writeFileSync(destination, "racing-writer", { flag: "wx" });
      fs.linkSync(source, destination);
    }) as typeof fs.linkSync;
    const harness = createFileHarness({ runId: "race-run", tempRoot, fsImpl });
    const outputPath = path.join(harness.runRoot, "export.json");

    try {
      await expect(
        harness.handlers.get("e2e-export-transcriptions")?.(harness.control.event, {
          format: "json",
          filePath: "export.json",
        })
      ).rejects.toThrow();
      expect(fs.readFileSync(outputPath, "utf8")).toBe("racing-writer");
      expect(fs.readdirSync(harness.runRoot)).toEqual(["export.json"]);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects a stable-import pathname replacement through the registered handler", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-e2e-import-race-"));
    const runRoot = path.join(tempRoot, "echodraft-e2e", "import-run");
    const inputPath = path.join(runRoot, "dictionary.txt");
    const retainedPath = path.join(runRoot, "dictionary-original.txt");
    fs.mkdirSync(runRoot, { recursive: true });
    fs.writeFileSync(inputPath, "Alpha\nBeta\n", "utf8");

    const fsImpl = Object.create(fs) as typeof fs;
    const promiseImpl = Object.create(fs.promises) as typeof fs.promises;
    promiseImpl.open = vi.fn(async (...args: Parameters<typeof fs.promises.open>) => {
      const handle = await fs.promises.open(...args);
      let replaced = false;
      return {
        stat: (...statArgs: Parameters<typeof handle.stat>) => handle.stat(...statArgs),
        read: async (...readArgs: Parameters<typeof handle.read>) => {
          const result = await handle.read(...readArgs);
          if (!replaced) {
            replaced = true;
            fs.renameSync(inputPath, retainedPath);
            fs.writeFileSync(inputPath, "Injected replacement\n", "utf8");
          }
          return result;
        },
        close: () => handle.close(),
      } as any;
    }) as typeof fs.promises.open;
    Object.defineProperty(fsImpl, "promises", { value: promiseImpl });
    const harness = createFileHarness({ runId: "import-run", tempRoot, fsImpl });

    try {
      await expect(
        harness.handlers.get("e2e-import-dictionary")?.(harness.control.event, {
          filePath: "dictionary.txt",
        })
      ).rejects.toThrow(/changed while it was being read/i);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
