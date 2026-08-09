const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-workflow-db-test-"));
const resolvedRoot = path.resolve(root);
const tempRoot = path.resolve(os.tmpdir()) + path.sep;
if (
  !resolvedRoot.startsWith(tempRoot) ||
  !path.basename(resolvedRoot).startsWith("echodraft-workflow-db-test-")
) {
  throw new Error("Refusing unsafe workflow database test path");
}

const originalLoad = Module._load;
Module._load = function loadWithElectronAppStub(request, parent, isMain) {
  if (request === "electron") return { app: { getPath: () => resolvedRoot } };
  return originalLoad.call(this, request, parent, isMain);
};

const externalIdFor = (number) =>
  `10000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;

let manager;
try {
  const DatabaseManager = require("../../src/helpers/database");
  manager = new DatabaseManager();
  assert.equal(manager.db.pragma("foreign_keys", { simple: true }), 1);

  const source = manager.saveTranscription({
    text: "Clean original",
    rawText: "exact raw original",
  }).transcription;
  const alternative = manager.saveReprocessingAlternative({
    transcriptionId: source.id,
    mode: "cleanup",
    text: "Clean alternative",
    meta: { model: "test-model" },
  }).alternative;
  assert.equal(alternative.text, "Clean alternative");
  assert.equal(manager.getTranscriptions(5)[0].text, "Clean original");
  assert.equal(manager.getTranscriptions(5)[0].raw_text, "exact raw original");
  assert.equal(manager.getTranscriptions(5)[0].alternatives[0].id, alternative.id);

  const flag = manager.setCorrectionFlag({
    transcriptionId: source.id,
    reason: "cleanup",
  }).correctionFlag;
  assert.equal(flag.reason, "cleanup");
  manager.setCorrectionFlag({ transcriptionId: source.id, reason: "prompt" });
  assert.equal(manager.getTranscriptions(5)[0].correctionFlag.reason, "prompt");
  const flagColumns = manager.db
    .prepare("PRAGMA table_info(correction_flags)")
    .all()
    .map((column) => column.name);
  assert.equal(
    flagColumns.some((name) => /text|content/i.test(name)),
    false
  );

  const firstRule = manager.saveCorrectionRule({
    sourcePhrase: "eco draft",
    replacementText: "EchoDraft",
  });
  manager.saveCorrectionRule({
    id: firstRule.id,
    sourcePhrase: "echo draft",
    replacementText: "EchoDraft",
    enabled: false,
  });
  assert.deepEqual(
    manager.getCorrectionRules().map((rule) => rule.enabled),
    [false]
  );
  assert.throws(
    () =>
      manager.saveCorrectionRule({
        sourcePhrase: "ECHO DRAFT",
        replacementText: "duplicate",
      }),
    /equivalent|unique/i
  );
  const unicodeRule = manager.saveCorrectionRule({
    sourcePhrase: "Ärger",
    replacementText: "Concern",
  });
  assert.throws(
    () =>
      manager.saveCorrectionRule({
        sourcePhrase: "ärger",
        replacementText: "Problem",
      }),
    /equivalent/i
  );
  const distinctUnicodeRule = manager.saveCorrectionRule({
    sourcePhrase: "Māori",
    replacementText: "te reo Māori",
  });
  assert.equal(typeof distinctUnicodeRule.id, "number");
  assert.throws(
    () =>
      manager.saveCorrectionRule({
        id: distinctUnicodeRule.id,
        sourcePhrase: "äRGER",
        replacementText: "Problem",
      }),
    /equivalent/i
  );
  assert.equal(
    manager.getCorrectionRules().find((rule) => rule.id === unicodeRule.id).sourcePhrase,
    "Ärger"
  );

  const profile = manager.saveAppStyleProfile({
    processName: "WINWORD.EXE",
    style: "document",
  });
  assert.equal(manager.getAppStyleForProcess("winword.exe"), "document");
  manager.saveAppStyleProfile({
    id: profile.id,
    processName: "winword.exe",
    style: "technical",
    enabled: false,
  });
  assert.equal(manager.getAppStyleForProcess("WINWORD.EXE"), null);
  manager.saveCorrectionRule({
    sourcePhrase: "te reo",
    replacementText: "te reo Māori",
  });
  manager.saveAppStyleProfile({
    processName: "My Māori App.exe",
    style: "message",
  });
  assert.equal(manager.getAppStyleForProcess("my māori app.exe"), "message");
  assert.equal(manager.getWritingPreferences("C:\\not-a-process").writingStyle, null);
  assert.deepEqual(
    manager
      .getWritingPreferences("C:\\not-a-process")
      .correctionRules.map((rule) => rule.sourcePhrase),
    ["Ärger", "Māori", "te reo"]
  );

  const saveArchived = ({ number, title, text, rawText, mobileCreatedAt, createdAt }) => {
    const saved = manager.saveTodo({
      externalId: externalIdFor(number),
      title,
      text,
      rawText,
      meta: { mobileInbox: { createdAt: mobileCreatedAt } },
    }).todo;
    manager.db
      .prepare("UPDATE todo_items SET created_at = ? WHERE id = ?")
      .run(createdAt, saved.id);
    manager.markTodoActioned(saved.id);
    return saved.id;
  };

  const newestId = saveArchived({
    number: 1,
    title: "Newest project",
    text: "clean newest",
    rawText: "spoken newest",
    mobileCreatedAt: "2026-01-05T09:00:00.000Z",
    createdAt: "2025-01-01 00:00:00",
  });
  const fallbackId = saveArchived({
    number: 2,
    title: "Fallback project",
    text: "clean fallback",
    rawText: "spoken fallback",
    mobileCreatedAt: "not-a-date",
    createdAt: "2026-01-04 09:00:00",
  });
  const olderId = saveArchived({
    number: 3,
    title: "Older project",
    text: "clean older",
    rawText: "spoken older needle",
    mobileCreatedAt: "2026-01-03T09:00:00.000Z",
    createdAt: "2026-02-01 00:00:00",
  });
  const tieLowId = saveArchived({
    number: 4,
    title: "Tie low",
    text: "tie low",
    rawText: "tie low raw",
    mobileCreatedAt: "2026-01-02T09:00:00.000Z",
    createdAt: "2026-01-02 09:00:00",
  });
  const tieHighId = saveArchived({
    number: 5,
    title: "Tie high",
    text: "tie high",
    rawText: "tie high raw",
    mobileCreatedAt: "2026-01-02T09:00:00.000Z",
    createdAt: "2026-01-02 09:00:00",
  });
  const nonCanonicalDateId = saveArchived({
    number: 7,
    title: "Non-canonical mobile date",
    text: "fallback date authority",
    rawText: "fallback date authority raw",
    mobileCreatedAt: "2027-01-01",
    createdAt: "2026-01-01 09:00:00",
  });
  const malformedMetadataId = saveArchived({
    number: 8,
    title: "Metadata will be malformed",
    text: "MĀORI 100%_literal archive search",
    rawText: "raw archive search",
    mobileCreatedAt: "2025-12-31T09:00:00.000Z",
    createdAt: "2025-12-31 09:00:00",
  });
  manager.db
    .prepare("UPDATE todo_items SET meta_json = ? WHERE id = ?")
    .run("{malformed", malformedMetadataId);

  const firstPage = manager.getArchivedTodos({ limit: 2 });
  assert.deepEqual(
    firstPage.items.map((item) => item.id),
    [newestId, fallbackId]
  );
  assert.ok(firstPage.nextCursor);
  const betweenPagesId = saveArchived({
    number: 6,
    title: "Arrived between pages",
    text: "between pages",
    rawText: "between pages raw",
    mobileCreatedAt: "2026-01-06T09:00:00.000Z",
    createdAt: "2026-01-06 09:00:00",
  });
  const secondPage = manager.getArchivedTodos({ limit: 3, cursor: firstPage.nextCursor });
  assert.deepEqual(
    secondPage.items.map((item) => item.id),
    [olderId, tieHighId, tieLowId]
  );
  assert.equal(
    secondPage.items.some((item) => item.id === betweenPagesId),
    false
  );
  assert.deepEqual(
    manager
      .getArchivedTodos({ limit: 20 })
      .items.slice(-2)
      .map((item) => item.id),
    [nonCanonicalDateId, malformedMetadataId]
  );
  assert.deepEqual(
    manager.getArchivedTodos({ query: "needle" }).items.map((item) => item.id),
    [olderId]
  );
  assert.deepEqual(
    manager.getArchivedTodos({ query: "fallback project" }).items.map((item) => item.id),
    [fallbackId]
  );
  assert.deepEqual(
    manager.getArchivedTodos({ query: "māori 100%_" }).items.map((item) => item.id),
    [malformedMetadataId]
  );

  manager.saveReprocessingAlternative({
    todoId: newestId,
    mode: "codex-prompt",
    text: "Prompt alternative",
  });
  manager.setCorrectionFlag({ todoId: newestId, reason: "paste-delivery" });
  manager.db.prepare("DELETE FROM todo_items WHERE id = ?").run(newestId);
  assert.equal(
    manager.db
      .prepare("SELECT COUNT(*) AS count FROM reprocessing_alternatives WHERE todo_id = ?")
      .get(newestId).count,
    0
  );
  assert.equal(
    manager.db
      .prepare("SELECT COUNT(*) AS count FROM correction_flags WHERE todo_id = ?")
      .get(newestId).count,
    0
  );

  assert.throws(
    () =>
      manager.withRetentionMutationLock(() =>
        manager.saveTranscription({ text: "must be rejected while locked" })
      ),
    /temporarily paused/i
  );
  assert.equal(manager.saveTranscription({ text: "writes resume" }).success, true);

  console.log("workflow database integration: passed");
} finally {
  try {
    manager?.db?.close();
  } catch {}
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}
