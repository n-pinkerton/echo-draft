import { describe, expect, it } from "vitest";

const {
  copyAudioStats,
  createAudioStats,
  recordChunkDropped,
  recordChunkReceived,
  recordChunkSent,
} = require("./audioStats");

describe("assemblyAiStreaming audioStats", () => {
  it("tracks received, dropped, and sent chunks", () => {
    const stats = createAudioStats();

    recordChunkReceived(stats, 10, 1000);
    expect(stats.chunksReceived).toBe(1);
    expect(stats.bytesReceived).toBe(10);
    expect(stats.firstChunkAt).toBe(1000);
    expect(stats.lastChunkAt).toBe(1000);

    recordChunkDropped(stats, 1100);
    expect(stats.chunksDropped).toBe(1);
    expect(stats.firstDropAt).toBe(1100);
    expect(stats.lastDropAt).toBe(1100);

    recordChunkSent(stats, 10, 5, 1200);
    expect(stats.chunksSent).toBe(1);
    expect(stats.bytesSent).toBe(10);
    expect(stats.lastBufferedAmount).toBe(5);
    expect(stats.maxBufferedAmount).toBe(5);

    recordChunkSent(stats, 1, 10, 1300);
    expect(stats.maxBufferedAmount).toBe(10);

    const snapshot = copyAudioStats(stats);
    expect(snapshot).toEqual(stats);
    expect(snapshot).not.toBe(stats);
  });
});

