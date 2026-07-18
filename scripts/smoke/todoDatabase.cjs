const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-todo-test-"));
const resolvedRoot = path.resolve(root);
const tempRoot = path.resolve(os.tmpdir()) + path.sep;
if (
  !resolvedRoot.startsWith(tempRoot) ||
  !path.basename(resolvedRoot).startsWith("echodraft-todo-test-")
) {
  throw new Error("Refusing unsafe To Do test path");
}

const originalLoad = Module._load;
Module._load = function loadWithElectronAppStub(request, parent, isMain) {
  if (request === "electron") {
    return { app: { getPath: () => resolvedRoot } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const externalIdFor = (number) =>
  `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;

let manager;
let reopened;
try {
  const DatabaseManager = require("../../src/helpers/database");
  manager = new DatabaseManager();

  const firstPayload = {
    externalId: externalIdFor(1),
    title: "Test mobile memo title",
    text: "Test mobile memo 1",
    rawText: "test mobile memo 1",
    meta: {
      device: { platform: "android", name: "Test phone" },
      steps: ["record", "send"],
    },
  };
  const first = manager.saveTodo(firstPayload);
  assert.equal(first.created, true);
  assert.equal(first.todo.payload_hash, undefined);
  assert.equal(first.todo.meta.title, "Test mobile memo title");

  const reorderedRetry = manager.saveTodo({
    ...firstPayload,
    meta: {
      steps: ["record", "send"],
      device: { name: "Test phone", platform: "android" },
    },
  });
  assert.equal(reorderedRetry.created, false);
  assert.equal(reorderedRetry.id, first.id);

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.throws(
      () => manager.saveTodo({ ...firstPayload, text: "Different memo" }),
      /different content/i
    );
  } finally {
    console.error = originalConsoleError;
  }

  manager.db.transaction(() => {
    for (let index = 2; index <= 101; index += 1) {
      manager.saveTodo({
        externalId: externalIdFor(index),
        text: `Test mobile memo ${index}`,
        meta: { source: "android" },
      });
    }
  })();

  const firstPage = manager.getPendingTodos(100);
  assert.equal(firstPage.length, 100);
  assert.deepEqual(Object.keys(firstPage[0]).sort(), ["created_at", "id", "text", "title"]);
  assert.equal(
    firstPage.some((item) => item.id === first.id),
    false
  );
  const newest = firstPage[0];
  assert.equal(manager.markTodoActioned(newest.id).alreadyActioned, false);
  assert.equal(manager.markTodoActioned(newest.id).alreadyActioned, true);

  const backfilledPage = manager.getPendingTodos(100);
  assert.equal(backfilledPage.length, 100);
  assert.equal(
    backfilledPage.some((item) => item.id === first.id),
    true
  );
  assert.equal(
    backfilledPage.find((item) => item.id === first.id)?.title,
    "Test mobile memo title"
  );

  const history = manager.saveTranscription({ text: "History still works" });
  assert.equal(history.success, true);
  assert.equal(manager.getTranscriptions(10).length, 1);

  manager.db.close();
  manager = null;
  reopened = new DatabaseManager();
  const reopenedTodos = reopened.getPendingTodos(100);
  assert.equal(reopenedTodos.length, 100);
  assert.equal(
    reopenedTodos.find((item) => item.id === first.id)?.title,
    "Test mobile memo title"
  );
  assert.equal(reopened.markTodoActioned(newest.id).alreadyActioned, true);
  assert.equal(reopened.getTranscriptions(10).length, 1);

  console.log("todo database integration: passed");
} finally {
  try {
    manager?.db?.close();
  } catch {}
  try {
    reopened?.db?.close();
  } catch {}
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}
