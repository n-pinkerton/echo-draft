const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-retention-db-test-"));
const resolvedRoot = path.resolve(root);
const tempRoot = path.resolve(os.tmpdir()) + path.sep;
if (
  !resolvedRoot.startsWith(tempRoot) ||
  !path.basename(resolvedRoot).startsWith("echodraft-retention-db-test-")
) {
  throw new Error("Refusing unsafe retention database test path");
}

const originalLoad = Module._load;
Module._load = function loadWithElectronAppStub(request, parent, isMain) {
  if (request === "electron") return { app: { getPath: () => resolvedRoot } };
  return originalLoad.call(this, request, parent, isMain);
};

const cutoffIso = "2026-07-10T12:00:00.000Z";
const externalIdFor = (number) =>
  `20000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;

let manager;
try {
  const DatabaseManager = require("../../src/helpers/database");
  manager = new DatabaseManager();

  const oldHistory = manager.saveTranscription({
    text: "Old cleaned History",
    rawText: "Old exact raw History",
  }).transcription;
  manager.db
    .prepare("UPDATE transcriptions SET created_at = ? WHERE id = ?")
    .run("2026-07-10 11:59:59", oldHistory.id);
  manager.saveReprocessingAlternative({
    transcriptionId: oldHistory.id,
    mode: "cleanup",
    text: "Old linked alternative",
  });
  manager.setCorrectionFlag({ transcriptionId: oldHistory.id, reason: "cleanup" });

  const pendingTodo = manager.saveTodo({
    externalId: externalIdFor(1),
    title: "Old pending",
    text: "Old pending To Do",
    rawText: "Old pending raw",
  }).todo;
  manager.db
    .prepare("UPDATE todo_items SET created_at = ? WHERE id = ?")
    .run("2026-07-09 00:00:00", pendingTodo.id);

  const actionedTodo = manager.saveTodo({
    externalId: externalIdFor(2),
    title: "Old actioned",
    text: "Old actioned To Do",
    rawText: "Old actioned raw",
  }).todo;
  manager.markTodoActioned(actionedTodo.id);
  manager.db
    .prepare("UPDATE todo_items SET created_at = ?, actioned_at = ? WHERE id = ?")
    .run("2026-06-01 00:00:00", "2026-08-09 00:00:00", actionedTodo.id);
  manager.saveReprocessingAlternative({
    todoId: actionedTodo.id,
    mode: "codex-prompt",
    text: "Old To Do prompt alternative",
  });
  manager.setCorrectionFlag({ todoId: actionedTodo.id, reason: "prompt" });

  const exactCutoff = manager.saveTranscription({
    text: "Exact cutoff stays",
    rawText: "Exact cutoff raw",
  }).transcription;
  manager.db
    .prepare("UPDATE transcriptions SET created_at = ? WHERE id = ?")
    .run("2026-07-10 12:00:00", exactCutoff.id);

  manager.setDictionary(["PreserveMe"]);
  const preservedRule = manager.saveCorrectionRule({
    sourcePhrase: "preserve this phrase",
    replacementText: "Preserved phrase",
  });
  const preservedProfile = manager.saveAppStyleProfile({
    processName: "Preserve App.exe",
    style: "technical",
  });

  const firstSnapshot = manager.buildRetentionDatabaseSnapshot(cutoffIso);
  assert.deepEqual(firstSnapshot.summary, {
    history: 1,
    todos: 2,
    pendingTodos: 1,
    actionedTodos: 1,
    alternatives: 2,
    correctionFlags: 2,
  });

  manager.db
    .prepare("UPDATE transcriptions SET raw_text = ? WHERE id = ?")
    .run("mutated after preview", oldHistory.id);
  assert.throws(
    () => manager.deleteRetentionDatabaseSnapshot(firstSnapshot),
    /changed after the retention preview/i
  );
  assert.equal(
    manager.db
      .prepare("SELECT COUNT(*) AS count FROM transcriptions WHERE id = ?")
      .get(oldHistory.id).count,
    1
  );
  manager.db
    .prepare("UPDATE transcriptions SET raw_text = ? WHERE id = ?")
    .run("Old exact raw History", oldHistory.id);

  const beforeAddedRow = manager.buildRetentionDatabaseSnapshot(cutoffIso);
  const addedHistory = manager.saveTranscription({
    text: "Added after preview",
    rawText: "raw",
  }).transcription;
  manager.db
    .prepare("UPDATE transcriptions SET created_at = ? WHERE id = ?")
    .run("2026-01-01 00:00:00", addedHistory.id);
  assert.throws(
    () => manager.deleteRetentionDatabaseSnapshot(beforeAddedRow),
    /changed after the retention preview/i
  );

  const beforeDependent = manager.buildRetentionDatabaseSnapshot(cutoffIso);
  manager.saveReprocessingAlternative({
    transcriptionId: addedHistory.id,
    mode: "cleanup",
    text: "Added dependent after preview",
  });
  assert.throws(
    () => manager.deleteRetentionDatabaseSnapshot(beforeDependent),
    /changed after the retention preview/i
  );

  const rollbackSnapshot = manager.buildRetentionDatabaseSnapshot(cutoffIso);
  manager.db.exec(`
    CREATE TRIGGER retention_test_abort
    BEFORE DELETE ON todo_items
    WHEN OLD.id = ${actionedTodo.id}
    BEGIN
      SELECT RAISE(ABORT, 'retention rollback test');
    END
  `);
  assert.throws(
    () => manager.deleteRetentionDatabaseSnapshot(rollbackSnapshot),
    /retention rollback test/i
  );
  assert.equal(
    manager.db
      .prepare("SELECT COUNT(*) AS count FROM transcriptions WHERE id IN (?, ?)")
      .get(oldHistory.id, addedHistory.id).count,
    2
  );
  assert.equal(
    manager.db
      .prepare("SELECT COUNT(*) AS count FROM todo_items WHERE id IN (?, ?)")
      .get(pendingTodo.id, actionedTodo.id).count,
    2
  );
  manager.db.exec("DROP TRIGGER retention_test_abort");

  const finalSnapshot = manager.buildRetentionDatabaseSnapshot(cutoffIso);
  const result = manager.deleteRetentionDatabaseSnapshot(finalSnapshot);
  assert.deepEqual(result, {
    success: true,
    historyDeleted: 2,
    todosDeleted: 2,
    pendingTodosDeleted: 1,
    actionedTodosDeleted: 1,
    alternativesDeleted: 3,
    correctionFlagsDeleted: 2,
  });
  assert.equal(
    manager.db.prepare("SELECT COUNT(*) AS count FROM reprocessing_alternatives").get().count,
    0
  );
  assert.equal(manager.db.prepare("SELECT COUNT(*) AS count FROM correction_flags").get().count, 0);
  assert.equal(
    manager.db.prepare("SELECT text FROM transcriptions WHERE id = ?").get(exactCutoff.id).text,
    "Exact cutoff stays"
  );
  assert.deepEqual(manager.getDictionary(), ["PreserveMe"]);
  assert.equal(manager.getCorrectionRules()[0].id, preservedRule.id);
  assert.equal(manager.getAppStyleProfiles()[0].id, preservedProfile.id);
  assert.deepEqual(manager.db.prepare("PRAGMA foreign_key_check").all(), []);

  console.log("retention database integration: passed");
} finally {
  try {
    manager?.db?.close();
  } catch {}
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}
