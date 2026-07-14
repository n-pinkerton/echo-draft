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
            const result = await window.electronAPI.updateHotkey(insertHotkey);
            if (result?.success) window.electronAPI.notifyHotkeyChanged?.(insertHotkey);
          } catch {}

          for (const clipboardHotkey of candidates) {
            if (clipboardHotkey === insertHotkey) continue;
            try {
              const result = await window.electronAPI.updateClipboardHotkey(clipboardHotkey);
              if (result?.success) {
                window.electronAPI.notifyClipboardHotkeyChanged?.(clipboardHotkey);
              }
            } catch {}

            await new Promise((r) => setTimeout(r, 900));
            const status = await window.electronAPI.e2eGetHotkeyStatus();
            const insertReady = status?.insertUsesNativeListener
              ? Boolean(status?.insertNativeReady) && !status?.insertGlobalRegistered
              : Boolean(status?.insertGlobalRegistered);
            const clipboardReady = status?.clipboardUsesNativeListener
              ? Boolean(status?.clipboardNativeReady) && !status?.clipboardGlobalRegistered
              : Boolean(status?.clipboardGlobalRegistered);
            const ok =
              insertReady &&
              clipboardReady &&
              status?.insertHotkey === insertHotkey &&
              status?.clipboardHotkey === clipboardHotkey;

            last = {
              chosen: { insertHotkey, clipboardHotkey },
              status,
              insertReady,
              clipboardReady,
              ok,
            };
            if (ok) {
              return { success: true, ...last };
            }
          }
        }

        return {
          success: false,
          ...last,
          error: "Failed to activate two distinct focus-independent hotkey routes",
        };
      })()
    `);

  record(
    "Hotkeys active outside EchoDraft (insert+clipboard)",
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
