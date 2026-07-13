const { safeString, sleep } = require("../utils");

async function waitForEvaluation(
  target,
  expression,
  predicate,
  { timeoutMs = 3000, intervalMs = 100, sleepFn = sleep } = {}
) {
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 3000;
  const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 100;
  const maxAttempts = Math.max(1, Math.ceil(safeTimeoutMs / safeIntervalMs) + 1);
  let lastValue = null;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      lastValue = await target.eval(expression);
      lastError = null;
      if (predicate(lastValue)) {
        return { matched: true, attempts: attempt, value: lastValue, error: null };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : safeString(error);
    }

    if (attempt < maxAttempts) {
      await sleepFn(safeIntervalMs);
    }
  }

  return {
    matched: false,
    attempts: maxAttempts,
    value: lastValue,
    error: lastError,
  };
}

async function checkStageAndEchoGuards(dictation, record) {
  const originalIndicatorSetting = await dictation.eval(
    `localStorage.getItem("recordingIndicatorEnabled")`
  );
  await dictation.eval(`
    localStorage.setItem("recordingIndicatorEnabled", "true");
    window.dispatchEvent(new CustomEvent("echodraft:local-storage-change", {
      detail: { key: "recordingIndicatorEnabled" }
    }));
    true;
  `);

  // B) Listening state must be unambiguous without taking keyboard focus.
  await dictation.eval(
    `window.__echoDraftE2E.setStage("listening", { stageLabel: "Listening" }); true;`
  );
  const stageListening = await waitForEvaluation(
    dictation,
    `window.electronAPI.e2eGetTrayStatus()`,
    (value) => value?.stage === "listening" && value?.stageLabel === "Listening"
  );
  record("Tray status updates (Listening)", stageListening.matched, JSON.stringify(stageListening));

  const indicatorState = await waitForEvaluation(
    dictation,
    `(async () => {
      const indicator = document.querySelector('[data-testid="recording-indicator"]');
      const rect = indicator?.getBoundingClientRect();
      const indicatorWindow = await window.electronAPI.e2eGetMainWindowState();
      return {
        indicatorUi: {
          found: Boolean(indicator),
          visible: Boolean(rect && rect.width > 0 && rect.height > 0),
          hasRecLabel: indicator?.textContent?.includes("REC") === true,
          hasLiveLabel: indicator?.textContent?.includes("Microphone live") === true,
          hasTimer: Boolean(indicator?.querySelector("time")),
          viewport: { width: window.innerWidth, height: window.innerHeight }
        },
        indicatorWindow
      };
    })()`,
    ({ indicatorUi, indicatorWindow } = {}) =>
      indicatorUi?.found === true &&
      indicatorUi?.visible === true &&
      indicatorUi?.hasRecLabel === true &&
      indicatorUi?.hasLiveLabel === true &&
      indicatorUi?.hasTimer === true &&
      indicatorWindow?.available === true &&
      indicatorWindow?.visible === true &&
      indicatorWindow?.focused === false &&
      indicatorWindow?.focusable === false &&
      indicatorWindow?.interactive === false &&
      indicatorWindow?.alwaysOnTop === true &&
      indicatorWindow?.bounds?.width === 260 &&
      indicatorWindow?.bounds?.height === 72
  );
  record(
    "Recording indicator renders click-through without taking focus",
    indicatorState.matched,
    JSON.stringify(indicatorState)
  );

  await dictation.eval(
    `window.__echoDraftE2E.setStage("transcribing", { stageLabel: "Transcribing", generatedWords: 12 }); true;`
  );
  const stageTranscribing = await waitForEvaluation(
    dictation,
    `window.electronAPI.e2eGetTrayStatus()`,
    (value) =>
      value?.stage === "transcribing" &&
      value?.stageLabel === "Transcribing" &&
      value?.generatedWords === 12
  );
  record(
    "Tray status updates (Transcribing)",
    stageTranscribing.matched,
    JSON.stringify(stageTranscribing)
  );
  const processingIndicatorState = await waitForEvaluation(
    dictation,
    `(async () => {
      const indicator = document.querySelector('[data-testid="dictation-status-indicator"]');
      const rect = indicator?.getBoundingClientRect();
      const indicatorWindow = await window.electronAPI.e2eGetMainWindowState();
      return {
        indicatorUi: {
          found: Boolean(indicator),
          visible: Boolean(rect && rect.width > 0 && rect.height > 0),
          stage: indicator?.getAttribute("data-stage"),
          hasTranscribingLabel: indicator?.textContent?.includes("Transcribing") === true
        },
        indicatorWindow
      };
    })()`,
    ({ indicatorUi, indicatorWindow } = {}) =>
      indicatorUi?.found === true &&
      indicatorUi?.visible === true &&
      indicatorUi?.stage === "transcribing" &&
      indicatorUi?.hasTranscribingLabel === true &&
      indicatorWindow?.available === true &&
      indicatorWindow?.visible === true &&
      indicatorWindow?.focused === false &&
      indicatorWindow?.focusable === false &&
      indicatorWindow?.interactive === false &&
      indicatorWindow?.alwaysOnTop === true &&
      indicatorWindow?.bounds?.width === 260 &&
      indicatorWindow?.bounds?.height === 72
  );
  record(
    "Processing indicator replaces the live microphone state without taking focus",
    processingIndicatorState.matched,
    JSON.stringify(processingIndicatorState)
  );

  await dictation.eval(`
    (() => {
      const originalValue = ${JSON.stringify(originalIndicatorSetting)};
      if (originalValue === null) {
        localStorage.removeItem("recordingIndicatorEnabled");
      } else {
        localStorage.setItem("recordingIndicatorEnabled", originalValue);
      }
      window.dispatchEvent(new CustomEvent("echodraft:local-storage-change", {
        detail: { key: "recordingIndicatorEnabled" }
      }));
      return true;
    })()
  `);

  // B/G) Regression guard: ensure dictionary prompt-echo heuristic flags obvious prompt output
  const dictTerms = [
    "Hello Cashflow",
    "DbMcp",
    "SlackMcp",
    "MondayMcp",
    "AGENTS.md",
    "Codex",
    "Postgres",
    "TypeScript",
    "EchoDraft",
    "PowerShell",
  ];
  const dictPrompt = dictTerms.join(", ");
  const echoDetected = await dictation.eval(
    `window.__echoDraftE2E.isLikelyDictionaryPromptEcho(${JSON.stringify(dictPrompt)}, ${JSON.stringify(dictTerms)})`
  );
  record(
    "Dictionary prompt echo guard detects prompt output",
    Boolean(echoDetected) === true,
    `value=${safeString(echoDetected)}`
  );

  const echoFalsePositive = await dictation.eval(
    `window.__echoDraftE2E.isLikelyDictionaryPromptEcho("let's test cloud transcription then shall we", ${JSON.stringify(dictTerms)})`
  );
  record(
    "Dictionary prompt echo guard avoids false positive",
    Boolean(echoFalsePositive) === false,
    `value=${safeString(echoFalsePositive)}`
  );
}

module.exports = {
  checkStageAndEchoGuards,
  waitForEvaluation,
};
