const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { app } = require("electron");
const {
  MAX_TODO_PAGE_SIZE,
  UUID_PATTERN,
  normalizeCleanupTitle,
  normalizeTodoPayload,
} = require("./todoPayload");
const {
  MAX_CORRECTION_PHRASE_LENGTH,
  MAX_CORRECTION_REPLACEMENT_LENGTH,
  MAX_CORRECTION_RULES,
  areCorrectionPhrasesEquivalent,
} = require("../utils/correctionRules.cjs");

const ARCHIVED_TODO_PAGE_SIZE = 25;
const MAX_ARCHIVED_TODO_QUERY_LENGTH = 200;
const CORRECTION_REASONS = new Set(["transcription", "cleanup", "prompt", "paste-delivery"]);
const APP_WRITING_STYLES = new Set(["document", "message", "technical"]);
const REPROCESSING_MODES = new Set(["cleanup", "codex-prompt"]);

const parseDatabaseTimestamp = (value) => {
  if (typeof value !== "string" || !value.trim()) return NaN;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value.trim())
    ? `${value.trim().replace(" ", "T")}Z`
    : value.trim();
  return Date.parse(normalized);
};

const parseCanonicalMobileTimestamp = (value) => {
  if (typeof value !== "string" || !value || value.length > 64) return NaN;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) return NaN;
  return parsed;
};

const todoSortEpoch = (metaJson, createdAt) => {
  try {
    const metadata = JSON.parse(typeof metaJson === "string" ? metaJson : "{}");
    const mobileCreatedAt = metadata?.mobileInbox?.createdAt;
    const parsed = parseCanonicalMobileTimestamp(mobileCreatedAt);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  } catch {}
  const fallback = parseDatabaseTimestamp(createdAt);
  return Number.isFinite(fallback) ? Math.trunc(fallback) : 0;
};

const todoMatchesArchivedSearch = (text, rawText, metaJson, query) => {
  const needle = typeof query === "string" ? query.toLocaleLowerCase() : "";
  if (!needle) return 1;
  let title = "";
  try {
    const metadata = JSON.parse(typeof metaJson === "string" ? metaJson : "{}");
    title = typeof metadata?.title === "string" ? metadata.title : "";
  } catch {}
  return [text, rawText, title].some(
    (value) => typeof value === "string" && value.toLocaleLowerCase().includes(needle)
  )
    ? 1
    : 0;
};

