import { describe, expect, it } from "vitest";

const { parsePowerShellJsonOutput } = require("./powershellUtils");
const { activateInsertionTarget, captureInsertionTarget, resolveTargetLabel } = require("./insertionTarget");

describe("insertionTarget", () => {
  it("resolveTargetLabel prefers process + title then falls back", () => {
    expect(resolveTargetLabel({ processName: "foo", title: "bar" })).toBe("foo (bar)");
    expect(resolveTargetLabel({ processName: "foo" })).toBe("foo");
    expect(resolveTargetLabel({ title: "bar" })).toBe("bar");
    expect(resolveTargetLabel({})).toBe("original app");
  });

  it("captureInsertionTarget returns a normalized target on success", async () => {
    const manager = {
      deps: { platform: "win32", now: () => 123 },
      runWindowsPowerShellScript: async () => ({
        code: 0,
        stdout: '{"success":true,"hwnd":42,"pid":7,"processName":"foo","title":"bar"}',
        stderr: "",
      }),
      parsePowerShellJsonOutput,
    };

    const result = await captureInsertionTarget(manager);
    expect(result).toEqual({
      success: true,
      target: {
        hwnd: 42,
        pid: 7,
        processName: "foo",
        title: "bar",
        capturedAt: 123,
      },
    });
  });

  it("activateInsertionTarget rejects invalid hwnds", async () => {
    const manager = {
      deps: { platform: "win32" },
      runWindowsPowerShellScript: async () => ({ code: 0, stdout: "", stderr: "" }),
      parsePowerShellJsonOutput,
    };

    expect(await activateInsertionTarget(manager, {})).toEqual({
      success: false,
      reason: "invalid_target",
    });
  });
});

