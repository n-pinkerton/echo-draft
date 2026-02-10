const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { app } = require("electron");

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
