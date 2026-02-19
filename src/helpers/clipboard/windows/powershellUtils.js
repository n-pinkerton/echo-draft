function runWindowsPowerShellScript(manager, script, args = []) {
  const { spawn } = manager.deps;
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

    processHandle.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    processHandle.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    processHandle.on("error", (error) => {
      reject(error);
    });

    processHandle.on("close", (code) => {
      resolve({
        code,
        stdout,
        stderr,
      });
    });
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
  parsePowerShellJsonOutput,
  runWindowsPowerShellScript,
};

