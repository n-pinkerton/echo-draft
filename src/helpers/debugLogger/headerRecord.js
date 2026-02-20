const os = require("os");

const buildHeaderRecord = ({
  app,
  logLevel,
  logsDir,
  logsDirSource,
  getInstallDir,
  redactEnvSnapshot,
  processModule = process,
  osModule = os,
}) => {
  try {
    const now = new Date();
    const tzOffsetMinutes = now.getTimezoneOffset();
    const exePath = (() => {
      try {
        return app.getPath("exe");
      } catch {
        return null;
      }
    })();

    return {
      type: "header",
      ts: now.toISOString(),
      tzOffsetMinutes,
      logLevel,
      logsDir,
      logsDirSource,
      app: {
        name: app.getName?.() || "EchoDraft",
        version: app.getVersion?.() || null,
        isPackaged: Boolean(app.isPackaged),
        appPath: (() => {
          try {
            return app.getAppPath();
          } catch {
            return null;
          }
        })(),
      },
      system: {
        platform: processModule.platform,
        arch: processModule.arch,
        release: osModule.release(),
        node: processModule.version,
        electron: processModule.versions?.electron,
        chrome: processModule.versions?.chrome,
        cpuCount: osModule.cpus?.()?.length || null,
        totalMemBytes: osModule.totalmem?.() || null,
        freeMemBytes: osModule.freemem?.() || null,
      },
      paths: {
        exePath,
        installDir: getInstallDir?.(),
        userData: (() => {
          try {
            return app.getPath("userData");
          } catch {
            return null;
          }
        })(),
        resourcesPath: processModule.resourcesPath || null,
      },
      env: {
        NODE_ENV: processModule.env?.NODE_ENV || null,
        OPENWHISPR_LOG_LEVEL: processModule.env?.OPENWHISPR_LOG_LEVEL || null,
      },
      settings: {
        env: redactEnvSnapshot(processModule.env || {}),
        rendererLocalStorage: "[PENDING]",
      },
    };
  } catch (error) {
    return {
      type: "header",
      ts: new Date().toISOString(),
      error: error?.message || String(error),
    };
  }
};

module.exports = { buildHeaderRecord };

