async function checkPushToTalkRouting(panel, record) {
  const pttStatus = await panel.eval(`
      (async function () {
        if (!window.electronAPI?.saveActivationMode) {
          return { success: false, error: "saveActivationMode unavailable" };
        }
        if (!window.electronAPI?.notifyActivationModeChanged) {
          return { success: false, error: "notifyActivationModeChanged unavailable" };
        }
        if (!window.electronAPI?.e2eGetHotkeyStatus) {
          return { success: false, error: "e2eGetHotkeyStatus unavailable" };
        }

        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const setMode = async (mode) => {
          try { await window.electronAPI.saveActivationMode(mode); } catch {}
          try { window.electronAPI.notifyActivationModeChanged(mode); } catch {}
        };

        const waitFor = async (predicate, timeoutMs = 12000) => {
          const startedAt = Date.now();
          let last = null;
          while (Date.now() - startedAt < timeoutMs) {
            try {
              last = await predicate();
              if (last?.ok) return last;
            } catch (e) {
              last = { ok: false, error: (e && e.message) ? e.message : String(e) };
            }
            await sleep(250);
          }
          return last || { ok: false };
        };

        await setMode("push");
        const push = await waitFor(async () => {
          const status = await window.electronAPI.e2eGetHotkeyStatus();
          const ok =
            status?.activationMode === "push" &&
            Boolean(status?.insertUsesNativeListener) &&
            Boolean(status?.clipboardUsesNativeListener) &&
            Boolean(status?.windowsPushToTalkAvailable);
          return {
            ok,
            activationMode: status?.activationMode,
            insertUsesNativeListener: status?.insertUsesNativeListener,
            clipboardUsesNativeListener: status?.clipboardUsesNativeListener,
            windowsPushToTalkAvailable: status?.windowsPushToTalkAvailable,
          };
        }, 15000);

        await setMode("tap");
        const tap = await waitFor(async () => {
          const status = await window.electronAPI.e2eGetHotkeyStatus();
          const ok =
            status?.activationMode === "tap" &&
            Boolean(status?.insertGlobalRegistered) &&
            Boolean(status?.clipboardGlobalRegistered);
          return {
            ok,
            activationMode: status?.activationMode,
            insertGlobalRegistered: status?.insertGlobalRegistered,
            clipboardGlobalRegistered: status?.clipboardGlobalRegistered,
          };
        }, 15000);

        return { success: true, ok: Boolean(push?.ok) && Boolean(tap?.ok), push, tap };
      })()
    `);

  record(
    "Push-to-talk mode uses native listener (both routes)",
    Boolean(pttStatus?.success) && Boolean(pttStatus?.ok),
    JSON.stringify(pttStatus)
  );

  return pttStatus;
}

module.exports = {
  checkPushToTalkRouting,
};

