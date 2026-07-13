const { assert, isTruthyFlag, safeString, sleep } = require("../utils");

const {
  getClipboardImageHash,
  getClipboardText,
  setClipboardTestImage,
} = require("../clipboardTools");
const { ensureForegroundWindow, getForegroundWindowInfo, readEditText } = require("../foreground");
const {
  closeProcess,
  requestGateTextWindowFocus,
  startGateTextWindow,
  startTextTarget,
} = require("../windowsTargets");

function isClipboardFallbackTrayStatus(status) {
  return (
    status?.stage === "warning" &&
    status?.stageLabel === "Delivered with warning" &&
    typeof status?.message === "string" &&
    status.message.toLowerCase().includes("kept in clipboard") &&
    typeof status?.statusLabel === "string" &&
    status.statusLabel.toLowerCase().includes("delivered with warning")
  );
}

async function createAuthenticatedInsertionCapture(dictation) {
  return await dictation.eval(`
    (async function () {
      if (!window.electronAPI.e2eCreateDictationSession) {
        return { success: false, reason: "e2e session API unavailable" };
      }
      const session = await window.electronAPI.e2eCreateDictationSession("insert");
      const capture = await window.electronAPI.captureInsertionTarget(session.sessionId);
      return { success: Boolean(capture?.success), session, capture };
    })()
  `);
}

