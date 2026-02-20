const { CdpClient } = require("../cdpClient");
const { fetchJson } = require("../network");
const { assert, safeString, sleep } = require("../utils");

async function connectCdpTargets(port) {
  const versionUrl = `http://127.0.0.1:${port}/json/version`;
  let version = null;
  for (let i = 0; i < 60; i++) {
    try {
      version = await fetchJson(versionUrl, 1000);
      if (version) break;
    } catch {
      // retry
    }
    await sleep(250);
  }

  assert(version, "CDP server did not come up (json/version unavailable).");

  const listUrl = `http://127.0.0.1:${port}/json/list`;
  let targets = [];
  let panelTarget = null;
  let dictationTarget = null;
  for (let i = 0; i < 80; i++) {
    try {
      targets = await fetchJson(listUrl, 1000);
      if (Array.isArray(targets) && targets.length >= 1) {
        panelTarget = targets.find((t) => safeString(t.url).includes("panel=true"));
        dictationTarget = targets.find(
          (t) => t.type === "page" && safeString(t.url) && !safeString(t.url).includes("panel=true")
        );
        if (panelTarget?.webSocketDebuggerUrl && dictationTarget?.webSocketDebuggerUrl) {
          break;
        }
      }
    } catch {
      // retry
    }
    await sleep(250);
  }

  assert(Array.isArray(targets) && targets.length > 0, "No CDP targets found.");
  assert(panelTarget?.webSocketDebuggerUrl, "Control panel target not found (panel=true).");
  assert(dictationTarget?.webSocketDebuggerUrl, "Dictation panel target not found.");

  const panel = new CdpClient(panelTarget.webSocketDebuggerUrl);
  const dictation = new CdpClient(dictationTarget.webSocketDebuggerUrl);
  await panel.connect();
  await dictation.connect();

  // Skip onboarding in both windows
  const skipOnboarding = async (client) => {
    await client.eval(`
        (function () {
          try {
            localStorage.setItem("onboardingCompleted", "true");
            localStorage.setItem("onboardingCurrentStep", "5");
          } catch {}
          return true;
        })()
      `);
    await client.eval(`location.reload(); true;`);
  };

  await skipOnboarding(panel);
  await skipOnboarding(dictation);

  await panel.waitFor("document.readyState === 'complete'", 15000);
  await dictation.waitFor("document.readyState === 'complete'", 15000);

  // Wait for E2E helper to exist in dictation panel
  await dictation.waitFor("window.__openwhisprE2E && typeof window.__openwhisprE2E.getProgress === 'function'", 15000);

  return { panel, dictation };
}

module.exports = {
  connectCdpTargets,
};