const normalizeProcessName = (value) => {
  const processName = typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
  if (
    !processName ||
    processName.length > 128 ||
    /[\u0000-\u001f\u007f\\/:*?"<>|]/u.test(processName)
  ) {
    throw new Error("Invalid application process name");
  }
  return processName;
};

const requirePositiveId = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${label}`);
  return value;
};

const RETENTION_SNAPSHOT_VERSION = 1;
const retentionFingerprint = (values) =>
  crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex");

const normalizeRetentionCutoff = (value) => {
  if (typeof value !== "string") throw new Error("Retention cutoff must be an ISO timestamp");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error("Retention cutoff must be an exact UTC ISO timestamp");
  }
  return value;
};

const fingerprintRetentionSource = (table, row) => {
  if (table === "transcriptions") {
    return retentionFingerprint([
      table,
      row.id,
      row.text,
      row.raw_text,
      row.meta_json,
      row.timestamp,
      row.created_at,
    ]);
  }
  return retentionFingerprint([
    table,
    row.id,
    row.external_id,
    row.payload_hash,
    row.text,
    row.raw_text,
    row.meta_json,
    row.status,
    row.created_at,
    row.actioned_at,
  ]);
};

const fingerprintRetentionDependent = (table, row) =>
  retentionFingerprint([
    table,
    row.id,
    row.transcription_id,
    row.todo_id,
    row.mode ?? null,
    row.text ?? null,
    row.meta_json ?? null,
    row.reason ?? null,
    row.created_at,
    row.updated_at ?? null,
  ]);

class DatabaseManager {
  constructor() {
    this.db = null;
    this.retentionMutationLocked = false;
    this.initDatabase();
  }

  initDatabase() {
    try {
      const dbFileName =
        process.env.NODE_ENV === "development" ? "transcriptions-dev.db" : "transcriptions.db";

      const dbPath = path.join(app.getPath("userData"), dbFileName);

      this.db = new Database(dbPath);
      this.db.pragma("foreign_keys = ON");
      this.db.function("echodraft_todo_sort_epoch", { deterministic: true }, todoSortEpoch);
      this.db.function(
        "echodraft_todo_matches_archived_search",
        { deterministic: true },
        todoMatchesArchivedSearch
      );

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS transcriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          text TEXT NOT NULL,
          raw_text TEXT,
          meta_json TEXT NOT NULL DEFAULT '{}',
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      this.ensureTranscriptionsSchema();

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS custom_dictionary (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          word TEXT NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS todo_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          external_id TEXT NOT NULL UNIQUE,
          payload_hash TEXT NOT NULL,
          text TEXT NOT NULL,
          raw_text TEXT,
          meta_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'actioned')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          actioned_at DATETIME
        );
        CREATE INDEX IF NOT EXISTS idx_todo_items_pending
          ON todo_items(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_todo_items_actioned
          ON todo_items(status, created_at DESC, id DESC);

        CREATE TABLE IF NOT EXISTS reprocessing_alternatives (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transcription_id INTEGER REFERENCES transcriptions(id) ON DELETE CASCADE,
          todo_id INTEGER REFERENCES todo_items(id) ON DELETE CASCADE,
          mode TEXT NOT NULL CHECK (mode IN ('cleanup', 'codex-prompt')),
          text TEXT NOT NULL,
          meta_json TEXT NOT NULL DEFAULT '{}',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK ((transcription_id IS NOT NULL) <> (todo_id IS NOT NULL))
        );
        CREATE INDEX IF NOT EXISTS idx_reprocessing_alternatives_transcription
          ON reprocessing_alternatives(transcription_id, created_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_reprocessing_alternatives_todo
          ON reprocessing_alternatives(todo_id, created_at DESC, id DESC);

        CREATE TABLE IF NOT EXISTS correction_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_phrase TEXT NOT NULL COLLATE NOCASE UNIQUE,
          replacement_text TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS app_style_profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          process_name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          style TEXT NOT NULL CHECK (style IN ('document', 'message', 'technical')),
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS correction_flags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transcription_id INTEGER REFERENCES transcriptions(id) ON DELETE CASCADE,
          todo_id INTEGER REFERENCES todo_items(id) ON DELETE CASCADE,
          reason TEXT NOT NULL CHECK (reason IN ('transcription', 'cleanup', 'prompt', 'paste-delivery')),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK ((transcription_id IS NOT NULL) <> (todo_id IS NOT NULL))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_correction_flags_transcription
          ON correction_flags(transcription_id) WHERE transcription_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_correction_flags_todo
          ON correction_flags(todo_id) WHERE todo_id IS NOT NULL
      `);

      return true;
    } catch (error) {
      console.error("Database initialization failed:", error.message);
      throw error;
    }
  }

  ensureTranscriptionsSchema() {
    if (!this.db) return;
    const columns = this.db.prepare("PRAGMA table_info(transcriptions)").all();
    const hasRawText = columns.some((column) => column.name === "raw_text");
    const hasMetaJson = columns.some((column) => column.name === "meta_json");

    if (!hasRawText) {
      this.db.exec("ALTER TABLE transcriptions ADD COLUMN raw_text TEXT");
    }

    if (!hasMetaJson) {
      this.db.exec("ALTER TABLE transcriptions ADD COLUMN meta_json TEXT DEFAULT '{}'");
    }
  }

  assertReady() {
    if (!this.db) throw new Error("Database not initialized");
  }

  assertWritable() {
    this.assertReady();
    if (this.retentionMutationLocked) {
      throw new Error("Database changes are temporarily paused for retention cleanup");
    }
  }

  withRetentionMutationLock(callback) {
    this.assertReady();
    if (this.retentionMutationLocked) {
      throw new Error("Retention cleanup is already running");
    }
    this.retentionMutationLocked = true;
    try {
      return callback();
    } finally {
      this.retentionMutationLocked = false;
    }
  }

  normalizeSavePayload(payload) {
    if (typeof payload === "string") {
      return {
        text: payload,
        rawText: null,
        metaJson: "{}",
      };
    }

    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid transcription payload");
    }

    const text = typeof payload.text === "string" ? payload.text : "";
    if (!text.trim()) {
      throw new Error("Transcription text is required");
    }

    const rawText =
      typeof payload.rawText === "string" && payload.rawText.trim() ? payload.rawText : null;
    let metaJson = "{}";
    if (payload.meta && typeof payload.meta === "object") {
      try {
        metaJson = JSON.stringify(payload.meta);
      } catch {
        metaJson = "{}";
      }
    }

    return { text, rawText, metaJson };
  }

  hydrateTranscriptionRow(row) {
    if (!row) return row;
    const hydrated = { ...row };
    if (typeof hydrated.meta_json !== "string" || !hydrated.meta_json.trim()) {
      hydrated.meta_json = "{}";
    }
    try {
      hydrated.meta = JSON.parse(hydrated.meta_json);
    } catch {
      hydrated.meta = {};
    }
    return hydrated;
  }

  hydrateTodoRow(row) {
    if (!row) return row;
    const hydrated = { ...row };
    if (typeof hydrated.meta_json !== "string" || !hydrated.meta_json.trim()) {
      hydrated.meta_json = "{}";
    }
    try {
      hydrated.meta = JSON.parse(hydrated.meta_json);
    } catch {
      hydrated.meta = {};
    }
    delete hydrated.payload_hash;
    return hydrated;
  }

  hydrateAlternativeRow(row) {
    if (!row) return row;
    const hydrated = { ...row };
    try {
      hydrated.meta = JSON.parse(hydrated.meta_json || "{}");
    } catch {
      hydrated.meta = {};
    }
    return hydrated;
  }

  getSourceRelations(sourceType, sourceId) {
    this.assertReady();
    const sourceColumn = sourceType === "transcription" ? "transcription_id" : "todo_id";
    const alternatives = this.db
      .prepare(
        `SELECT * FROM reprocessing_alternatives
         WHERE ${sourceColumn} = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 20`
      )
      .all(sourceId)
      .map((row) => this.hydrateAlternativeRow(row));
    const correctionFlag =
      this.db
        .prepare(
          `SELECT id, reason, created_at, updated_at FROM correction_flags
           WHERE ${sourceColumn} = ?`
        )
        .get(sourceId) || null;
    return { alternatives, correctionFlag };
  }

  hydrateTranscriptionWithRelations(row) {
    const transcription = this.hydrateTranscriptionRow(row);
    if (!transcription) return transcription;
    return {
      ...transcription,
      ...this.getSourceRelations("transcription", transcription.id),
    };
  }

  hydrateTodoWithRelations(row) {
    const todo = this.hydrateTodoRow(row);
    if (!todo) return todo;
    return {
      ...todo,
      title: normalizeCleanupTitle(todo.meta?.title),
      ...(todo.meta?.processingMode === "codex-prompt" ? { processingMode: "codex-prompt" } : {}),
      ...this.getSourceRelations("todo", todo.id),
    };
  }

  mergeMeta(existingMeta = {}, patchMeta = {}) {
    const merged = {
      ...existingMeta,
      ...patchMeta,
    };
    if (existingMeta?.timings || patchMeta?.timings) {
      merged.timings = {
        ...(existingMeta?.timings || {}),
        ...(patchMeta?.timings || {}),
      };
    }
    return merged;
  }

  saveTranscription(payload) {
    try {
      this.assertWritable();
      const normalized = this.normalizeSavePayload(payload);
      const stmt = this.db.prepare(
        "INSERT INTO transcriptions (text, raw_text, meta_json) VALUES (?, ?, ?)"
      );
      const result = stmt.run(normalized.text, normalized.rawText, normalized.metaJson);

      const fetchStmt = this.db.prepare("SELECT * FROM transcriptions WHERE id = ?");
      const transcription = this.hydrateTranscriptionWithRelations(
        fetchStmt.get(result.lastInsertRowid)
      );

      return { id: result.lastInsertRowid, success: true, transcription };
    } catch (error) {
      console.error("Error saving transcription:", error.message);
      throw error;
    }
  }

  getTranscriptions(limit = 50) {
    try {
      this.assertReady();
      const stmt = this.db.prepare("SELECT * FROM transcriptions ORDER BY timestamp DESC LIMIT ?");
      const transcriptions = stmt
        .all(limit)
        .map((row) => this.hydrateTranscriptionWithRelations(row));
      return transcriptions;
    } catch (error) {
      console.error("Error getting transcriptions:", error.message);
      throw error;
    }
  }

  getLatestTranscription() {
    try {
      this.assertReady();
      const stmt = this.db.prepare("SELECT * FROM transcriptions ORDER BY timestamp DESC LIMIT 1");
      return this.hydrateTranscriptionWithRelations(stmt.get()) || null;
    } catch (error) {
      console.error("Error getting latest transcription:", error.message);
      throw error;
    }
  }

  getAllTranscriptions() {
    try {
      this.assertReady();
      const stmt = this.db.prepare("SELECT * FROM transcriptions ORDER BY timestamp DESC");
      return stmt.all().map((row) => this.hydrateTranscriptionWithRelations(row));
    } catch (error) {
      console.error("Error getting all transcriptions:", error.message);
      throw error;
    }
  }

  patchTranscriptionMeta(id, patchMeta = {}) {
    try {
      this.assertWritable();

      const fetchStmt = this.db.prepare("SELECT * FROM transcriptions WHERE id = ?");
      const current = this.hydrateTranscriptionRow(fetchStmt.get(id));
      if (!current) {
        return { success: false, message: "Transcription not found" };
      }

      const mergedMeta = this.mergeMeta(current.meta || {}, patchMeta);
      const metaJson = JSON.stringify(mergedMeta);
      const updateStmt = this.db.prepare("UPDATE transcriptions SET meta_json = ? WHERE id = ?");
      updateStmt.run(metaJson, id);

      const updated = this.hydrateTranscriptionWithRelations(fetchStmt.get(id));
      return { success: true, transcription: updated };
    } catch (error) {
      console.error("Error patching transcription metadata:", error.message);
      throw error;
    }
  }

  clearTranscriptions() {
    try {
      this.assertWritable();
      const stmt = this.db.prepare("DELETE FROM transcriptions");
      const result = stmt.run();
      return { cleared: result.changes, success: true };
    } catch (error) {
      console.error("Error clearing transcriptions:", error.message);
      throw error;
    }
  }

  deleteTranscription(id) {
    try {
      this.assertWritable();
      const stmt = this.db.prepare("DELETE FROM transcriptions WHERE id = ?");
      const result = stmt.run(id);
      console.log(`🗑️ Deleted transcription ${id}, affected rows: ${result.changes}`);
      return { success: result.changes > 0, id };
    } catch (error) {
      console.error("❌ Error deleting transcription:", error);
      throw error;
    }
  }

  saveTodo(payload) {
    try {
      this.assertWritable();

      const normalized = normalizeTodoPayload(payload);
      const result = this.db
        .prepare(
          `INSERT INTO todo_items
            (external_id, payload_hash, text, raw_text, meta_json)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(external_id) DO NOTHING`
        )
        .run(
          normalized.externalId,
          normalized.payloadHash,
          normalized.text,
          normalized.rawText,
          normalized.metaJson
        );
      const saved = this.db
        .prepare("SELECT * FROM todo_items WHERE external_id = ?")
        .get(normalized.externalId);
      if (!saved || saved.payload_hash !== normalized.payloadHash) {
        throw new Error("To Do external ID already has different content");
      }
      return {
        id: saved.id,
        success: true,
        created: result.changes === 1,
        todo: this.hydrateTodoWithRelations(saved),
      };
    } catch (error) {
      console.error("Error saving To Do item:", error.message);
      throw error;
    }
  }

  getTodoByExternalId(externalId) {
    try {
      this.assertReady();
      const normalizedId = typeof externalId === "string" ? externalId.toLowerCase() : "";
      if (!UUID_PATTERN.test(normalizedId)) {
        throw new Error("Invalid To Do external ID");
      }
      const row = this.db
        .prepare("SELECT * FROM todo_items WHERE external_id = ?")
        .get(normalizedId);
      return row ? this.hydrateTodoWithRelations(row) : null;
    } catch (error) {
      console.error("Error getting To Do item:", error.message);
      throw error;
    }
  }

  getPendingTodos(limit = MAX_TODO_PAGE_SIZE) {
    try {
      this.assertReady();
      const rows = this.db
        .prepare(
          "SELECT * FROM todo_items WHERE status = 'pending' ORDER BY created_at DESC, id DESC LIMIT ?"
        )
        .all(limit);
      return rows.map((row) => this.hydrateTodoWithRelations(row));
    } catch (error) {
      console.error("Error getting To Do items:", error.message);
      throw error;
    }
  }

  getPendingTodoCount() {
    this.assertReady();
    return this.db
      .prepare("SELECT COUNT(*) AS count FROM todo_items WHERE status = 'pending'")
      .get().count;
  }

  getNewestPendingTodo() {
    this.assertReady();
    const row = this.db
      .prepare(
        "SELECT * FROM todo_items WHERE status = 'pending' ORDER BY created_at DESC, id DESC LIMIT 1"
      )
      .get();
    return row ? this.hydrateTodoWithRelations(row) : null;
  }

  getArchivedTodos({ query = "", cursor = null, limit = ARCHIVED_TODO_PAGE_SIZE } = {}) {
    try {
      this.assertReady();
      const normalizedQuery = typeof query === "string" ? query.trim() : "";
      if (normalizedQuery.length > MAX_ARCHIVED_TODO_QUERY_LENGTH) {
        throw new Error("Archived To Do search is too long");
      }
      const pageSize = Math.max(1, Math.min(MAX_TODO_PAGE_SIZE, Number(limit) || 0));
      if (!Number.isSafeInteger(pageSize)) throw new Error("Invalid Archived To Do page size");

      let cursorEpoch = null;
      let cursorId = null;
      if (cursor !== null && cursor !== undefined) {
        if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
          throw new Error("Invalid Archived To Do cursor");
        }
        cursorEpoch = Number(cursor.sortEpoch);
        cursorId = Number(cursor.id);
        if (!Number.isSafeInteger(cursorEpoch) || !Number.isSafeInteger(cursorId) || cursorId < 1) {
          throw new Error("Invalid Archived To Do cursor");
        }
      }

      const conditions = ["status = 'actioned'"];
      const parameters = [];
      if (normalizedQuery) {
        conditions.push("echodraft_todo_matches_archived_search(text, raw_text, meta_json, ?) = 1");
        parameters.push(normalizedQuery);
      }
      if (cursorEpoch !== null) {
        conditions.push(
          `(echodraft_todo_sort_epoch(meta_json, created_at) < ? OR (echodraft_todo_sort_epoch(meta_json, created_at) = ? AND id < ?))`
        );
        parameters.push(cursorEpoch, cursorEpoch, cursorId);
      }

      const rows = this.db
        .prepare(
          `SELECT *, echodraft_todo_sort_epoch(meta_json, created_at) AS sort_epoch
           FROM todo_items
           WHERE ${conditions.join(" AND ")}
           ORDER BY sort_epoch DESC, id DESC
           LIMIT ?`
        )
        .all(...parameters, pageSize + 1);
      const hasMore = rows.length > pageSize;
      const visibleRows = hasMore ? rows.slice(0, pageSize) : rows;
      const items = visibleRows.map((row) => {
        const hydrated = this.hydrateTodoWithRelations(row);
        hydrated.sortEpoch = row.sort_epoch;
        return hydrated;
      });
      const last = items.at(-1);
      return {
        items,
        nextCursor: hasMore && last ? { sortEpoch: last.sortEpoch, id: last.id } : null,
      };
    } catch (error) {
      console.error("Error getting Archived To Do items:", error.message);
      throw error;
    }
  }

  markTodoActioned(id) {
    try {
      this.assertWritable();

      const fetch = this.db.prepare("SELECT status FROM todo_items WHERE id = ?");
      const existing = fetch.get(id);
      if (!existing) {
        return { success: false, message: "To Do item not found" };
      }
      if (existing.status === "actioned") {
        return { success: true, alreadyActioned: true };
      }

      const result = this.db
        .prepare(
          "UPDATE todo_items SET status = 'actioned', actioned_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'"
        )
        .run(id);
      return {
        success: true,
        alreadyActioned: result.changes === 0,
      };
    } catch (error) {
      console.error("Error actioning To Do item:", error.message);
      throw error;
    }
  }

  saveReprocessingAlternative(payload) {
    try {
      this.assertWritable();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Invalid reprocessing alternative");
      }
      const transcriptionId = payload.transcriptionId ?? null;
      const todoId = payload.todoId ?? null;
      if ((transcriptionId === null) === (todoId === null)) {
        throw new Error("A reprocessing alternative must have one source");
      }
      if (transcriptionId !== null) requirePositiveId(transcriptionId, "transcription id");
      if (todoId !== null) requirePositiveId(todoId, "To Do id");
      if (!REPROCESSING_MODES.has(payload.mode)) {
        throw new Error("Invalid reprocessing mode");
      }
      const text = typeof payload.text === "string" ? payload.text : "";
      if (!text.trim()) throw new Error("Reprocessing output is required");
      let metaJson = "{}";
      if (payload.meta && typeof payload.meta === "object" && !Array.isArray(payload.meta)) {
        metaJson = JSON.stringify(payload.meta);
      }
      const result = this.db
        .prepare(
          `INSERT INTO reprocessing_alternatives
            (transcription_id, todo_id, mode, text, meta_json)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(transcriptionId, todoId, payload.mode, text, metaJson);
      const row = this.db
        .prepare("SELECT * FROM reprocessing_alternatives WHERE id = ?")
        .get(result.lastInsertRowid);
      return { success: true, alternative: this.hydrateAlternativeRow(row) };
    } catch (error) {
      console.error("Error saving reprocessing alternative:", error.message);
      throw error;
    }
  }

  getCorrectionRules() {
    this.assertReady();
    return this.db
      .prepare(
        `SELECT id, source_phrase AS sourcePhrase, replacement_text AS replacementText,
                enabled, created_at AS createdAt, updated_at AS updatedAt
         FROM correction_rules ORDER BY id ASC`
      )
      .all()
      .map((row) => ({ ...row, enabled: row.enabled === 1 }));
  }

  saveCorrectionRule(payload) {
    try {
      this.assertWritable();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Invalid correction rule");
      }
      const sourcePhrase =
        typeof payload.sourcePhrase === "string" ? payload.sourcePhrase.trim() : "";
      const replacementText =
        typeof payload.replacementText === "string" ? payload.replacementText.trim() : "";
      if (!sourcePhrase || sourcePhrase.length > MAX_CORRECTION_PHRASE_LENGTH) {
        throw new Error("Invalid correction source phrase");
      }
      if (!replacementText || replacementText.length > MAX_CORRECTION_REPLACEMENT_LENGTH) {
        throw new Error("Invalid correction replacement");
      }
      const enabled = payload.enabled === false ? 0 : 1;
      const id = payload.id ?? null;
      if (id !== null) requirePositiveId(id, "correction rule id");
      const equivalentRule = this.getCorrectionRules().find(
        (rule) => rule.id !== id && areCorrectionPhrasesEquivalent(rule.sourcePhrase, sourcePhrase)
      );
      if (equivalentRule) {
        throw new Error("An equivalent correction source phrase already exists");
      }
      if (id === null) {
        if (this.getCorrectionRules().length >= MAX_CORRECTION_RULES) {
          throw new Error("Correction rule limit reached");
        }
        const result = this.db
          .prepare(
            `INSERT INTO correction_rules (source_phrase, replacement_text, enabled)
             VALUES (?, ?, ?)`
          )
          .run(sourcePhrase, replacementText, enabled);
        return { success: true, id: Number(result.lastInsertRowid) };
      }
      const result = this.db
        .prepare(
          `UPDATE correction_rules
           SET source_phrase = ?, replacement_text = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .run(sourcePhrase, replacementText, enabled, id);
      if (result.changes !== 1) throw new Error("Correction rule not found");
      return { success: true, id };
    } catch (error) {
      console.error("Error saving correction rule:", error.message);
      throw error;
    }
  }

  deleteCorrectionRule(id) {
    this.assertWritable();
    requirePositiveId(id, "correction rule id");
    const result = this.db.prepare("DELETE FROM correction_rules WHERE id = ?").run(id);
    return { success: result.changes === 1 };
  }

  getAppStyleProfiles() {
    this.assertReady();
    return this.db
      .prepare(
        `SELECT id, process_name AS processName, style, enabled,
                created_at AS createdAt, updated_at AS updatedAt
         FROM app_style_profiles ORDER BY process_name COLLATE NOCASE ASC`
      )
      .all()
      .map((row) => ({ ...row, enabled: row.enabled === 1 }));
  }

  getAppStyleForProcess(processName) {
    this.assertReady();
    const normalized = normalizeProcessName(processName);
    const row = this.db
      .prepare(
        "SELECT style FROM app_style_profiles WHERE process_name = ? COLLATE NOCASE AND enabled = 1"
      )
      .get(normalized);
    return row?.style || null;
  }

  getWritingPreferences(processName = null) {
    const correctionRules = this.getCorrectionRules().filter((rule) => rule.enabled);
    let writingStyle = null;
    if (typeof processName === "string" && processName.trim()) {
      try {
        writingStyle = this.getAppStyleForProcess(processName);
      } catch {
        writingStyle = null;
      }
    }
    return {
      correctionRules,
      writingStyle,
    };
  }

  saveAppStyleProfile(payload) {
    try {
      this.assertWritable();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Invalid application style profile");
      }
      const processName = normalizeProcessName(payload.processName);
      if (!APP_WRITING_STYLES.has(payload.style)) throw new Error("Invalid application style");
      const enabled = payload.enabled === false ? 0 : 1;
      const id = payload.id ?? null;
      if (id === null) {
        const result = this.db
          .prepare(
            `INSERT INTO app_style_profiles (process_name, style, enabled)
             VALUES (?, ?, ?)`
          )
          .run(processName, payload.style, enabled);
        return { success: true, id: Number(result.lastInsertRowid) };
      }
      requirePositiveId(id, "application style profile id");
      const result = this.db
        .prepare(
          `UPDATE app_style_profiles
           SET process_name = ?, style = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .run(processName, payload.style, enabled, id);
      if (result.changes !== 1) throw new Error("Application style profile not found");
      return { success: true, id };
    } catch (error) {
      console.error("Error saving application style profile:", error.message);
      throw error;
    }
  }

  deleteAppStyleProfile(id) {
    this.assertWritable();
    requirePositiveId(id, "application style profile id");
    const result = this.db.prepare("DELETE FROM app_style_profiles WHERE id = ?").run(id);
    return { success: result.changes === 1 };
  }

  setCorrectionFlag(payload) {
    try {
      this.assertWritable();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Invalid correction flag");
      }
      const transcriptionId = payload.transcriptionId ?? null;
      const todoId = payload.todoId ?? null;
      if ((transcriptionId === null) === (todoId === null)) {
        throw new Error("A correction flag must have one source");
      }
      if (!CORRECTION_REASONS.has(payload.reason)) throw new Error("Invalid correction reason");
      const sourceColumn = transcriptionId !== null ? "transcription_id" : "todo_id";
      const sourceId = transcriptionId !== null ? transcriptionId : todoId;
      requirePositiveId(sourceId, transcriptionId !== null ? "transcription id" : "To Do id");
      this.db
        .prepare(
          `INSERT INTO correction_flags (${sourceColumn}, reason)
           VALUES (?, ?)
           ON CONFLICT(${sourceColumn}) WHERE ${sourceColumn} IS NOT NULL
           DO UPDATE SET reason = excluded.reason, updated_at = CURRENT_TIMESTAMP`
        )
        .run(sourceId, payload.reason);
      return {
        success: true,
        correctionFlag: this.getSourceRelations(
          transcriptionId !== null ? "transcription" : "todo",
          sourceId
        ).correctionFlag,
      };
    } catch (error) {
      console.error("Error setting correction flag:", error.message);
      throw error;
    }
  }

  clearCorrectionFlag(payload) {
    this.assertWritable();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Invalid correction flag source");
    }
    const transcriptionId = payload.transcriptionId ?? null;
    const todoId = payload.todoId ?? null;
    if ((transcriptionId === null) === (todoId === null)) {
      throw new Error("A correction flag must have one source");
    }
    const sourceColumn = transcriptionId !== null ? "transcription_id" : "todo_id";
    const sourceId = transcriptionId !== null ? transcriptionId : todoId;
    requirePositiveId(sourceId, transcriptionId !== null ? "transcription id" : "To Do id");
    const result = this.db
      .prepare(`DELETE FROM correction_flags WHERE ${sourceColumn} = ?`)
      .run(sourceId);
    return { success: true, cleared: result.changes };
  }

  buildRetentionDatabaseSnapshot(cutoffIso) {
    this.assertReady();
    const cutoff = normalizeRetentionCutoff(cutoffIso);
    const transcriptionRows = this.db
      .prepare(
        `SELECT id, text, raw_text, meta_json, timestamp, created_at
         FROM transcriptions
         WHERE julianday(created_at) < julianday(?)
         ORDER BY id ASC`
      )
      .all(cutoff);
    const todoRows = this.db
      .prepare(
        `SELECT id, external_id, payload_hash, text, raw_text, meta_json, status,
                created_at, actioned_at
         FROM todo_items
         WHERE julianday(created_at) < julianday(?)
         ORDER BY id ASC`
      )
      .all(cutoff);
    const alternativeRows = this.db
      .prepare(
        `SELECT alternative.id, alternative.transcription_id, alternative.todo_id,
                alternative.mode, alternative.text, alternative.meta_json, alternative.created_at
         FROM reprocessing_alternatives AS alternative
         LEFT JOIN transcriptions AS transcription
           ON transcription.id = alternative.transcription_id
         LEFT JOIN todo_items AS todo
           ON todo.id = alternative.todo_id
         WHERE (transcription.id IS NOT NULL
                AND julianday(transcription.created_at) < julianday(?))
            OR (todo.id IS NOT NULL AND julianday(todo.created_at) < julianday(?))
         ORDER BY alternative.id ASC`
      )
      .all(cutoff, cutoff);
    const flagRows = this.db
      .prepare(
        `SELECT flag.id, flag.transcription_id, flag.todo_id, flag.reason,
                flag.created_at, flag.updated_at
         FROM correction_flags AS flag
         LEFT JOIN transcriptions AS transcription
           ON transcription.id = flag.transcription_id
         LEFT JOIN todo_items AS todo
           ON todo.id = flag.todo_id
         WHERE (transcription.id IS NOT NULL
                AND julianday(transcription.created_at) < julianday(?))
            OR (todo.id IS NOT NULL AND julianday(todo.created_at) < julianday(?))
         ORDER BY flag.id ASC`
      )
      .all(cutoff, cutoff);

    const sources = [
      ...transcriptionRows.map((row) => ({
        table: "transcriptions",
        id: row.id,
        createdAt: row.created_at,
        fingerprint: fingerprintRetentionSource("transcriptions", row),
      })),
      ...todoRows.map((row) => ({
        table: "todo_items",
        id: row.id,
        createdAt: row.created_at,
        status: row.status,
        fingerprint: fingerprintRetentionSource("todo_items", row),
      })),
    ];
    const dependents = [
      ...alternativeRows.map((row) => ({
        table: "reprocessing_alternatives",
        id: row.id,
        transcriptionId: row.transcription_id,
        todoId: row.todo_id,
        fingerprint: fingerprintRetentionDependent("reprocessing_alternatives", row),
      })),
      ...flagRows.map((row) => ({
        table: "correction_flags",
        id: row.id,
        transcriptionId: row.transcription_id,
        todoId: row.todo_id,
        fingerprint: fingerprintRetentionDependent("correction_flags", row),
      })),
    ];
    const summary = {
      history: transcriptionRows.length,
      todos: todoRows.length,
      pendingTodos: todoRows.filter((row) => row.status === "pending").length,
      actionedTodos: todoRows.filter((row) => row.status === "actioned").length,
      alternatives: alternativeRows.length,
      correctionFlags: flagRows.length,
    };
    const snapshotFingerprint = retentionFingerprint([
      RETENTION_SNAPSHOT_VERSION,
      cutoff,
      sources,
      dependents,
      summary,
    ]);
    return {
      version: RETENTION_SNAPSHOT_VERSION,
      cutoffIso: cutoff,
      sources,
      dependents,
      summary,
      snapshotFingerprint,
    };
  }

  deleteRetentionDatabaseSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new Error("Retention database snapshot is required");
    }
    const cutoff = normalizeRetentionCutoff(snapshot.cutoffIso);
    return this.withRetentionMutationLock(() => {
      const current = this.buildRetentionDatabaseSnapshot(cutoff);
      if (JSON.stringify(current) !== JSON.stringify(snapshot)) {
        const error = new Error(
          "History or To Do data changed after the retention preview; nothing was deleted"
        );
        error.code = "RETENTION_MANIFEST_CHANGED";
        throw error;
      }

      const removeSources = this.db.transaction(() => {
        const deleteTranscription = this.db.prepare("DELETE FROM transcriptions WHERE id = ?");
        const deleteTodo = this.db.prepare("DELETE FROM todo_items WHERE id = ?");
        let historyDeleted = 0;
        let todosDeleted = 0;
        for (const source of current.sources) {
          const result =
            source.table === "transcriptions"
              ? deleteTranscription.run(source.id)
              : deleteTodo.run(source.id);
          if (result.changes !== 1) {
            throw new Error(
              `Retention source ${source.table}:${source.id} changed during deletion`
            );
          }
          if (source.table === "transcriptions") historyDeleted += 1;
          else todosDeleted += 1;
        }
        const foreignKeyErrors = this.db.prepare("PRAGMA foreign_key_check").all();
        if (foreignKeyErrors.length > 0) {
          throw new Error("Retention deletion would leave invalid database references");
        }
        return { historyDeleted, todosDeleted };
      });

      const deleted = removeSources();
      return {
        success: true,
        ...deleted,
        pendingTodosDeleted: current.summary.pendingTodos,
        actionedTodosDeleted: current.summary.actionedTodos,
        alternativesDeleted: current.summary.alternatives,
        correctionFlagsDeleted: current.summary.correctionFlags,
      };
    });
  }

  getDictionary() {
    try {
      this.assertReady();
      const stmt = this.db.prepare("SELECT word FROM custom_dictionary ORDER BY id ASC");
      const rows = stmt.all();
      return rows.map((row) => row.word);
    } catch (error) {
      console.error("Error getting dictionary:", error.message);
      throw error;
    }
  }

  setDictionary(words) {
    try {
      this.assertWritable();
      const transaction = this.db.transaction((wordList) => {
        this.db.prepare("DELETE FROM custom_dictionary").run();
        const insert = this.db.prepare("INSERT OR IGNORE INTO custom_dictionary (word) VALUES (?)");
        for (const word of wordList) {
          const trimmed = typeof word === "string" ? word.trim() : "";
          if (trimmed) {
            insert.run(trimmed);
          }
        }
      });
      transaction(words);
      return { success: true };
    } catch (error) {
      console.error("Error setting dictionary:", error.message);
      throw error;
    }
  }

  cleanup() {
    console.log("Starting database cleanup...");
    try {
      const dbPath = path.join(
        app.getPath("userData"),
        process.env.NODE_ENV === "development" ? "transcriptions-dev.db" : "transcriptions.db"
      );
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        console.log("✅ Database file deleted:", dbPath);
      }
    } catch (error) {
      console.error("❌ Error deleting database file:", error);
    }
  }
}

module.exports = DatabaseManager;
