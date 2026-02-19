import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const { parsePowerShellJsonOutput, runWindowsPowerShellScript } = require("./powershellUtils");

describe("powershellUtils", () => {
  it("parsePowerShellJsonOutput returns the last JSON-looking line", () => {
    const stdout = "noise\n{\"success\":true}\n";
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
});

