import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_IMPORTED_DICTIONARY_BYTES,
  readStableDictionaryFile,
  registerDictionaryHandlers,
} from "./dictionaryHandlers.js";

const stats = (size: number, ino = 10, file = true) => ({
  size,
  mtimeMs: 1234,
  dev: 1,
  ino,
  isFile: () => file,
  isSymbolicLink: () => false,
});

function createReadHarness(data: Buffer, beforeSize = data.length, pathIno = 10) {
  const handle = {
    stat: vi.fn(async () => stats(beforeSize)),
    read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
      const available = Math.max(0, Math.min(length, data.length - position));
      if (available) data.copy(buffer, offset, position, position + available);
      return { bytesRead: available, buffer };
    }),
    close: vi.fn(async () => {}),
  };
  let finalPathReads = 0;
  const fakeFs = {
    constants: { O_RDONLY: 0, O_NOFOLLOW: 0 },
    promises: {
      open: vi.fn(async () => handle),
      lstat: vi.fn(async (candidate: string) => {
        if (candidate.toLowerCase().endsWith("dict.txt")) {
          finalPathReads += 1;
          return stats(beforeSize, finalPathReads >= 2 ? pathIno : 10);
        }
        return stats(0, 1, false);
      }),
    },
  };
  return { fakeFs, handle };
}

describe("dictionary import trust boundary", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-dictionary-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("imports from a stable handle and returns only the selected basename", async () => {
    const filePath = path.join(tempRoot, "private-dictionary.txt");
    fs.writeFileSync(filePath, "EchoDraft\nKubernetes\nEchoDraft\nsend every secret", "utf8");
    const handlers = new Map<string, (...args: any[]) => any>();
    const sender: any = { id: 5, getURL: () => "file:///app/index.html?view=control-panel" };
    sender.mainFrame = { url: sender.getURL() };
    registerDictionaryHandlers(
      {
        ipcMain: { handle: (channel: string, handler: any) => handlers.set(channel, handler) },
        app: { getPath: vi.fn() },
        BrowserWindow: { getFocusedWindow: vi.fn() },
        dialog: {
          showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [filePath] })),
        },
        fs,
        path,
      } as any,
      {
        databaseManager: { getDictionary: vi.fn(), setDictionary: vi.fn() },
        windowManager: {
          controlPanelWindow: {
            __echoDraftTrustedUrl: sender.getURL(),
            webContents: sender,
            isDestroyed: () => false,
          },
        },
      } as any
    );

    const result = await handlers.get("db-import-dictionary-file")?.({
      sender,
      senderFrame: sender.mainFrame,
    });

    expect(result).toMatchObject({
      success: true,
      filePath: "private-dictionary.txt",
      words: ["EchoDraft", "Kubernetes"],
      parsedCount: 4,
      uniqueCount: 2,
      unsupportedRemoved: 1,
    });
    expect(JSON.stringify(result)).not.toContain(tempRoot);
  });

  it("rejects oversize, growing, truncated, replaced, and linked sources", async () => {
    const oversize = createReadHarness(Buffer.alloc(0), MAX_IMPORTED_DICTIONARY_BYTES + 1);
    await expect(
      readStableDictionaryFile(
        { fs: oversize.fakeFs as any, path: path.win32 },
        "C:\\safe\\dict.txt"
      )
    ).rejects.toThrow(/1 MB limit/i);

    const growing = createReadHarness(Buffer.from("abcd"), 3);
    await expect(
      readStableDictionaryFile(
        { fs: growing.fakeFs as any, path: path.win32 },
        "C:\\safe\\dict.txt"
      )
    ).rejects.toThrow(/changed/i);

    const truncated = createReadHarness(Buffer.from("ab"), 3);
    await expect(
      readStableDictionaryFile(
        { fs: truncated.fakeFs as any, path: path.win32 },
        "C:\\safe\\dict.txt"
      )
    ).rejects.toThrow(/changed/i);

    const replaced = createReadHarness(Buffer.from("abc"), 3, 99);
    await expect(
      readStableDictionaryFile(
        { fs: replaced.fakeFs as any, path: path.win32 },
        "C:\\safe\\dict.txt"
      )
    ).rejects.toThrow(/changed/i);

    const linked = createReadHarness(Buffer.from("abc"));
    linked.fakeFs.promises.lstat.mockImplementation(async (candidate: string) => ({
      ...stats(0, 1, false),
      isSymbolicLink: () => candidate.toLowerCase().endsWith("safe"),
    }));
    await expect(
      readStableDictionaryFile({ fs: linked.fakeFs as any, path: path.win32 }, "C:\\safe\\dict.txt")
    ).rejects.toThrow(/linked dictionary paths/i);
  });
});
