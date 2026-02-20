const fs = require("fs");
const path = require("path");

const { safeString, sleep } = require("../utils");

async function checkHistoryAndExports(panel, record, runId, exportDir) {
  // C/D) History workspace + export
  await panel.waitForSelector('[data-testid="history-search"]', 15000);
  const historyCount = await panel.eval(
    `document.querySelectorAll('[data-testid="transcription-item"]').length`
  );
  record("History renders items", historyCount >= 2, `count=${historyCount}`);

  await panel.setInputValue('[data-testid="history-search"]', "InsertFail");
  await sleep(250);
  const insertFailCount = await panel.eval(
    `document.querySelectorAll('[data-testid="transcription-item"]').length`
  );
  record("History retains text after insert failure", insertFailCount >= 1, `count=${insertFailCount}`);

  await panel.setInputValue('[data-testid="history-search"]', "Clipboard");
  await sleep(250);
  const filteredCount = await panel.eval(
    `document.querySelectorAll('[data-testid="transcription-item"]').length`
  );
  record(
    "History search filters results",
    filteredCount >= 1 && filteredCount <= historyCount,
    `count=${filteredCount}`
  );

  const exportJsonPath = path.join(exportDir, `transcriptions-${runId}.json`);
  const exportCsvPath = path.join(exportDir, `transcriptions-${runId}.csv`);

  const exportJsonResult = await panel.eval(
    `(async () => window.electronAPI.e2eExportTranscriptions("json", ${JSON.stringify(exportJsonPath)}) )()`
  );
  record("E2E export transcriptions (JSON)", Boolean(exportJsonResult?.success), JSON.stringify(exportJsonResult));

  const exportCsvResult = await panel.eval(
    `(async () => window.electronAPI.e2eExportTranscriptions("csv", ${JSON.stringify(exportCsvPath)}) )()`
  );
  record("E2E export transcriptions (CSV)", Boolean(exportCsvResult?.success), JSON.stringify(exportCsvResult));

  // D) Sanity check export content includes useful diagnostic fields (and no obvious secrets).
  try {
    const exported = JSON.parse(fs.readFileSync(exportJsonPath, "utf8"));
    const rows = Array.isArray(exported) ? exported : [];
    const hasOutputModes = rows.some((r) => r?.outputMode === "insert") && rows.some((r) => r?.outputMode === "clipboard");
    const hasTimingCols = rows.some((r) => typeof r?.totalMs !== "undefined") && rows.some((r) => typeof r?.pasteMs !== "undefined");
    const secretLike = JSON.stringify(rows).includes("sk-");
    record(
      "Export JSON includes diagnostics columns",
      rows.length >= 2 && hasOutputModes && hasTimingCols && !secretLike,
      JSON.stringify({ rows: rows.length, hasOutputModes, hasTimingCols, secretLike })
    );
  } catch (error) {
    record("Export JSON includes diagnostics columns", false, `parse_failed: ${safeString(error?.message || error)}`);
  }

  try {
    const csv = fs.readFileSync(exportCsvPath, "utf8");
    const header = safeString(csv.split(/\r?\n/)[0] || "");
    const required = ["outputMode", "status", "provider", "model", "pasteSucceeded", "totalMs"];
    const missing = required.filter((key) => !header.includes(key));
    record(
      "Export CSV includes diagnostics columns",
      missing.length === 0,
      missing.length === 0 ? header : `missing=${missing.join("|")}`
    );
  } catch (error) {
    record("Export CSV includes diagnostics columns", false, `read_failed: ${safeString(error?.message || error)}`);
  }

  return { exportJsonPath, exportCsvPath };
}

module.exports = {
  checkHistoryAndExports,
};

