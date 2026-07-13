import { describe, expect, it } from "vitest";

import { createApiRetryStrategy } from "./retry";

describe("createApiRetryStrategy", () => {
  const strategy = createApiRetryStrategy();

  it("retries network and server errors", () => {
    expect(strategy.shouldRetry(new Error("network"))).toBe(true);
    expect(strategy.shouldRetry({ status: 503 })).toBe(true);
    expect(strategy.shouldRetry({ response: { status: 500 } })).toBe(true);
  });

  it("does not retry client errors", () => {
    expect(strategy.shouldRetry({ status: 404 })).toBe(false);
    expect(strategy.shouldRetry({ response: { status: 401 } })).toBe(false);
  });
});
