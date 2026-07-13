import { describe, expect, it } from "vitest";

import { createApiRetryStrategy, withRetry } from "./retry";

describe("createApiRetryStrategy", () => {
  const strategy = createApiRetryStrategy();

  it("limits an API operation to one retry", () => {
    expect(strategy.maxRetries).toBe(1);
  });

  it("retries network and server errors", () => {
    expect(strategy.shouldRetry(new Error("network"))).toBe(true);
    expect(strategy.shouldRetry({ status: 408 })).toBe(true);
    expect(strategy.shouldRetry({ response: { status: 429 } })).toBe(true);
    expect(strategy.shouldRetry({ status: 503 })).toBe(true);
    expect(strategy.shouldRetry({ response: { status: 500 } })).toBe(true);
  });

  it("does not retry client errors", () => {
    expect(strategy.shouldRetry({ status: 404 })).toBe(false);
    expect(strategy.shouldRetry({ response: { status: 401 } })).toBe(false);
  });

  it("does not retry an aborted request", async () => {
    const abortError = new Error("cancelled");
    abortError.name = "AbortError";
    let calls = 0;

    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw abortError;
        },
        { maxRetries: 3, initialDelay: 1 }
      )
    ).rejects.toBe(abortError);
    expect(calls).toBe(1);
  });

  it("aborts an active retry delay before another attempt starts", async () => {
    const controller = new AbortController();
    let calls = 0;
    const pending = withRetry(
      async () => {
        calls += 1;
        throw new Error("network");
      },
      { maxRetries: 3, initialDelay: 30_000, signal: controller.signal }
    );

    await Promise.resolve();
    expect(calls).toBe(1);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });
});
