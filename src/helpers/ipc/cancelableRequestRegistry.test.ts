import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const {
  CancelableRequestRegistry,
  registerCancelableRequestHandler,
} = require("./cancelableRequestRegistry");

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

const createEvent = (id: number) => {
  const sender = new EventEmitter() as EventEmitter & { id: number };
  sender.id = id;
  return { sender };
};

describe("CancelableRequestRegistry", () => {
  it("scopes cancellation to the renderer that owns the request", () => {
    const registry = new CancelableRequestRegistry();
    const firstEvent = createEvent(1);
    const secondEvent = createEvent(2);
    const first = registry.createScope(firstEvent, REQUEST_ID);
    const second = registry.createScope(secondEvent, REQUEST_ID);

    expect(registry.cancel(firstEvent, REQUEST_ID)).toBe(true);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);

    first.finish();
    second.finish();
    expect(registry.activeCount).toBe(0);
  });

  it("honours cancellation that arrives before request registration", () => {
    const registry = new CancelableRequestRegistry();
    const event = createEvent(8);

    expect(registry.cancel(event, REQUEST_ID)).toBe(false);
    const scope = registry.createScope(event, REQUEST_ID);

    expect(scope.signal.aborted).toBe(true);
    scope.finish();
  });

  it("aborts and releases a scope when its renderer is destroyed", () => {
    const registry = new CancelableRequestRegistry();
    const event = createEvent(4);
    const scope = registry.createScope(event, REQUEST_ID);

    event.sender.emit("destroyed");

    expect(scope.signal.aborted).toBe(true);
    scope.finish();
    expect(registry.activeCount).toBe(0);
    expect(event.sender.listenerCount("destroyed")).toBe(0);
  });

  it("rejects malformed and duplicate request IDs", () => {
    const registry = new CancelableRequestRegistry();
    const event = createEvent(3);

    expect(() => registry.createScope(event, "../../not-valid")).toThrow(/valid/i);
    const scope = registry.createScope(event, REQUEST_ID);
    expect(() => registry.createScope(event, REQUEST_ID)).toThrow(/duplicate/i);
    scope.finish();
  });

  it("exposes a non-throwing IPC cancellation boundary", () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
        handlers.set(channel, handler);
      }),
    };
    const registry = new CancelableRequestRegistry();
    registerCancelableRequestHandler({ ipcMain }, { registry });
    const handler = handlers.get("cancel-ipc-request");

    expect(handler?.(createEvent(1), "invalid")).toMatchObject({
      success: false,
      code: "INVALID_REQUEST_ID",
    });
  });
});
