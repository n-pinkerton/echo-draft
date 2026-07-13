import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const {
  CancelableRequestRegistry,
  MAX_ACTIVE_REQUESTS_PER_SENDER,
  MAX_TOMBSTONES_PER_SENDER,
  MAX_TOMBSTONES_TOTAL,
  registerCancelableRequestHandler,
} = require("./cancelableRequestRegistry");

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

const createEvent = (id: number) => {
  const sender = new EventEmitter() as EventEmitter & { id: number };
  sender.id = id;
  (sender as any).getURL = () => "file:///app/index.html?view=dictation";
  (sender as any).mainFrame = { url: (sender as any).getURL() };
  return { sender, senderFrame: (sender as any).mainFrame };
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
    const event = createEvent(1);
    registerCancelableRequestHandler(
      { ipcMain },
      {
        registry,
        windowManager: {
          mainWindow: {
            __echoDraftTrustedUrl: (event.sender as any).getURL(),
            webContents: event.sender,
            isDestroyed: () => false,
          },
          controlPanelWindow: null,
        },
      }
    );
    const handler = handlers.get("cancel-ipc-request");

    expect(handler?.(event, "invalid")).toMatchObject({
      success: false,
      code: "INVALID_REQUEST_ID",
    });
  });

  it("bounds active requests and cancellation tombstones per renderer", () => {
    const registry = new CancelableRequestRegistry();
    const event = createEvent(9);
    const scopes = Array.from({ length: MAX_ACTIVE_REQUESTS_PER_SENDER }, (_, index) =>
      registry.createScope(event, `active-request-${String(index).padStart(3, "0")}`)
    );

    expect(event.sender.listenerCount("destroyed")).toBe(1);
    expect(() => registry.createScope(event, "active-request-over-limit")).toThrow(/too many/i);
    for (const scope of scopes) scope.finish();

    for (let index = 0; index < MAX_TOMBSTONES_PER_SENDER; index += 1) {
      registry.cancel(event, `cancel-request-${String(index).padStart(3, "0")}`);
    }
    expect(() => registry.cancel(event, "cancel-request-over-limit")).toThrow(/too many/i);
    expect(registry.tombstoneCount).toBe(MAX_TOMBSTONES_PER_SENDER);
  });

  it("preserves existing cancellation guarantees when the global cap is reached", () => {
    const registry = new CancelableRequestRegistry();
    const events = Array.from({ length: MAX_TOMBSTONES_TOTAL }, (_, index) =>
      createEvent(index + 100)
    );

    for (const event of events) registry.cancel(event, REQUEST_ID);

    const rejectedEvent = createEvent(10_000);
    expect(() => registry.cancel(rejectedEvent, REQUEST_ID)).toThrow(/too many/i);
    expect(registry.tombstoneCount).toBe(MAX_TOMBSTONES_TOTAL);
    expect(registry.senderStateCount).toBe(MAX_TOMBSTONES_TOTAL);
    expect(rejectedEvent.sender.listenerCount("destroyed")).toBe(0);

    const firstScope = registry.createScope(events[0], REQUEST_ID);
    expect(firstScope.signal.aborted).toBe(true);
    firstScope.finish();
    expect(events[0].sender.listenerCount("destroyed")).toBe(0);
    expect(registry.senderStateCount).toBe(MAX_TOMBSTONES_TOTAL - 1);
  });
});
