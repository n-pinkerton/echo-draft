async function checkHotkeysRegistered(panel, record) {
  const hotkeyStatus = await panel.eval(`
      (async function () {
        if (!window.electronAPI?.e2eGetHotkeyStatus) {
          return { success: false, error: "e2eGetHotkeyStatus unavailable" };
        }
        const candidates = ["F8", "F9", "F10", "F11", "F12", "ScrollLock"];
        let last = null;

        for (const insertHotkey of candidates) {
          try {
            await window.electronAPI.updateHotkey(insertHotkey);
          } catch {}

          for (const clipboardHotkey of candidates) {
            if (clipboardHotkey === insertHotkey) continue;
            try {
              await window.electronAPI.updateClipboardHotkey(clipboardHotkey);
            } catch {}

            await new Promise((r) => setTimeout(r, 600));
            const status = await window.electronAPI.e2eGetHotkeyStatus();
            const ok =
              Boolean(status?.insertGlobalRegistered) &&
              Boolean(status?.clipboardGlobalRegistered) &&
              status?.insertHotkey === insertHotkey &&
              status?.clipboardHotkey === clipboardHotkey;

            last = { chosen: { insertHotkey, clipboardHotkey }, status, ok };
            if (ok) {
              return { success: true, ...last };
            }
          }
        }

        return { success: false, ...last, error: "Failed to register two distinct global hotkeys" };
      })()
    `);

  record(
    "Hotkeys registered (insert+clipboard)",
    Boolean(hotkeyStatus?.success) && Boolean(hotkeyStatus?.ok),
    JSON.stringify({
      success: hotkeyStatus?.success,
      chosen: hotkeyStatus?.chosen,
      ok: hotkeyStatus?.ok,
      status: hotkeyStatus?.status,
      error: hotkeyStatus?.error,
    })
  );

  return hotkeyStatus;
}

module.exports = {
  checkHotkeysRegistered,
};

