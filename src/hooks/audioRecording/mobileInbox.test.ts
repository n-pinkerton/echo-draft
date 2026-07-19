import { describe, expect, it, vi } from "vitest";

import { createMobileInboxCompletion, enqueueMobileInboxItem } from "./mobileInbox";

const ID = "550e8400-e29b-41d4-a716-446655440000";

describe("mobile inbox renderer bridge", () => {
  it("queues mobile audio in the shared AudioManager pipeline", () => {
    const enqueueProcessingJob = vi.fn();
    const upsertJob = vi.fn(() => ({ jobId: 4 }));

    const context = enqueueMobileInboxItem({
      audioManager: { enqueueProcessingJob },
      payload: {
        requestId: ID,
        externalId: ID,
        createdAt: "2026-07-18T02:03:04Z",
        mimeType: "audio/mp4",
        data: Uint8Array.from([1, 2, 3]),
      },
      removeJob: vi.fn(),
      upsertJob,
      now: () => 123,
    });

    expect(context).toMatchObject({
      sessionId: ID,
      jobId: 4,
      outputMode: "mobile-todo",
      mobileInboxRequestId: ID,
    });
    expect(enqueueProcessingJob).toHaveBeenCalledWith(
      expect.objectContaining({ size: 3, type: "audio/mp4" }),
      { source: "android" },
      context
    );
    expect(upsertJob).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ mobileInboxRequestId: ID, outputMode: "mobile-todo" })
    );
  });

  it("rejects unsupported or oversized payloads", () => {
    const base = {
      requestId: ID,
      externalId: ID,
      createdAt: "2026-07-18T02:03:04Z",
      mimeType: "audio/mp4",
      data: Uint8Array.from([1]),
    };
    const deps = {
      audioManager: { enqueueProcessingJob: vi.fn() },
      removeJob: vi.fn(),
      upsertJob: vi.fn(),
    };

    expect(() => enqueueMobileInboxItem({ ...deps, payload: { ...base, mimeType: "audio/wav" } }))
      .toThrow(/invalid/i);
    expect(() => enqueueMobileInboxItem({ ...deps, payload: { ...base, data: new Uint8Array(0) } }))
      .toThrow(/invalid/i);
  });

  it("preserves cleaned text when no valid title was returned", () => {
    expect(
      createMobileInboxCompletion(
        { success: true, text: "Cleaned memo", rawText: "raw memo", title: undefined },
        { provider: "openai", model: "gpt-4o-transcribe" }
      )
    ).toMatchObject({
      success: true,
      text: "Cleaned memo",
      rawText: "raw memo",
      title: undefined,
      provider: "openai",
      model: "gpt-4o-transcribe",
    });
  });
});
