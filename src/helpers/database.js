const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { app } = require("electron");
const {
  MAX_TODO_PAGE_SIZE,
  normalizeCleanupTitle,
  normalizeTodoPayload,
} = require("./todoPayload");

class DatabaseManager {
  constructor() {
    this.db = null;
    this.initDatabase();
  }

  initDatabase() {
    try {
      const dbFileName =
        process.env.NODE_ENV === "development" ? "transcriptions-dev.db" : "transcriptions.db";

      const dbPath = path.join(app.getPath("userData"), dbFileName);

      this.db = new Database(dbPath);

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
          ON todo_items(status, created_at DESC)
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
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const normalized = this.normalizeSavePayload(payload);
      const stmt = this.db.prepare(
        "INSERT INTO transcriptions (text, raw_text, meta_json) VALUES (?, ?, ?)"
      );
      const result = stmt.run(normalized.text, normalized.rawText, normalized.metaJson);

      const fetchStmt = this.db.prepare("SELECT * FROM transcriptions WHERE id = ?");
      const transcription = this.hydrateTranscriptionRow(fetchStmt.get(result.lastInsertRowid));

      return { id: result.lastInsertRowid, success: true, transcription };
    } catch (error) {
      console.error("Error saving transcription:", error.message);
      throw error;
    }
  }

  getTranscriptions(limit = 50) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare("SELECT * FROM transcriptions ORDER BY timestamp DESC LIMIT ?");
      const transcriptions = stmt.all(limit).map((row) => this.hydrateTranscriptionRow(row));
      return transcriptions;
    } catch (error) {
      console.error("Error getting transcriptions:", error.message);
      throw error;
    }
  }

  getLatestTranscription() {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare("SELECT * FROM transcriptions ORDER BY timestamp DESC LIMIT 1");
      return this.hydrateTranscriptionRow(stmt.get()) || null;
    } catch (error) {
      console.error("Error getting latest transcription:", error.message);
      throw error;
    }
  }

  getAllTranscriptions() {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare("SELECT * FROM transcriptions ORDER BY timestamp DESC");
      return stmt.all().map((row) => this.hydrateTranscriptionRow(row));
    } catch (error) {
      console.error("Error getting all transcriptions:", error.message);
      throw error;
    }
  }

  patchTranscriptionMeta(id, patchMeta = {}) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }

      const fetchStmt = this.db.prepare("SELECT * FROM transcriptions WHERE id = ?");
      const current = this.hydrateTranscriptionRow(fetchStmt.get(id));
      if (!current) {
        return { success: false, message: "Transcription not found" };
      }

      const mergedMeta = this.mergeMeta(current.meta || {}, patchMeta);
      const metaJson = JSON.stringify(mergedMeta);
      const updateStmt = this.db.prepare("UPDATE transcriptions SET meta_json = ? WHERE id = ?");
      updateStmt.run(metaJson, id);

      const updated = this.hydrateTranscriptionRow(fetchStmt.get(id));
      return { success: true, transcription: updated };
    } catch (error) {
      console.error("Error patching transcription metadata:", error.message);
      throw error;
    }
  }

  clearTranscriptions() {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
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
      if (!this.db) {
        throw new Error("Database not initialized");
      }
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
      if (!this.db) {
        throw new Error("Database not initialized");
      }

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
        todo: this.hydrateTodoRow(saved),
      };
    } catch (error) {
      console.error("Error saving To Do item:", error.message);
      throw error;
    }
  }

  getPendingTodos(limit = MAX_TODO_PAGE_SIZE) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const rows = this.db
        .prepare(
          "SELECT id, text, meta_json, created_at FROM todo_items WHERE status = 'pending' ORDER BY created_at DESC, id DESC LIMIT ?"
        )
        .all(limit);
      return rows.map((row) => {
        let metadata = {};
        try {
          metadata = JSON.parse(row.meta_json || "{}");
        } catch {}
        return {
          id: row.id,
          text: row.text,
          title: normalizeCleanupTitle(metadata?.title),
          created_at: row.created_at,
        };
      });
    } catch (error) {
      console.error("Error getting To Do items:", error.message);
      throw error;
    }
  }

  markTodoActioned(id) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }

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

  getDictionary() {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
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
      if (!this.db) {
        throw new Error("Database not initialized");
      }
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
