import { beforeEach, describe, expect, it, vi } from "vitest";

import { invokeCancelableIpc } from "./cancelableIpc";

describe("invokeCancelableIpc", () => {
  beforeEach(() => {
    (window as any).electronAPI = {
      cancelIpcRequest: vi.fn(async () => ({ success: true })),
    };
  });

  it("uses one request ID for invocation and cancellation", async () => {
    const controller = new AbortController();
    let resolveInvocation: ((value: string) => void) | undefined;
    const invoke = vi.fn(
      async (_requestId: string) =>
        await new Promise<string>((resolve) => {
          resolveInvocation = resolve;
        })
    );

    const pending = invokeCancelableIpc(controller.signal, invoke);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    const requestId = invoke.mock.calls[0][0];

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect((window as any).electronAPI.cancelIpcRequest).toHaveBeenCalledWith(requestId);

    resolveInvocation?.("late result");
  });

  it("does not require a cancellation API for an already-aborted request", async () => {
    delete (window as any).electronAPI.cancelIpcRequest;
    const controller = new AbortController();
    controller.abort();
    const invoke = vi.fn(async () => "unused");

    await expect(invokeCancelableIpc(controller.signal, invoke)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
