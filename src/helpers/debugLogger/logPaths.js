const path = require("path");

const getInstallDir = (app) => {
  try {
    const exePath = app.getPath("exe");
    if (exePath && typeof exePath === "string") {
      return path.dirname(exePath);
    }
  } catch {
    // Ignore
  }
  return null;
};

const getLogsDirCandidates = (app) => {
  const installDir = getInstallDir(app);
  const installLogsDir = installDir ? path.join(installDir, "logs") : null;
  const userDataLogsDir = path.join(app.getPath("userData"), "logs");

  const candidates = [];
  if (installLogsDir) {
    candidates.push({ dir: installLogsDir, source: "install" });
  }
  candidates.push({ dir: userDataLogsDir, source: "userData" });

  return candidates;
};

module.exports = { getInstallDir, getLogsDirCandidates };

