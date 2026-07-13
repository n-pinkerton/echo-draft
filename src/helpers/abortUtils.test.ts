import { describe, expect, it, vi } from "vitest";

const { abortableDelay, raceWithAbort, throwIfAborted } = require("./abortUtils");

describe("abortUtils", () => {
  it("rejects an abortable delay without waiting for its timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = abortableDelay(30_000, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("races shared work without cancelling the shared promise", async () => {
    const controller = new AbortController();
    let resolve!: (value: string) => void;
    const shared = new Promise<string>((next) => {
      resolve = next;
    });
    const pending = raceWithAbort(shared, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    resolve("finished");
    await expect(shared).resolves.toBe("finished");
  });

  it("throws immediately for a signal already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrow(/cancelled/i);
  });
});
