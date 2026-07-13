import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const setTheme = vi.fn();

vi.mock("./useSettings", () => ({
  useSettings: () => {
    throw new Error("useTheme must not initialize the full settings aggregate");
  },
}));

vi.mock("./settings/useThemeSettings", () => ({
  useThemeSettings: () => ({ theme: "dark", setTheme }),
}));

import { useTheme } from "./useTheme";

describe("useTheme", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    document.body.classList.remove("dark");
    vi.clearAllMocks();
  });

  it("initializes only theme settings and applies the selected theme", () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current).toEqual({ theme: "dark", setTheme });
    expect(document.documentElement).toHaveClass("dark");
    expect(document.body).toHaveClass("dark");
  });
});
