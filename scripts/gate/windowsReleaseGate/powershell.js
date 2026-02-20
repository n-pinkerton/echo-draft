const { spawn: defaultSpawn } = require("child_process");

const { safeString } = require("./utils");

async function runPowerShell(script, args = [], options = {}) {
  const {
    sta = false,
    timeoutMs = 15000,
    stdin = null,
    spawn = defaultSpawn,
  } = options;

  const wrappedScript = `& {\n${script}\n}`;
  const psArgs = [
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    ...(sta ? ["-STA"] : []),
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    wrappedScript,
    ...args.map((arg) => String(arg)),
  ];

  const child = spawn("powershell.exe", psArgs, { windowsHide: true });

  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (data) => {
    stdout += data.toString();
  });

  child.stderr?.on("data", (data) => {
    stderr += data.toString();
  });

  if (stdin !== null && stdin !== undefined) {
    try {
      child.stdin?.write(String(stdin));
    } catch {
      // ignore
    }
    try {
      child.stdin?.end();
    } catch {
      // ignore
    }
  }

  const exitResult = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      reject(new Error(`PowerShell timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

  return exitResult;
}

function parseJsonFromStdout(stdout) {
  const trimmed = safeString(stdout).trim();
  if (!trimmed) return null;
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim());
  const candidate = [...lines].reverse().find((line) => line.startsWith("{") || line.startsWith("["));
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

async function psJson(script, args = [], options = {}) {
  const result = await runPowerShell(script, args, options);
  const parsed = parseJsonFromStdout(result.stdout);
  return { ...result, parsed };
}

module.exports = {
  parseJsonFromStdout,
  psJson,
  runPowerShell,
};

