import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const {
  WINDOWS_POWERSHELL_TIMEOUT_MS,
  parsePowerShellJsonOutput,
  runWindowsPowerShellScript,
} = require("./powershellUtils");

describe("powershellUtils", () => {
  it("parsePowerShellJsonOutput returns the last JSON-looking line", () => {
    const stdout = 'noise\n{"success":true}\n';
    expect(parsePowerShellJsonOutput(stdout)).toEqual({ success: true });
  });

  it("parsePowerShellJsonOutput returns null when no JSON is present", () => {
    expect(parsePowerShellJsonOutput("hello")).toBeNull();
  });

  it("runWindowsPowerShellScript wraps scripts and appends args", async () => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    const spawn = vi.fn((_cmd: string, _args: string[]) => {
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });

    const manager = { deps: { spawn } };
    await runWindowsPowerShellScript(manager, "Write-Output 'ok'", [123]);

    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawn.mock.calls[0];
    expect(cmd).toBe("powershell.exe");
    expect(args).toContain("-Command");
    expect(args.join(" ")).toContain("& {");
    expect(args.at(-1)).toBe("123");
  });

  it("terminates and settles a PowerShell child that never closes", async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      let confirmTermination: (value: boolean) => void = () => {};
      const termination = new Promise<boolean>((resolve) => {
        confirmTermination = resolve;
      });
      const terminateProcessTreeAndWait = vi.fn(() => termination);
      const manager = {
        deps: {
          spawn: vi.fn(() => child),
          terminateProcessTreeAndWait,
        },
      };

      const resultPromise = runWindowsPowerShellScript(manager, "Start-Sleep -Seconds 60");
      let settled = false;
      void resultPromise.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(WINDOWS_POWERSHELL_TIMEOUT_MS);
      expect(settled).toBe(false);
      confirmTermination(true);

      await expect(resultPromise).resolves.toEqual({
        code: -1,
        stdout: "",
        stderr: "PowerShell operation timed out",
        terminationConfirmed: true,
        timedOut: true,
      });
      expect(terminateProcessTreeAndWait).toHaveBeenCalledWith(child, "SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });
});
