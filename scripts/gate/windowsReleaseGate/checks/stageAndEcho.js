const { safeString, sleep } = require("../utils");

async function checkStageAndEchoGuards(dictation, record) {
  // B) Always-visible status bar
  await dictation.waitForSelector('[data-testid="dictation-status-bar"]', 15000);
  record("Status bar present", true);

  await dictation.eval(`window.__openwhisprE2E.setStage("listening", { stageLabel: "Listening" }); true;`);
  await sleep(250);
  await dictation.eval(`window.__openwhisprE2E.setStage("listening", { stageLabel: "Listening" }); true;`);
  const stageListening = await dictation.eval(
    `document.querySelector('[data-testid="dictation-status-stage"]')?.textContent || ""`
  );
  record("Stage label updates (Listening)", stageListening.trim() === "Listening", stageListening);

  await dictation.eval(`window.__openwhisprE2E.setStage("transcribing", { stageLabel: "Transcribing", generatedWords: 12 }); true;`);
  const stageTranscribing = await dictation.eval(
    `document.querySelector('[data-testid="dictation-status-stage"]')?.textContent || ""`
  );
  record("Stage label updates (Transcribing)", stageTranscribing.trim() === "Transcribing", stageTranscribing);

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
    `window.__openwhisprE2E.isLikelyDictionaryPromptEcho(${JSON.stringify(dictPrompt)}, ${JSON.stringify(dictTerms)})`
  );
  record(
    "Dictionary prompt echo guard detects prompt output",
    Boolean(echoDetected) === true,
    `value=${safeString(echoDetected)}`
  );

  const echoFalsePositive = await dictation.eval(
    `window.__openwhisprE2E.isLikelyDictionaryPromptEcho("let's test cloud transcription then shall we", ${JSON.stringify(dictTerms)})`
  );
  record(
    "Dictionary prompt echo guard avoids false positive",
    Boolean(echoFalsePositive) === false,
    `value=${safeString(echoFalsePositive)}`
  );
}

module.exports = {
  checkStageAndEchoGuards,
};

