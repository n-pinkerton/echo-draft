import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_MOBILE_MANIFEST_BYTES } from "./mobileInboxContract.cjs";
import { MobileInboxManager } from "./mobileInboxManager.js";

const EXTERNAL_ID = "550e8400-e29b-41d4-a716-446655440000";
const SECOND_EXTERNAL_ID = "5f8d2d0e-3792-48cc-b8df-bf651c365a17";
const createdRoots: string[] = [];

const createWorkspace = async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "echodraft-mobile-inbox-"));
  createdRoots.push(root);
  const userDataPath = path.join(root, "user-data");
  const inboxPath = path.join(root, "inbox");
  await fs.promises.mkdir(inboxPath, { recursive: true });
  return { inboxPath, root, userDataPath };
};

const writeReadyItem = async (
  inboxPath: string,
  audio = Buffer.from("mobile audio"),
  externalId = EXTERNAL_ID
) => {
  const audioSha256 = crypto.createHash("sha256").update(audio).digest("hex");
  const audioFile = `${externalId}.m4a`;
  const manifestFile = `${externalId}.ready.json`;
  await fs.promises.writeFile(path.join(inboxPath, audioFile), audio);
  await fs.promises.writeFile(
    path.join(inboxPath, manifestFile),
    JSON.stringify({
      version: 1,
      externalId,
      audioFile,
      audioSha256,
      sizeBytes: audio.length,
      createdAt: "2026-07-18T02:03:04Z",
    })
  );
  return { audioFile, audioSha256, manifestFile };
};

const createRendererWindow = () => {
  const webContents = Object.assign(new EventEmitter(), { send: vi.fn() });
  return Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents,
  }) as any;
};

const createManager = (
  userDataPath: string,
  overrides: Record<string, unknown> = {}
) => {
  const send = vi.fn();
  const databaseManager = {
    getTodoByExternalId: vi.fn(() => null),
    saveTodo: vi.fn((payload) => ({
      success: true,
      created: true,
      todo: {
        id: 7,
        text: payload.text,
        meta: { ...payload.meta, ...(payload.title ? { title: payload.title } : {}) },
        created_at: "2026-07-18 02:04:00",
      },
    })),
  };
  const windowManager = {
    mainWindow: { isDestroyed: () => false, webContents: { send } },
    controlPanelWindow: {
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    },
  };
  const manager = new MobileInboxManager({
    app: { getPath: () => userDataPath },
    databaseManager,
    windowManager,
    logger: { error: vi.fn(), warn: vi.fn() },
    ...overrides,
  });
  manager.markRendererReady();
  return { databaseManager, manager, send, windowManager };
};

afterEach(async () => {
  await Promise.all(
    createdRoots.splice(0).map((root) => fs.promises.rm(root, { force: true, recursive: true }))
  );
});

