const { assert, isTruthyFlag, safeString, sleep } = require("../utils");

const {
  getClipboardImageHash,
  getClipboardText,
  setClipboardTestImage,
} = require("../clipboardTools");
const {
  ensureForegroundWindow,
  getForegroundWindowInfo,
  readEditText,
} = require("../foreground");
const {
  closeProcess,
  startGateTextWindow,
  startTextTarget,
} = require("../windowsTargets");

async function checkInsertionAndClipboard(dictation, record, runId) {
  // A) Dual output modes + insertion
  let notepad = await startTextTarget();

  const focusTarget = await ensureForegroundWindow(
    notepad.hwnd,
    notepad.kind === "notepad" ? "notepad" : "gatepad"
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

  const capture = await dictation.eval(`window.electronAPI.captureInsertionTarget()`);
  const expectedHwnd = Number(notepad.hwnd);
  const capturedHwnd = Number(capture?.target?.hwnd || 0);
  const captureOk = Boolean(capture?.success) && capturedHwnd === expectedHwnd;
  record(
    `Capture insertion target (${notepad.kind === "notepad" ? "Notepad" : "GatePad"} foreground)`,
    captureOk,
    JSON.stringify({
      success: capture?.success,
      expectedHwnd,
      capturedHwnd,
      processName: capture?.target?.processName || "",
    })
  );
  assert(
    captureOk,
    `captureInsertionTarget did not match expected foreground window (expected ${expectedHwnd}, got ${capturedHwnd}). Re-run without typing.`
  );

  // A1) Insert-mode: should insert into target when focus is stable
  const insertForegroundText = `E2E InsertForeground ${runId}`;
  const beforeForegroundText = await readEditText(notepad.editHwnd);
  await dictation.eval(`
      (async function () {
        await window.__openwhisprE2E.simulateTranscriptionComplete(
          { text: ${JSON.stringify(insertForegroundText)}, source: "e2e" },
          { outputMode: "insert", sessionId: ${JSON.stringify(`sess-insert-foreground-${runId}`)}, insertionTarget: ${JSON.stringify(capture?.target || null)} }
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
          await window.__openwhisprE2E.simulateTranscriptionComplete(
            { text: ${JSON.stringify(insertLockedText)}, source: "e2e" },
            { outputMode: "insert", sessionId: ${JSON.stringify(`sess-insert-locked-${runId}`)}, insertionTarget: ${JSON.stringify(capture?.target || null)} }
          );
          return true;
        })()
      `);

    const afterInsertText = await readEditText(notepad.editHwnd);
    const insertedIntoTarget =
      afterInsertText.includes(insertLockedText) && afterInsertText.length > beforeLockedText.length;

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
    await closeProcess(decoy.pid);
  }

  const clipText = `E2E Clipboard ${runId}`;
  const notepadTextBeforeClipboardMode = await readEditText(notepad.editHwnd);
  await dictation.eval(`
      (async function () {
        await window.__openwhisprE2E.simulateTranscriptionComplete(
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
  record("Clipboard mode copies to clipboard", clipboardNow.includes(clipText), clipboardNow.slice(0, 80));

  // A/F) Safe fallback if activation fails: insertion does not happen, but clipboard contains text.
  const insertFailText = `E2E InsertFail ${runId}`;
  const beforeFailText = await readEditText(notepad.editHwnd);
  await dictation.eval(`
      (async function () {
        await window.__openwhisprE2E.simulateTranscriptionComplete(
          { text: ${JSON.stringify(insertFailText)}, source: "e2e" },
          { outputMode: "insert", sessionId: ${JSON.stringify(`sess-insert-fail-${runId}`)}, insertionTarget: { hwnd: 1, pid: 0, processName: "invalid", title: "invalid" } }
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

  const focusTarget2 = await ensureForegroundWindow(notepad.hwnd, "target-image", 4);
  assert(focusTarget2?.success, "Could not focus the target window for clipboard image test.");

  const capture2 = await dictation.eval(`window.electronAPI.captureInsertionTarget()`);
  const capture2Hwnd = Number(capture2?.target?.hwnd || 0);
  const capture2Ok = Boolean(capture2?.success) && capture2Hwnd === expectedHwnd;
  record(
    "Capture insertion target for image test",
    capture2Ok,
    JSON.stringify({ success: capture2?.success, expectedHwnd, capturedHwnd: capture2Hwnd })
  );
  assert(
    capture2Ok,
    `captureInsertionTarget mismatch before clipboard image test (expected ${expectedHwnd}, got ${capture2Hwnd}).`
  );
  await dictation.eval(`
      (async function () {
        await window.__openwhisprE2E.simulateTranscriptionComplete(
          { text: ${JSON.stringify(`E2E ImagePreserve ${runId}`)}, source: "e2e" },
          { outputMode: "insert", sessionId: ${JSON.stringify(`sess-img-${runId}`)}, insertionTarget: ${JSON.stringify(capture2?.target || null)} }
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

  return { notepad, expectedHwnd };
}

async function closeInsertionTarget(notepad) {
  if (notepad.kind === "notepad") {
    const allowKillNotepad = isTruthyFlag(process.env.OPENWHISPR_GATE_KILL_NOTEPAD);
    if (allowKillNotepad) {
      await closeProcess(notepad.pid);
      if (Number.isInteger(notepad.launcherPid) && notepad.launcherPid && notepad.launcherPid !== notepad.pid) {
        await closeProcess(notepad.launcherPid);
      }
    } else {
      console.warn("[gate] Leaving Notepad open (set OPENWHISPR_GATE_KILL_NOTEPAD=1 to force close).");
    }
    return;
  }

  if (Number.isFinite(notepad.pid) && notepad.pid > 0) {
    await closeProcess(notepad.pid);
  }
}

module.exports = {
  checkInsertionAndClipboard,
  closeInsertionTarget,
};

