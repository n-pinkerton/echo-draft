const path = require("path");

const { safeString, sleep } = require("../utils");

async function checkDictionaryUi(panel, record, exportDir, runId) {
  // E) Dictionary batch parsing + merge/replace + export/import (E2E IPC)
  await panel.eval(`
      (function () {
        const openSettings = document.querySelector('button[aria-label="Open settings"]');
        if (!openSettings) throw new Error("Open settings button not found");
        openSettings.click();
        return true;
      })()
    `);
  await panel.waitForSelector('button[data-section-id="dictionary"]', 15000);
  await panel.click('button[data-section-id="dictionary"]');
  await panel.waitForSelector('textarea[placeholder^="Paste one word"]', 15000);

  const batchText = "EchoDraft\nKubernetes\nopenwhispr\n;Dr. Martinez,  \n\n";
  await panel.setInputValue('textarea[placeholder^="Paste one word"]', batchText);
  await sleep(250);
  const previewText = await panel.eval(`
      (function () {
        const nodes = Array.from(document.querySelectorAll("p"));
        const preview = nodes.find((n) => (n.textContent || "").includes("Preview:"));
        return preview ? preview.textContent : "";
      })()
    `);
  record(
    "Dictionary preview shows dedupe counts",
    safeString(previewText).includes("duplicates removed") && safeString(previewText).includes("1 duplicates removed"),
    safeString(previewText)
  );

  // Apply merge
  await panel.eval(`
      (function () {
        const apply = Array.from(document.querySelectorAll("button")).find((b) =>
          (b.textContent || "").trim().startsWith("Apply ")
        );
        if (!apply) throw new Error("Apply button not found");
        apply.click();
        return true;
      })()
    `);
  await sleep(700);

  const dictWordsAfterMerge = await panel.eval(`(async () => window.electronAPI.getDictionary())()`);
  const dictWordsNormalized = Array.isArray(dictWordsAfterMerge)
    ? dictWordsAfterMerge.map((word) => safeString(word).trim()).filter(Boolean)
    : [];
  record(
    "Dictionary merge writes to DB",
    dictWordsNormalized.length === 3 &&
      dictWordsNormalized.includes("EchoDraft") &&
      dictWordsNormalized.includes("Kubernetes") &&
      dictWordsNormalized.includes("Dr. Martinez"),
    JSON.stringify(dictWordsAfterMerge)
  );

  // Export dictionary via E2E IPC and round-trip import
  const exportDictPath = path.join(exportDir, `dictionary-${runId}.txt`);
  const exportDictResult = await panel.eval(
    `(async () => window.electronAPI.e2eExportDictionary("txt", ${JSON.stringify(exportDictPath)}) )()`
  );
  record("E2E export dictionary (TXT)", Boolean(exportDictResult?.success), JSON.stringify(exportDictResult));

  const importDictResult = await panel.eval(
    `(async () => window.electronAPI.e2eImportDictionary(${JSON.stringify(exportDictPath)}) )()`
  );
  record("E2E import dictionary (TXT)", Boolean(importDictResult?.success), JSON.stringify(importDictResult));

  return { exportDictPath };
}

module.exports = {
  checkDictionaryUi,
};