async function checkInsertionAndClipboard(dictation, record, runId, options = {}) {
  // A) Dual output modes + insertion
  const notepad = await startTextTarget();
  options.onTargetStarted?.(notepad);
  let completed = false;

  try {
    const focusTarget = await ensureForegroundWindow(
      notepad.hwnd,
      notepad.kind === "notepad" ? "notepad" : "gatepad",
      6,
      notepad.editHwnd
    );
    record(
      `Target foreground (${notepad.kind === "notepad" ? "Notepad" : "GatePad"})`,
      Boolean(focusTarget?.success),
      JSON.stringify(focusTarget?.details || focusTarget)
    );
    assert(
      focusTarget?.success,
      "Could not focus the target window. Close interfering windows and re-run the gate without typing."
    );

    const fgBeforeShow = await getForegroundWindowInfo();
    await dictation.eval(`window.electronAPI.showDictationPanel(); true;`);
    await sleep(250);
    const fgAfterShow = await getForegroundWindowInfo();
    record(
      "No focus-steal on showDictationPanel",
      fgBeforeShow.hwnd === fgAfterShow.hwnd,
      `${fgBeforeShow.processName} -> ${fgAfterShow.processName}`
    );

    const captureBundle = await createAuthenticatedInsertionCapture(dictation);
    const capture = captureBundle?.capture;
    const expectedHwnd = Number(notepad.hwnd);
    const captureOk =
      Boolean(captureBundle?.success) &&
      typeof capture?.target?.capability === "string" &&
      capture.target.capability.length >= 32 &&
      capture.target.sessionId === captureBundle?.session?.sessionId &&
      !("hwnd" in capture.target) &&
      !("pid" in capture.target);
    record(
      `Capture opaque insertion target (${notepad.kind === "notepad" ? "Notepad" : "GatePad"} foreground)`,
      captureOk,
      JSON.stringify({
        success: capture?.success,
        sessionBound: capture?.target?.sessionId === captureBundle?.session?.sessionId,
        opaque: Boolean(capture?.target?.capability) && !("hwnd" in (capture?.target || {})),
      })
    );
    assert(
      captureOk,
      "captureInsertionTarget did not return an opaque capability bound to a fresh E2E session."
    );

    // A1) Insert-mode: should insert into target when focus is stable
    const insertForegroundText = `E2E InsertForeground ${runId}`;
    const beforeForegroundText = await readEditText(notepad.editHwnd);
    const refocusedTarget =
      notepad.kind === "gatepad"
        ? await requestGateTextWindowFocus(notepad)
        : Boolean(
            (
              await ensureForegroundWindow(
                notepad.hwnd,
                notepad.kind === "notepad" ? "notepad" : "gatepad",
                6,
                notepad.editHwnd
              )
            )?.success
          );
    assert(refocusedTarget, "Could not restore focus to the gate insertion target.");
    await dictation.eval(`
      (async function () {
        await window.__echoDraftE2E.simulateTranscriptionComplete(
          { text: ${JSON.stringify(insertForegroundText)}, source: "e2e" },
          { outputMode: "insert", sessionId: ${JSON.stringify(captureBundle.session.sessionId)}, insertionTarget: ${JSON.stringify(capture?.target || null)} }
        );
        return true;
      })()
    `);
    await sleep(300);
    const afterForegroundText = await readEditText(notepad.editHwnd);
    record(
      `Insert mode writes into ${notepad.kind === "notepad" ? "Notepad" : "GatePad"} (foreground stable)`,
      afterForegroundText.includes(insertForegroundText) &&
        afterForegroundText.length > beforeForegroundText.length,
      `len ${beforeForegroundText.length} -> ${afterForegroundText.length}`
    );
    const fgAfterInsert = await getForegroundWindowInfo();
    record(
      "No focus-steal on insert completion",
      fgAfterInsert.hwnd === notepad.hwnd,
      `${fgAfterInsert.processName} (${fgAfterInsert.hwnd})`
    );

    // F) "Remember insertion target": switch focus away before insert, then ensure paste
    // returns to the captured target (best-effort on Windows).
    const lockTargetFocus = await ensureForegroundWindow(
      notepad.hwnd,
      "target-lock-capture",
      4,
      notepad.editHwnd
    );
    assert(lockTargetFocus?.success, "Could not focus the target before target-lock capture.");
    const lockedCaptureBundle = await createAuthenticatedInsertionCapture(dictation);
    assert(
      lockedCaptureBundle?.success && lockedCaptureBundle?.capture?.target?.capability,
      "Could not capture a fresh target-lock capability."
    );
    const decoy = await startGateTextWindow();
    try {
      const decoyFocus = await ensureForegroundWindow(decoy.hwnd, "decoy", 4);
      record(
        "Switch focus away before insert (decoy foreground)",
        Boolean(decoyFocus?.success),
        JSON.stringify(decoyFocus?.details || decoyFocus)
      );

      const insertLockedText = `E2E InsertLocked ${runId}`;
      const beforeLockedText = await readEditText(notepad.editHwnd);

      await dictation.eval(`
        (async function () {
          await window.__echoDraftE2E.simulateTranscriptionComplete(
            { text: ${JSON.stringify(insertLockedText)}, source: "e2e" },
            { outputMode: "insert", sessionId: ${JSON.stringify(lockedCaptureBundle.session.sessionId)}, insertionTarget: ${JSON.stringify(lockedCaptureBundle.capture.target)} }
          );
          return true;
        })()
      `);

      const afterInsertText = await readEditText(notepad.editHwnd);
      const insertedIntoTarget =
        afterInsertText.includes(insertLockedText) &&
        afterInsertText.length > beforeLockedText.length;

      let clipboardAfterLocked = "";
      let clipboardHasLockedText = false;
      if (!insertedIntoTarget) {
        clipboardAfterLocked = await getClipboardText();
        clipboardHasLockedText = clipboardAfterLocked.includes(insertLockedText);
      }

      record(
        `Target lock inserts into ${notepad.kind === "notepad" ? "Notepad" : "GatePad"} OR falls back to clipboard`,
        insertedIntoTarget || clipboardHasLockedText,
        `insertedIntoTarget=${insertedIntoTarget} clipboardHasText=${clipboardHasLockedText}`
      );

      const decoyText = await readEditText(decoy.editHwnd);
      record(
        "Target lock does not insert into decoy",
        !decoyText.includes(insertLockedText),
        `len=${decoyText.length}`
      );

      if (!insertedIntoTarget) {
        record(
          "Target lock safe fallback leaves text in clipboard",
          clipboardHasLockedText,
          clipboardAfterLocked.slice(0, 80)
        );
      }
    } finally {
      await closeProcess(decoy.pid, decoy.focusSignalPath, decoy._child);
    }

    const clipText = `E2E Clipboard ${runId}`;
    const notepadTextBeforeClipboardMode = await readEditText(notepad.editHwnd);
    await dictation.eval(`
      (async function () {
        await window.__echoDraftE2E.simulateTranscriptionComplete(
          { text: ${JSON.stringify(clipText)}, source: "e2e" },
          { outputMode: "clipboard", sessionId: ${JSON.stringify(`sess-clip-${runId}`)} }
        );
        return true;
      })()
    `);

    await sleep(700);
    const notepadTextAfterClipboardMode = await readEditText(notepad.editHwnd);
    record(
      "Clipboard mode does not insert",
      notepadTextAfterClipboardMode === notepadTextBeforeClipboardMode,
      `len ${notepadTextBeforeClipboardMode.length} -> ${notepadTextAfterClipboardMode.length}`
    );

    const clipboardNow = await getClipboardText();
    record(
      "Clipboard mode copies to clipboard",
      clipboardNow.includes(clipText),
      clipboardNow.slice(0, 80)
    );

    // A/F) Safe fallback if activation fails: insertion does not happen, but clipboard contains text.
    const insertFailText = `E2E InsertFail ${runId}`;
    const beforeFailText = await readEditText(notepad.editHwnd);
    const invalidSession = await dictation.eval(
      `window.electronAPI.e2eCreateDictationSession("insert")`
    );
    await dictation.eval(`
      (async function () {
        await window.__echoDraftE2E.simulateTranscriptionComplete(
          { text: ${JSON.stringify(insertFailText)}, source: "e2e" },
          { outputMode: "insert", sessionId: ${JSON.stringify(invalidSession.sessionId)}, insertionTarget: { capability: "invalid-e2e-capability", sessionId: ${JSON.stringify(invalidSession.sessionId)}, capturedAt: 0 } }
        );
        return true;
      })()
    `);
    await sleep(900);
    const afterFailText = await readEditText(notepad.editHwnd);
    record(
      "Insert failure does not insert",
      afterFailText === beforeFailText,
      `len ${beforeFailText.length} -> ${afterFailText.length}`
    );
    const clipboardAfterFail = await getClipboardText();
    record(
      "Insert failure leaves text in clipboard",
      clipboardAfterFail.includes(insertFailText),
      clipboardAfterFail.slice(0, 80)
    );
    const trayAfterInsertFail = await dictation.eval(`window.electronAPI.e2eGetTrayStatus()`);
    record(
      "Insert failure remains visible in terminal tray status",
      isClipboardFallbackTrayStatus(trayAfterInsertFail),
      JSON.stringify(trayAfterInsertFail)
    );

    // G) Clipboard image preservation (insert success path)
    const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    let clipImageBefore = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      clipImageBefore = await setClipboardTestImage();
      const ok =
        Boolean(clipImageBefore?.hasImage) &&
        Number(clipImageBefore?.len || 0) > 0 &&
        safeString(clipImageBefore?.hash) &&
        safeString(clipImageBefore?.hash) !== EMPTY_SHA256;
      if (ok) break;
      await sleep(250);
    }
    const imageHashBefore = clipImageBefore.hash;

    const focusTarget2 =
      notepad.kind === "gatepad"
        ? await requestGateTextWindowFocus(notepad)
        : Boolean(
            (await ensureForegroundWindow(notepad.hwnd, "target-image", 4, notepad.editHwnd))
              ?.success
          );
    assert(focusTarget2, "Could not focus the target window for clipboard image test.");

    const capture2Bundle = await createAuthenticatedInsertionCapture(dictation);
    const capture2 = capture2Bundle?.capture;
    const capture2Ok =
      Boolean(capture2Bundle?.success) &&
      typeof capture2?.target?.capability === "string" &&
      capture2?.target?.sessionId === capture2Bundle?.session?.sessionId;
    record(
      "Capture insertion target for image test",
      capture2Ok,
      JSON.stringify({ success: capture2?.success, sessionBound: capture2Ok })
    );
    assert(
      capture2Ok,
      "captureInsertionTarget did not return a fresh capability before the clipboard image test."
    );
    await dictation.eval(`
      (async function () {
        await window.__echoDraftE2E.simulateTranscriptionComplete(
          { text: ${JSON.stringify(`E2E ImagePreserve ${runId}`)}, source: "e2e" },
          { outputMode: "insert", sessionId: ${JSON.stringify(capture2Bundle.session.sessionId)}, insertionTarget: ${JSON.stringify(capture2?.target || null)} }
        );
        return true;
      })()
    `);

    await sleep(2500);
    let clipImageAfter = null;
    let clipAfterAttempt = 0;
    for (let attempt = 1; attempt <= 4; attempt++) {
      clipAfterAttempt = attempt;
      clipImageAfter = await getClipboardImageHash();
      const ok =
        Boolean(clipImageAfter?.hasImage) &&
        Number(clipImageAfter?.len || 0) > 0 &&
        safeString(clipImageAfter?.hash) &&
        safeString(clipImageAfter?.hash) !== EMPTY_SHA256;
      if (ok) break;
      await sleep(350);
    }

    const clipAfterOk =
      Boolean(clipImageAfter?.hasImage) &&
      Number(clipImageAfter?.len || 0) > 0 &&
      safeString(clipImageAfter?.hash) &&
      safeString(clipImageAfter?.hash) !== EMPTY_SHA256;
    record(
      "Clipboard image preserved after insert",
      clipAfterOk && clipImageAfter.hash === imageHashBefore,
      JSON.stringify({
        before: { len: clipImageBefore?.len, hash: imageHashBefore },
        after: { len: clipImageAfter?.len, hash: clipImageAfter?.hash || null },
        attempts: clipAfterAttempt,
      })
    );

    completed = true;
    return { notepad, expectedHwnd };
  } finally {
    if (!completed) {
      const closed = await closeInsertionTarget(notepad);
      options.onTargetClosed?.(notepad, closed);
    }
  }
}

