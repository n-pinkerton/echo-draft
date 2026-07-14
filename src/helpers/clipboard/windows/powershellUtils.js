const WINDOWS_POWERSHELL_TIMEOUT_MS = 5_000;
const MAX_POWERSHELL_OUTPUT_CHARS = 16_384;

function runWindowsPowerShellScript(manager, script, args = []) {
  const { spawn, terminateProcessTreeAndWait } = manager.deps;
  return new Promise((resolve, reject) => {
    const wrappedScript = `& {\n${script}\n}`;
    const psArgs = [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      wrappedScript,
      ...args.map((arg) => String(arg)),
    ];

    const processHandle = spawn("powershell.exe", psArgs);
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeoutId = null;
    const appendBounded = (current, data) =>
      `${current}${data?.toString?.() || ""}`.slice(-MAX_POWERSHELL_OUTPUT_CHARS);
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      callback();
    };

    processHandle.stdout?.on("data", (data) => {
      stdout = appendBounded(stdout, data);
    });
    processHandle.stderr?.on("data", (data) => {
      stderr = appendBounded(stderr, data);
    });

    processHandle.on("error", (error) => {
      finish(() => reject(error));
    });

    processHandle.on("close", (code) => {
      finish(() =>
        resolve({
          code,
          stdout,
          stderr,
          timedOut: false,
        })
      );
    });

    timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      void (async () => {
        let terminationConfirmed = false;
        try {
          if (typeof terminateProcessTreeAndWait === "function") {
            terminationConfirmed =
              (await terminateProcessTreeAndWait(processHandle, "SIGKILL")) === true;
          }
        } catch {
          terminationConfirmed = false;
        }
        resolve({
          code: -1,
          stdout,
          stderr: terminationConfirmed
            ? "PowerShell operation timed out"
            : "PowerShell operation timed out and termination was not confirmed",
          terminationConfirmed,
          timedOut: true,
        });
      })();
    }, WINDOWS_POWERSHELL_TIMEOUT_MS);
  });
}

function parsePowerShellJsonOutput(stdout = "") {
  const trimmed = (stdout || "").trim();
  if (!trimmed) {
    return null;
  }
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim());
  const candidate = [...lines]
    .reverse()
    .find((line) => line.startsWith("{") || line.startsWith("["));
  if (!candidate) {
    return null;
  }
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

module.exports = {
  MAX_POWERSHELL_OUTPUT_CHARS,
  WINDOWS_POWERSHELL_TIMEOUT_MS,
  parsePowerShellJsonOutput,
  runWindowsPowerShellScript,
};
