import { describe, expect, it, vi } from "vitest";

import { ProcessingQueue } from "./processingQueue";

describe("ProcessingQueue", () => {
  it("processes jobs sequentially and toggles processing state", async () => {
    const events: any[] = [];
    let isProcessing = false;

    const queue = new ProcessingQueue({
      logger: { error: vi.fn() },
      getIsProcessing: () => isProcessing,
      setIsProcessing: (value: boolean) => {
        isProcessing = value;
        events.push({ type: "processing", value });
      },
      setActiveContext: (context: any) => {
        events.push({ type: "context", id: context?.id ?? null });
      },
      processJob: vi.fn(async (_audioBlob: Blob, metadata: any, context: any) => {
        events.push({ type: "job", id: context?.id ?? null, x: metadata?.x ?? null });
      }),
    });

    const blob1 = new Blob([new Uint8Array([1])], { type: "audio/webm" });
    const blob2 = new Blob([new Uint8Array([2])], { type: "audio/webm" });

    expect(queue.enqueue(blob1, { x: 1 }, { id: "a" })).toEqual({
      jobsAhead: 0,
      position: 1,
    });
    expect(queue.enqueue(blob2, { x: 2 }, { id: "b" })).toEqual({
      jobsAhead: 1,
      position: 2,
    });

    await queue.whenIdle();

    const processingStates = events.filter((e) => e.type === "processing").map((e) => e.value);
    expect(processingStates).toEqual([true, false]);

    const jobIds = events.filter((e) => e.type === "job").map((e) => e.id);
    expect(jobIds).toEqual(["a", "b"]);
  });

  it("continues with later jobs when one queue job rejects unexpectedly", async () => {
    let isProcessing = false;
    const processed: string[] = [];
    const onJobError = vi.fn();
    const logger = { error: vi.fn() };
    const queue = new ProcessingQueue({
      logger,
      getIsProcessing: () => isProcessing,
      setIsProcessing: (value: boolean) => {
        isProcessing = value;
      },
      setActiveContext: vi.fn(),
      processJob: vi.fn(async (_audioBlob: Blob, _metadata: any, context: any) => {
        processed.push(context.id);
        if (context.id === "first") throw new Error("first failed");
      }),
      onJobError,
    });

    queue.enqueue(new Blob(["first"]), {}, { id: "first", sessionId: "s-1", jobId: 1 });
    queue.enqueue(new Blob(["second"]), {}, { id: "second", sessionId: "s-2", jobId: 2 });

    await queue.whenIdle();

    expect(processed).toEqual(["first", "second"]);
    expect(onJobError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "first failed" }),
      expect.objectContaining({ sessionId: "s-1", jobId: 1 })
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Processing queue job failed",
      expect.objectContaining({ sessionId: "s-1", jobId: 1 }),
      "audio"
    );
    expect(isProcessing).toBe(false);
  });

  it("does not begin or commit a later job before the earlier job finishes", async () => {
    let isProcessing = false;
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const events: string[] = [];
    const queue = new ProcessingQueue({
      logger: { error: vi.fn() },
      getIsProcessing: () => isProcessing,
      setIsProcessing: (value: boolean) => {
        isProcessing = value;
      },
      setActiveContext: vi.fn(),
      processJob: vi.fn(async (_audioBlob: Blob, _metadata: any, context: any) => {
        events.push(`start:${context.id}`);
        if (context.id === "first") await firstBlocked;
        events.push(`commit:${context.id}`);
      }),
    });

    queue.enqueue(new Blob(["first"]), {}, { id: "first" });
    queue.enqueue(new Blob(["second"]), {}, { id: "second" });
    await vi.waitFor(() => expect(events).toEqual(["start:first"]));

    releaseFirst();
    await queue.whenIdle();

    expect(events).toEqual(["start:first", "commit:first", "start:second", "commit:second"]);
  });

  it("runs a job queued after cancellation once the aborted runner settles", async () => {
    let isProcessing = false;
    let releaseFirst: (() => void) | null = null;
    const processed: string[] = [];

    const queue = new ProcessingQueue({
      logger: { error: vi.fn() },
      getIsProcessing: () => isProcessing,
      setIsProcessing: (value: boolean) => {
        isProcessing = value;
      },
      setActiveContext: vi.fn(),
      processJob: vi.fn(async (_audioBlob: Blob, _metadata: any, context: any) => {
        processed.push(context.id);
        if (context.id === "first") {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
      }),
    });

    queue.enqueue(new Blob(["first"]), {}, { id: "first" });
    await vi.waitFor(() => expect(processed).toEqual(["first"]));

    isProcessing = false;
    queue.cancel();
    queue.enqueue(new Blob(["second"]), {}, { id: "second" });
    releaseFirst?.();

    await vi.waitFor(() => expect(processed).toEqual(["first", "second"]));
    await queue.whenIdle();
    expect(isProcessing).toBe(false);
  });
});
