import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearLastSignInTime, updateLastSignInTime, withSessionRefresh } from "./neonAuth";

describe("withSessionRefresh cancellation", () => {
  beforeEach(() => {
    localStorage.clear();
    clearLastSignInTime();
  });

  it("cancels an auth grace-period wait before retrying the operation", async () => {
    updateLastSignInTime();
    const controller = new AbortController();
    const operation = vi.fn(async () => {
      throw Object.assign(new Error("Session expired"), { code: "AUTH_EXPIRED" });
    });

    const pending = withSessionRefresh(operation, { signal: controller.signal });
    await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(operation).toHaveBeenCalledOnce();
  });
});