describe("MobileInboxManager", () => {
  it("persists the selected folder and rejects a blank path", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const { manager } = createManager(userDataPath);

    await expect(manager.setInboxPath("   ")).rejects.toThrow(/invalid/i);
    const canonicalPath = await fs.promises.realpath(inboxPath);
    await expect(manager.setInboxPath(inboxPath)).resolves.toMatchObject({
      configured: true,
      folderPath: canonicalPath,
    });

    const reloaded = createManager(userDataPath).manager;
    expect(reloaded.getStatus()).toMatchObject({
      configured: true,
      folderPath: canonicalPath,
    });
  });

  it("dispatches verified audio, saves the cleaned To Do, and removes its input pair", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    const { databaseManager, manager, send, windowManager } = createManager(userDataPath);
    send.mockImplementation((_channel, payload) => {
      queueMicrotask(() =>
        manager.completeRequest(payload.requestId, {
          success: true,
          title: "Call Taylor",
          text: "Call Taylor tomorrow.",
          rawText: "call taylor tomorrow",
          provider: "openai",
          model: "gpt-4o-transcribe",
        })
      );
    });
    await manager.setInboxPath(inboxPath);

    await manager.scanNow();

    expect(send).toHaveBeenCalledWith(
      "mobile-inbox-process",
      expect.objectContaining({
        externalId: EXTERNAL_ID,
        mimeType: "audio/mp4",
        data: Buffer.from("mobile audio"),
      })
    );
    expect(databaseManager.saveTodo).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: EXTERNAL_ID,
        title: "Call Taylor",
        text: "Call Taylor tomorrow.",
        rawText: "call taylor tomorrow",
        meta: expect.objectContaining({
          source: "android",
          mobileInbox: expect.objectContaining({ audioSha256: item.audioSha256 }),
        }),
      })
    );
    expect(windowManager.controlPanelWindow.webContents.send).toHaveBeenCalledWith(
      "todo-added",
      expect.objectContaining({ title: "Call Taylor" })
    );
    await expect(fs.promises.stat(path.join(inboxPath, item.manifestFile))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.promises.stat(path.join(inboxPath, item.audioFile))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("ignores the mobile diagnostic log and unrelated subfolders", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const diagnosticPath = path.join(inboxPath, "echodraft-mobile-diagnostics.jsonl");
    const unrelatedFolder = path.join(inboxPath, "unrelated.ready.json");
    await fs.promises.writeFile(
      diagnosticPath,
      '{"format":"echodraft-mobile-diagnostics","version":1}\n'
    );
    await fs.promises.mkdir(unrelatedFolder);
    const { databaseManager, manager, send } = createManager(userDataPath);
    await manager.setInboxPath(inboxPath);

    await manager.scanNow();

    expect(send).not.toHaveBeenCalled();
    expect(databaseManager.saveTodo).not.toHaveBeenCalled();
    await expect(fs.promises.readFile(diagnosticPath, "utf8")).resolves.toContain(
      "echodraft-mobile-diagnostics"
    );
    await expect(fs.promises.stat(unrelatedFolder)).resolves.toMatchObject({});
  });

  it("cleans up a previously saved matching item without transcribing it again", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    const { databaseManager, manager, send } = createManager(userDataPath);
    databaseManager.getTodoByExternalId.mockReturnValue({
      meta: { mobileInbox: { audioSha256: item.audioSha256 } },
    });
    await manager.setInboxPath(inboxPath);

    await manager.scanNow();

    expect(send).not.toHaveBeenCalled();
    expect(databaseManager.saveTodo).not.toHaveBeenCalled();
    await expect(fs.promises.stat(path.join(inboxPath, item.manifestFile))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.promises.stat(path.join(inboxPath, item.audioFile))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("quarantines a stable malformed manifest without deleting its audio", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    await fs.promises.writeFile(path.join(inboxPath, item.manifestFile), "not json");
    const { manager, send } = createManager(userDataPath, {
      maxSettlingAttempts: 1,
      retryDelayMs: 0,
      settlingWindowMs: 0,
    });
    await manager.setInboxPath(inboxPath);

    await manager.scanNow();

    expect(send).not.toHaveBeenCalled();
    await expect(
      fs.promises.stat(path.join(inboxPath, `${EXTERNAL_ID}.error.json`))
    ).resolves.toBeTruthy();
    await expect(fs.promises.stat(path.join(inboxPath, item.audioFile))).resolves.toBeTruthy();
  });

  it("quarantines only the claimed invalid manifest when a replacement is published", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    const manifestPath = path.join(inboxPath, item.manifestFile);
    const validReplacement = await fs.promises.readFile(manifestPath, "utf8");
    await fs.promises.writeFile(manifestPath, "not json");
    const rename = vi.fn(async (source: string, target: string) => {
      await fs.promises.rename(source, target);
      if (path.basename(source) === item.manifestFile && target.includes(".echodraft-claim-")) {
        await fs.promises.writeFile(manifestPath, validReplacement);
      }
    });
    const fsImpl = { ...fs, promises: { ...fs.promises, rename } };
    const { manager, send } = createManager(userDataPath, {
      fsImpl,
      maxSettlingAttempts: 1,
      retryDelayMs: 0,
      settlingWindowMs: 0,
    });
    await manager.setInboxPath(inboxPath);

    await manager.scanNow();

    expect(send).not.toHaveBeenCalled();
    await expect(fs.promises.readFile(manifestPath, "utf8")).resolves.toBe(validReplacement);
    await expect(
      fs.promises.readFile(path.join(inboxPath, `${EXTERNAL_ID}.error.json`), "utf8")
    ).resolves.toBe("not json");
  });

  it.each([
    ["one-byte", Buffer.from("{")],
    ["oversized", Buffer.alloc(MAX_MOBILE_MANIFEST_BYTES + 1, 0x20)],
  ])("quarantines a stable %s manifest by retained path identity", async (_label, contents) => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    await fs.promises.writeFile(path.join(inboxPath, item.manifestFile), contents);
    const { manager, send } = createManager(userDataPath, {
      maxSettlingAttempts: 1,
      retryDelayMs: 0,
      settlingWindowMs: 0,
    });
    await manager.setInboxPath(inboxPath);

    await manager.scanNow();

    expect(send).not.toHaveBeenCalled();
    await expect(
      fs.promises.stat(path.join(inboxPath, `${EXTERNAL_ID}.error.json`))
    ).resolves.toBeTruthy();
    await expect(fs.promises.stat(path.join(inboxPath, item.audioFile))).resolves.toBeTruthy();
  });

  it("puts a persistently unreadable manifest on delayed retry without blocking scans", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    const lstat = vi.fn(async (filePath: fs.PathLike) => {
      if (String(filePath).endsWith(item.manifestFile)) {
        const error = new Error("denied") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return await fs.promises.lstat(filePath);
    });
    const fsImpl = { ...fs, promises: { ...fs.promises, lstat } };
    const { manager, send } = createManager(userDataPath, {
      evidencelessRetryDelayMs: 60_000,
      fsImpl,
      maxSettlingAttempts: 1,
      settlingWindowMs: 0,
    });
    await manager.setInboxPath(inboxPath);

    await manager.scanNow();
    const manifestCallsAfterFirstScan = lstat.mock.calls.filter(([filePath]) =>
      String(filePath).endsWith(item.manifestFile)
    ).length;
    await manager.scanNow();

    expect(manager.getStatus().state).toBe("waiting");
    expect(
      lstat.mock.calls.filter(([filePath]) => String(filePath).endsWith(item.manifestFile))
    ).toHaveLength(manifestCallsAfterFirstScan);
    expect(send).not.toHaveBeenCalled();
    await expect(fs.promises.stat(path.join(inboxPath, item.manifestFile))).resolves.toBeTruthy();
  });

  it("keeps a valid item queued when transcription fails", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    const { databaseManager, manager, send } = createManager(userDataPath);
    send.mockImplementation((_channel, payload) => {
      queueMicrotask(() => manager.completeRequest(payload.requestId, { success: false }));
    });
    await manager.setInboxPath(inboxPath);

    await manager.scanNow();

    expect(manager.getStatus().state).toBe("retrying");
    expect(databaseManager.saveTodo).not.toHaveBeenCalled();
    await expect(fs.promises.stat(path.join(inboxPath, item.manifestFile))).resolves.toBeTruthy();
    await expect(fs.promises.stat(path.join(inboxPath, item.audioFile))).resolves.toBeTruthy();
  });

  it("retries once after a cancelled renderer completion", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    const { databaseManager, manager, send } = createManager(userDataPath, { retryDelayMs: 0 });
    send
      .mockImplementationOnce((_channel, payload) => {
        queueMicrotask(() => manager.completeRequest(payload.requestId, { success: false }));
      })
      .mockImplementationOnce((_channel, payload) => {
        queueMicrotask(() =>
          manager.completeRequest(payload.requestId, { success: true, text: "Retried memo" })
        );
      });
    await manager.setInboxPath(inboxPath);

    await manager.scanNow();
    await manager.scanNow();

    expect(send).toHaveBeenCalledTimes(2);
    expect(databaseManager.saveTodo).toHaveBeenCalledOnce();
    await expect(fs.promises.stat(path.join(inboxPath, item.manifestFile))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.promises.stat(path.join(inboxPath, item.audioFile))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("waits for the renderer handshake before dispatching startup work", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    const { manager, send } = createManager(userDataPath);
    manager.markRendererUnavailable();
    await manager.setInboxPath(inboxPath);

    await manager.scanNow();

    expect(send).not.toHaveBeenCalled();
    await expect(fs.promises.stat(path.join(inboxPath, item.manifestFile))).resolves.toBeTruthy();

    send.mockImplementation((_channel, payload) => {
      queueMicrotask(() =>
        manager.completeRequest(payload.requestId, { success: true, text: "Ready now" })
      );
    });
    manager.markRendererReady();
    await manager.scanNow();
    expect(send).toHaveBeenCalledOnce();
  });

  it("keeps one pending job and accepts a retry only after renderer teardown", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    const { manager, send } = createManager(userDataPath, { retryDelayMs: 0 });
    let firstRequestId = "";
    send.mockImplementationOnce((_channel, payload) => {
      firstRequestId = payload.requestId;
    });
    await manager.setInboxPath(inboxPath);

    const firstScan = manager.scanNow();
    await vi.waitFor(() => expect(firstRequestId).not.toBe(""));
    void manager.scanNow();
    expect(send).toHaveBeenCalledOnce();

    manager.markRendererUnavailable();
    await firstScan;
    expect(manager.completeRequest(firstRequestId, { success: true, text: "Late" })).toEqual({
      success: false,
      stale: true,
    });

    send.mockImplementationOnce((_channel, payload) => {
      queueMicrotask(() =>
        manager.completeRequest(payload.requestId, { success: true, text: "Retried once" })
      );
    });
    manager.markRendererReady();
    await manager.scanNow();
    expect(send).toHaveBeenCalledTimes(2);
    await expect(fs.promises.stat(path.join(inboxPath, item.manifestFile))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("times out an unresponsive renderer request and permits retry", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    const { databaseManager, manager, send } = createManager(userDataPath, {
      processingTimeoutMs: 10,
      retryDelayMs: 0,
    });
    let timedOutRequestId = "";
    send
      .mockImplementationOnce((_channel, payload) => {
        timedOutRequestId = payload.requestId;
      })
      .mockImplementationOnce((_channel, payload) => {
        queueMicrotask(() =>
          manager.completeRequest(payload.requestId, {
            success: true,
            text: "Retried after timeout",
          })
        );
      });
    await manager.setInboxPath(inboxPath);

    await manager.scanNow();
    expect(manager.getStatus().state).toBe("retrying");
    expect(manager.completeRequest(timedOutRequestId, { success: true, text: "Late" })).toEqual({
      success: false,
      stale: true,
    });

    await manager.scanNow();
    expect(send).toHaveBeenCalledTimes(2);
    expect(databaseManager.saveTodo).toHaveBeenCalledOnce();
    await expect(fs.promises.stat(path.join(inboxPath, item.manifestFile))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("binds teardown to the current renderer generation when the main window is recreated", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    const { manager, windowManager } = createManager(userDataPath, { retryDelayMs: 0 });
    const firstWindow = createRendererWindow();
    windowManager.mainWindow = firstWindow;
    manager.observeRendererWindow(firstWindow);
    manager.markRendererReady();
    let firstRequestId = "";
    firstWindow.webContents.send.mockImplementation((_channel, payload) => {
      firstRequestId = payload.requestId;
    });
    await manager.setInboxPath(inboxPath);

    const firstScan = manager.scanNow();
    await vi.waitFor(() => expect(firstRequestId).not.toBe(""));

    const secondWindow = createRendererWindow();
    windowManager.mainWindow = secondWindow;
    manager.observeRendererWindow(secondWindow);
    await firstScan;
    expect(manager.completeRequest(firstRequestId, { success: true, text: "Stale" })).toEqual({
      success: false,
      stale: true,
    });

    secondWindow.webContents.send.mockImplementation((_channel, payload) => {
      queueMicrotask(() =>
        manager.completeRequest(payload.requestId, { success: true, text: "New renderer" })
      );
    });
    manager.markRendererReady();
    firstWindow.webContents.emit("did-start-loading");
    await manager.scanNow();

    expect(secondWindow.webContents.send).toHaveBeenCalledOnce();
    await expect(fs.promises.stat(path.join(inboxPath, item.audioFile))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("lets a partial manifest settle and then processes its completed replacement", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    await fs.promises.writeFile(path.join(inboxPath, item.manifestFile), "{");
    const { manager, send } = createManager(userDataPath, { retryDelayMs: 0 });
    send.mockImplementation((_channel, payload) => {
      queueMicrotask(() =>
        manager.completeRequest(payload.requestId, { success: true, text: "Settled memo" })
      );
    });
    await manager.setInboxPath(inboxPath);

    await manager.scanNow();
    expect(send).not.toHaveBeenCalled();
    await writeReadyItem(inboxPath);
    await manager.scanNow();

    expect(send).toHaveBeenCalledOnce();
    await expect(fs.promises.stat(path.join(inboxPath, item.manifestFile))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("eventually quarantines a stable audio hash mismatch", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    await fs.promises.writeFile(path.join(inboxPath, item.audioFile), Buffer.from("mobile budio"));
    const { manager, send } = createManager(userDataPath, {
      maxSettlingAttempts: 2,
      retryDelayMs: 0,
      settlingWindowMs: 0,
    });
    await manager.setInboxPath(inboxPath);

    await manager.scanNow();
    await manager.scanNow();

    expect(send).not.toHaveBeenCalled();
    await expect(
      fs.promises.stat(path.join(inboxPath, `${EXTERNAL_ID}.error.json`))
    ).resolves.toBeTruthy();
    await expect(fs.promises.stat(path.join(inboxPath, item.audioFile))).resolves.toBeTruthy();
  });

  it("binds cleanup to the original folder when the selection changes in flight", async () => {
    const first = await createWorkspace();
    const secondInbox = path.join(first.root, "second-inbox");
    await fs.promises.mkdir(secondInbox);
    const firstItem = await writeReadyItem(first.inboxPath);
    const secondItem = await writeReadyItem(secondInbox, Buffer.from("second audio"));
    const { manager, send } = createManager(first.userDataPath);
    let requestId = "";
    send.mockImplementation((_channel, payload) => {
      requestId = payload.requestId;
    });
    await manager.setInboxPath(first.inboxPath);

    const scan = manager.scanNow();
    await vi.waitFor(() => expect(requestId).not.toBe(""));
    await manager.setInboxPath(secondInbox);
    manager.completeRequest(requestId, { success: true, text: "First memo" });
    await scan;

    await expect(fs.promises.stat(path.join(first.inboxPath, firstItem.audioFile))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.promises.stat(path.join(secondInbox, secondItem.audioFile))).resolves.toBeTruthy();
    await expect(
      fs.promises.stat(path.join(secondInbox, secondItem.manifestFile))
    ).resolves.toBeTruthy();
  });

  it("keeps both files when an input is replaced before cleanup", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    const { databaseManager, manager, send } = createManager(userDataPath, { retryDelayMs: 0 });
    let requestId = "";
    send.mockImplementation((_channel, payload) => {
      requestId = payload.requestId;
    });
    await manager.setInboxPath(inboxPath);

    const scan = manager.scanNow();
    await vi.waitFor(() => expect(requestId).not.toBe(""));
    await fs.promises.writeFile(path.join(inboxPath, item.audioFile), Buffer.from("mobile budio"));
    manager.completeRequest(requestId, { success: true, text: "Saved safely" });
    await scan;

    expect(databaseManager.saveTodo).toHaveBeenCalledOnce();
    await expect(fs.promises.stat(path.join(inboxPath, item.audioFile))).resolves.toBeTruthy();
    await expect(fs.promises.stat(path.join(inboxPath, item.manifestFile))).resolves.toBeTruthy();
  });

  it("keeps both files when the manifest is replaced before cleanup", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    const { databaseManager, manager, send } = createManager(userDataPath, { retryDelayMs: 0 });
    let requestId = "";
    send.mockImplementation((_channel, payload) => {
      requestId = payload.requestId;
    });
    await manager.setInboxPath(inboxPath);

    const scan = manager.scanNow();
    await vi.waitFor(() => expect(requestId).not.toBe(""));
    const manifestPath = path.join(inboxPath, item.manifestFile);
    const original = await fs.promises.readFile(manifestPath, "utf8");
    await fs.promises.writeFile(manifestPath, `${original} `);
    manager.completeRequest(requestId, { success: true, text: "Saved safely" });
    await scan;

    expect(databaseManager.saveTodo).toHaveBeenCalledOnce();
    await expect(fs.promises.stat(path.join(inboxPath, item.audioFile))).resolves.toBeTruthy();
    await expect(fs.promises.stat(manifestPath)).resolves.toBeTruthy();
  });

  it("preserves a replacement pair published after cleanup atomically claims the originals", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    const audioPath = path.join(inboxPath, item.audioFile);
    const manifestPath = path.join(inboxPath, item.manifestFile);
    const replacementAudio = Buffer.from("new mobile audio");
    const replacementHash = crypto.createHash("sha256").update(replacementAudio).digest("hex");
    const replacementManifest = JSON.stringify({
      version: 1,
      externalId: EXTERNAL_ID,
      audioFile: item.audioFile,
      audioSha256: replacementHash,
      sizeBytes: replacementAudio.length,
      createdAt: "2026-07-18T03:04:05Z",
    });
    const rename = vi.fn(async (source: string, target: string) => {
      await fs.promises.rename(source, target);
      if (path.basename(source) === item.audioFile && target.includes(".echodraft-claim-")) {
        await fs.promises.writeFile(audioPath, replacementAudio);
      }
      if (path.basename(source) === item.manifestFile && target.includes(".echodraft-claim-")) {
        await fs.promises.writeFile(manifestPath, replacementManifest);
      }
    });
    const fsImpl = { ...fs, promises: { ...fs.promises, rename } };
    const { databaseManager, manager, send } = createManager(userDataPath, { fsImpl });
    send.mockImplementation((_channel, payload) => {
      queueMicrotask(() =>
        manager.completeRequest(payload.requestId, { success: true, text: "Original memo" })
      );
    });
    await manager.setInboxPath(inboxPath);

    await manager.scanNow();

    expect(databaseManager.saveTodo).toHaveBeenCalledOnce();
    await expect(fs.promises.readFile(audioPath)).resolves.toEqual(replacementAudio);
    await expect(fs.promises.readFile(manifestPath, "utf8")).resolves.toBe(replacementManifest);
  });

  it("retries audio deletion before removing the manifest", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    const audioPath = path.join(inboxPath, item.audioFile);
    const unlink = vi.fn(async (filePath: string) => {
      if (filePath.endsWith(item.audioFile) && unlink.mock.calls.length === 1) {
        const error = new Error("busy") as NodeJS.ErrnoException;
        error.code = "EBUSY";
        throw error;
      }
      await fs.promises.unlink(filePath);
    });
    const fsImpl = { ...fs, promises: { ...fs.promises, unlink } };
    const { databaseManager, manager, send } = createManager(userDataPath, {
      fsImpl,
      retryDelayMs: 0,
    });
    let saved = false;
    databaseManager.saveTodo.mockImplementation((payload) => {
      saved = true;
      return {
        success: true,
        created: true,
        todo: { id: 7, text: payload.text, meta: payload.meta, created_at: "now" },
      };
    });
    databaseManager.getTodoByExternalId.mockImplementation(() =>
      saved ? { meta: { mobileInbox: { audioSha256: item.audioSha256 } } } : null
    );
    send.mockImplementation((_channel, payload) => {
      queueMicrotask(() =>
        manager.completeRequest(payload.requestId, { success: true, text: "Saved memo" })
      );
    });
    await manager.setInboxPath(inboxPath);

    await manager.scanNow();
    await expect(fs.promises.stat(audioPath)).resolves.toBeTruthy();
    await expect(fs.promises.stat(path.join(inboxPath, item.manifestFile))).resolves.toBeTruthy();
    expect((await fs.promises.readdir(inboxPath)).filter((name) => name.includes("claim"))).toEqual(
      []
    );

    await manager.scanNow();
    expect(databaseManager.saveTodo).toHaveBeenCalledOnce();
    await expect(fs.promises.stat(audioPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.promises.stat(path.join(inboxPath, item.manifestFile))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("recovers on restart when manifest deletion failed after audio removal", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const item = await writeReadyItem(inboxPath);
    const manifestPath = path.join(inboxPath, item.manifestFile);
    const unlink = vi.fn(async (filePath: string) => {
      if (filePath.endsWith(item.manifestFile)) {
        const error = new Error("busy") as NodeJS.ErrnoException;
        error.code = "EBUSY";
        throw error;
      }
      await fs.promises.unlink(filePath);
    });
    const firstFs = { ...fs, promises: { ...fs.promises, unlink } };
    const first = createManager(userDataPath, { fsImpl: firstFs, retryDelayMs: 0 });
    first.send.mockImplementation((_channel, payload) => {
      queueMicrotask(() =>
        first.manager.completeRequest(payload.requestId, { success: true, text: "Saved memo" })
      );
    });
    await first.manager.setInboxPath(inboxPath);

    await first.manager.scanNow();
    await expect(fs.promises.stat(path.join(inboxPath, item.audioFile))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.promises.stat(manifestPath)).resolves.toBeTruthy();
    expect((await fs.promises.readdir(inboxPath)).filter((name) => name.includes("claim"))).toEqual(
      []
    );

    const restarted = createManager(userDataPath);
    restarted.databaseManager.getTodoByExternalId.mockReturnValue({
      meta: { mobileInbox: { audioSha256: item.audioSha256 } },
    });
    await restarted.manager.scanNow();
    await expect(fs.promises.stat(manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(restarted.send).not.toHaveBeenCalled();
  });

  it("continues to a valid item when quarantine is temporarily unavailable", async () => {
    const { inboxPath, userDataPath } = await createWorkspace();
    const first = await writeReadyItem(inboxPath);
    await fs.promises.writeFile(path.join(inboxPath, first.manifestFile), "not json");
    const second = await writeReadyItem(
      inboxPath,
      Buffer.from("second mobile audio"),
      SECOND_EXTERNAL_ID
    );
    const rename = vi.fn(async (source: string, target: string) => {
      if (source.endsWith(first.manifestFile)) {
        const error = new Error("locked") as NodeJS.ErrnoException;
        error.code = "EBUSY";
        throw error;
      }
      await fs.promises.rename(source, target);
    });
    const fsImpl = { ...fs, promises: { ...fs.promises, rename } };
    const { manager, send } = createManager(userDataPath, {
      fsImpl,
      maxSettlingAttempts: 1,
      retryDelayMs: 0,
      settlingWindowMs: 0,
    });
    send.mockImplementation((_channel, payload) => {
      queueMicrotask(() =>
        manager.completeRequest(payload.requestId, { success: true, text: "Second memo" })
      );
    });
    await manager.setInboxPath(inboxPath);

    await manager.scanNow();

    expect(send).toHaveBeenCalledWith(
      "mobile-inbox-process",
      expect.objectContaining({ externalId: SECOND_EXTERNAL_ID })
    );
    await expect(fs.promises.stat(path.join(inboxPath, first.manifestFile))).resolves.toBeTruthy();
    await expect(fs.promises.stat(path.join(inboxPath, second.manifestFile))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