async function checkNonInteractiveDelivery(dictation, record, runId) {
  const clipText = `E2E Clipboard ${runId}`;
  await dictation.eval(`
    (async function () {
      await window.__echoDraftE2E.simulateTranscriptionComplete(
        { text: ${JSON.stringify(clipText)}, source: "e2e" },
        { outputMode: "clipboard", sessionId: ${JSON.stringify(`sess-clip-${runId}`)} }
      );
      return true;
    })()
  `);
  await sleep(700);
  const clipboardNow = await getClipboardText();
  record(
    "Clipboard mode copies to clipboard without foreground automation",
    clipboardNow.includes(clipText),
    clipboardNow.slice(0, 80)
  );

  const insertFailText = `E2E InsertFail ${runId}`;
  const invalidSession = await dictation.eval(
    `window.electronAPI.e2eCreateDictationSession("insert")`
  );
  await dictation.eval(`
    (async function () {
      await window.__echoDraftE2E.simulateTranscriptionComplete(
        { text: ${JSON.stringify(insertFailText)}, source: "e2e" },
        { outputMode: "insert", sessionId: ${JSON.stringify(invalidSession.sessionId)}, insertionTarget: { capability: "invalid-e2e-capability", sessionId: ${JSON.stringify(invalidSession.sessionId)}, capturedAt: 0 } }
      );
      return true;
    })()
  `);
  await sleep(900);
  const clipboardAfterFail = await getClipboardText();
  record(
    "Insert failure leaves text in clipboard without foreground automation",
    clipboardAfterFail.includes(insertFailText),
    clipboardAfterFail.slice(0, 80)
  );

  const trayAfterInsertFail = await dictation.eval(`window.electronAPI.e2eGetTrayStatus()`);
  record(
    "Insert failure remains visible in terminal tray status",
    isClipboardFallbackTrayStatus(trayAfterInsertFail),
    JSON.stringify(trayAfterInsertFail)
  );
}

