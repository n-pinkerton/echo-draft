import { describe, expect, it } from "vitest";

const { getForegroundWindowInfo, parseForegroundWindowResult } = require("./foreground.js");
const { psJson } = require("./powershell.js");

describe("foreground window result parsing", () => {
  it("returns a valid foreground window", () => {
    expect(
      parseForegroundWindowResult({
        code: 0,
        stdout: "",
        stderr: "",
        parsed: { success: true, hwnd: 42, pid: 84, processName: "notepad" },
      })
    ).toMatchObject({ hwnd: 42, processName: "notepad" });
  });

  it("allows an explicitly empty desktop for safe non-interactive gates", () => {
    expect(
      parseForegroundWindowResult(
        {
          code: 0,
          stdout: '{"success":false,"reason":"no_foreground_window"}',
          stderr: "",
          parsed: { success: false, reason: "no_foreground_window" },
        },
        { allowMissing: true }
      )
    ).toBeNull();
  });

  it("still fails closed for unexpected helper failures", () => {
    expect(() =>
      parseForegroundWindowResult(
        {
          code: 0,
          stdout: '{"success":false,"reason":"access_denied"}',
          stderr: "",
          parsed: { success: false, reason: "access_denied" },
        },
        { allowMissing: true }
      )
    ).toThrow(/returned failure/);
  });

  it("rejects a successful result without a resolved process identity", () => {
    expect(() =>
      parseForegroundWindowResult(
        {
          code: 0,
          stdout: '{"success":true,"hwnd":42,"pid":84,"processName":""}',
          stderr: "",
          parsed: { success: true, hwnd: 42, pid: 84, processName: "" },
        },
        { allowMissing: true }
      )
    ).toThrow(/invalid window identity/);
  });

  it.runIf(process.platform === "win32")(
    "matches an independent Windows foreground PID lookup",
    async () => {
      const independentScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WinApiFgIndependent {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$foregroundHandle = [WinApiFgIndependent]::GetForegroundWindow()
if ($foregroundHandle -eq [IntPtr]::Zero) {
  [pscustomobject]@{ success = $false; reason = "no_foreground_window" } | ConvertTo-Json -Compress
  exit 0
}
$ownerProcessId = 0
[void][WinApiFgIndependent]::GetWindowThreadProcessId($foregroundHandle, [ref]$ownerProcessId)
[pscustomobject]@{
  success = ($ownerProcessId -gt 0)
  hwnd = [Int64]$foregroundHandle
  pid = [Int32]$ownerProcessId
} | ConvertTo-Json -Compress
`.trim();

      for (let attempt = 0; attempt < 4; attempt += 1) {
        const [actual, independent] = await Promise.all([
          getForegroundWindowInfo({ allowMissing: true }),
          psJson(independentScript),
        ]);
        expect(independent.code).toBe(0);
        if (!actual && independent.parsed?.reason === "no_foreground_window") return;
        if (
          actual &&
          independent.parsed?.success &&
          Number(actual.hwnd) === Number(independent.parsed.hwnd)
        ) {
          expect(actual.pid).toBe(independent.parsed.pid);
          return;
        }
      }

      throw new Error("The foreground window changed during every independent PID comparison.");
    },
    20_000
  );
});
