import { describe, expect, it, vi } from "vitest";

import { readSelectedAudioFile, registerAudioFileHandlers } from "./audioFileHandlers.js";

const stableStat = (overrides: Record<string, unknown> = {}) => ({
  isFile: () => true,
  size: 4,
  dev: 1,
  ino: 2,
  mtimeMs: 10,
  ctimeMs: 5,
  ...overrides,
});

const createFileHandle = (stats: any[] = [stableStat(), stableStat()]) => {
  const source = Buffer.from([1, 2, 3, 4]);
  let position = 0;
  return {
    stat: vi.fn(async () => stats.shift()),
    read: vi.fn(async (target: Buffer, offset: number, length: number) => {
      const bytesRead = Math.min(length, source.length - position);
      source.copy(target, offset, position, position + bytesRead);
      position += bytesRead;
      return { bytesRead, buffer: target };
    }),
    close: vi.fn(async () => {}),
  };
};

describe("audio file selection IPC", () => {
  it("reads asynchronously and returns no local filesystem path", async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const frame = { url: "file:///app/index.html?view=control-panel" };
    const sender = { mainFrame: frame, getURL: () => frame.url };
    const fileHandle = createFileHandle();
    const stat = vi.fn(async () => stableStat());
    const open = vi.fn(async () => fileHandle);
    registerAudioFileHandlers(
      {
        ipcMain: {
          handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
            handlers.set(channel, handler);
          }),
        },
        BrowserWindow: { getFocusedWindow: vi.fn() },
        dialog: {
          showOpenDialog: vi.fn(async () => ({
            canceled: false,
            filePaths: ["C:/private/voice.wav"],
          })),
        },
        fs: { promises: { stat, open } },
        path: {
          basename: () => "voice.wav",
          extname: () => ".wav",
        },
      } as any,
      {
        windowManager: {
          controlPanelWindow: {
            __echoDraftTrustedUrl: frame.url,
            webContents: sender,
            isDestroyed: () => false,
          },
        },
      } as any
    );

    const result = await handlers.get("select-audio-file-for-transcription")!({
      sender,
      senderFrame: frame,
    });
    expect(result).toMatchObject({
      success: true,
      displayName: "Selected WAV audio",
      extension: "wav",
      sizeBytes: 4,
    });
    expect(result).not.toHaveProperty("filePath");
    expect(result).not.toHaveProperty("fileName");
    expect(stat).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("C:/private/voice.wav", "r");
    expect(fileHandle.read).toHaveBeenCalledOnce();
    expect(fileHandle.close).toHaveBeenCalledOnce();
  });

  it("rejects path substitution after opening the selected file", async () => {
    const fileHandle = createFileHandle();
    const fs = {
      promises: {
        open: vi.fn(async () => fileHandle),
        stat: vi.fn(async () => stableStat({ ino: 99 })),
      },
    };

    await expect(readSelectedAudioFile(fs as any, "C:/private/voice.wav")).rejects.toThrow(
      /changed while it was being read/i
    );
    expect(fileHandle.close).toHaveBeenCalledOnce();
  });

  it("rejects in-place growth while reading through the stable handle", async () => {
    const fileHandle = createFileHandle([stableStat(), stableStat({ size: 5, mtimeMs: 11 })]);
    const fs = {
      promises: {
        open: vi.fn(async () => fileHandle),
        stat: vi.fn(async () => stableStat({ size: 5, mtimeMs: 11 })),
      },
    };

    await expect(readSelectedAudioFile(fs as any, "C:/private/voice.wav")).rejects.toThrow(
      /changed while it was being read/i
    );
    expect(fileHandle.close).toHaveBeenCalledOnce();
  });

  it("rejects symbolic links before opening a mobile inbox file", async () => {
    const fileHandle = createFileHandle();
    const fs = {
      promises: {
        lstat: vi.fn(async () =>
          stableStat({ isFile: () => false, isSymbolicLink: () => true })
        ),
        open: vi.fn(async () => fileHandle),
      },
    };

    await expect(
      readSelectedAudioFile(fs as any, "C:/private/voice.m4a", {
        maxBytes: 32 * 1024 * 1024,
        rejectSymbolicLinks: true,
      })
    ).rejects.toThrow(/regular file/i);
    expect(fs.promises.open).not.toHaveBeenCalled();
  });
});