async function closeInsertionTarget(notepad) {
  if (!notepad || notepad._cleanupComplete) {
    return true;
  }

  if (notepad.kind === "notepad") {
    const allowKillNotepad = isTruthyFlag(process.env.OPENWHISPR_GATE_KILL_NOTEPAD);
    if (allowKillNotepad) {
      let closed = await closeProcess(notepad.pid);
      if (
        Number.isInteger(notepad.launcherPid) &&
        notepad.launcherPid &&
        notepad.launcherPid !== notepad.pid
      ) {
        closed = (await closeProcess(notepad.launcherPid)) && closed;
      }
      notepad._cleanupComplete = closed;
      return closed;
    } else {
      console.warn(
        "[gate] Leaving Notepad open (set OPENWHISPR_GATE_KILL_NOTEPAD=1 to force close)."
      );
    }
    notepad._cleanupComplete = true;
    return true;
  }

  if (Number.isFinite(notepad.pid) && notepad.pid > 0) {
    const closed = await closeProcess(notepad.pid, notepad.focusSignalPath, notepad._child);
    notepad._cleanupComplete = closed;
    return closed;
  }

  notepad._cleanupComplete = true;
  return true;
}

module.exports = {
  checkInsertionAndClipboard,
  checkNonInteractiveDelivery,
  closeInsertionTarget,
  isClipboardFallbackTrayStatus,
};
