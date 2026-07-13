import { describe, expect, it, vi } from "vitest";

const { parsePowerShellJsonOutput } = require("./powershellUtils");
const {
  activateInsertionTarget,
  captureInsertionTarget,
  resolveTargetLabel,
} = require("./insertionTarget");

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
        stdout:
          '{"success":true,"hwnd":42,"pid":7,"processStartTimeUtcTicks":"638800000000000000","processName":"foo","title":"bar"}',
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
        processStartTimeUtcTicks: "638800000000000000",
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

  it("activateInsertionTarget does not use SW_RESTORE when refocusing the target window", async () => {
    const runWindowsPowerShellScript = vi.fn(async (_script: string) => ({
      code: 0,
      stdout:
        '{"success":true,"phase":"complete","targetHwnd":42,"activeHwnd":42,"beforePid":7,"afterPid":7,"setForegroundReturned":true}',
      stderr: "",
    }));
    const manager = {
      deps: { platform: "win32" },
      runWindowsPowerShellScript,
      parsePowerShellJsonOutput,
    };

    const result = await activateInsertionTarget(manager, {
      hwnd: 42,
      pid: 7,
      processStartTimeUtcTicks: "638800000000000000",
    });

    expect(result).toEqual({
      success: true,
      details: {
        success: true,
        phase: "complete",
        targetHwnd: 42,
        activeHwnd: 42,
        beforePid: 7,
        afterPid: 7,
        setForegroundReturned: true,
      },
    });
    expect(runWindowsPowerShellScript).toHaveBeenCalledTimes(1);
    const [script] = runWindowsPowerShellScript.mock.calls[0];
    expect(script).not.toContain("ShowWindowAsync");
    expect(script).not.toContain("SW_RESTORE");
    expect(script).toContain("GetWindowThreadProcessId");
    expect(script).toContain('phase = "before_activation"');
    expect(script).toContain('"after_activation"');
    expect(runWindowsPowerShellScript.mock.calls[0].slice(1)).toEqual([
      ["42", "7", "638800000000000000"],
    ]);
  });

  it("rejects HWND reuse by a different process before activation", async () => {
    const runWindowsPowerShellScript = vi.fn(async () => ({
      code: 0,
      stdout: '{"success":false,"reason":"target_process_changed","phase":"before_activation"}',
      stderr: "",
    }));
    const manager = {
      deps: { platform: "win32" },
      runWindowsPowerShellScript,
      parsePowerShellJsonOutput,
    };

    await expect(
      activateInsertionTarget(manager, {
        hwnd: 42,
        pid: 7,
        processStartTimeUtcTicks: "638800000000000000",
      })
    ).resolves.toMatchObject({
      success: false,
      reason: "target_process_changed",
      details: { phase: "before_activation" },
    });
  });

  it("rejects HWND reuse by a different process after activation", async () => {
    const runWindowsPowerShellScript = vi.fn(async () => ({
      code: 0,
      stdout: '{"success":false,"reason":"target_process_changed","phase":"after_activation"}',
      stderr: "",
    }));
    const manager = {
      deps: { platform: "win32" },
      runWindowsPowerShellScript,
      parsePowerShellJsonOutput,
    };

    await expect(
      activateInsertionTarget(manager, {
        hwnd: 42,
        pid: 7,
        processStartTimeUtcTicks: "638800000000000000",
      })
    ).resolves.toMatchObject({
      success: false,
      reason: "target_process_changed",
      details: { phase: "after_activation" },
    });
  });
});
