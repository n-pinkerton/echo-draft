import { StrictMode, type PropsWithChildren } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLocalStorage } from "./useLocalStorage";

describe("useLocalStorage", () => {
  beforeEach(() => localStorage.clear());

  it("keeps hook instances for the same key synchronized in one window", async () => {
    const first = renderHook(() => useLocalStorage("shared-setting", "initial"));
    const second = renderHook(() => useLocalStorage("shared-setting", "initial"));

    act(() => first.result.current[1]("updated"));

    await waitFor(() => expect(second.result.current[0]).toBe("updated"));
    expect(localStorage.getItem("shared-setting")).toBe('"updated"');
  });

  it("supports consecutive functional updates under Strict Mode without duplicate events", async () => {
    const dispatchEvent = vi.spyOn(window, "dispatchEvent");
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
    const hook = renderHook(() => useLocalStorage("counter", 0), { wrapper });

    act(() => {
      hook.result.current[1]((value) => value + 1);
      hook.result.current[1]((value) => value + 1);
    });

    expect(hook.result.current[0]).toBe(2);
    await waitFor(() => expect(dispatchEvent).toHaveBeenCalledTimes(2));
    for (const [event] of dispatchEvent.mock.calls) {
      expect((event as CustomEvent).detail).toEqual({ key: "counter" });
    }
  });

  it("accepts native storage events from another renderer", () => {
    const hook = renderHook(() => useLocalStorage("shared-setting", "initial"));

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "shared-setting", newValue: '"external"' })
      );
    });

    expect(hook.result.current[0]).toBe("external");
  });

  it("resets every mounted setting after another renderer clears storage", () => {
    const first = renderHook(() => useLocalStorage("first-setting", "first-default"));
    const second = renderHook(() => useLocalStorage("second-setting", "second-default"));
    act(() => {
      first.result.current[1]("changed-first");
      second.result.current[1]("changed-second");
    });

    act(() => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null, newValue: null }));
    });

    expect(first.result.current[0]).toBe("first-default");
    expect(second.result.current[0]).toBe("second-default");
  });

  it("synchronizes removals back to the default value", async () => {
    const first = renderHook(() => useLocalStorage("shared-setting", "initial"));
    const second = renderHook(() => useLocalStorage("shared-setting", "initial"));

    act(() => first.result.current[1]("updated"));
    await waitFor(() => expect(second.result.current[0]).toBe("updated"));
    act(() => first.result.current[2]());

    await waitFor(() => expect(second.result.current[0]).toBe("initial"));
    expect(localStorage.getItem("shared-setting")).toBeNull();
  });
});
