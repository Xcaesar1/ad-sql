import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function ensureDataDirs(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "uploads"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "downloads"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "tmp"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "chrome-profile"), { recursive: true });
}

export function createDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS asins (
      asin TEXT PRIMARY KEY,
      country TEXT NOT NULL DEFAULT 'US',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      last_collection_status TEXT NOT NULL DEFAULT 'never',
      last_success_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS block_words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asin TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'US',
      period TEXT NOT NULL DEFAULT 'latelyDay:7',
      source_type TEXT NOT NULL,
      status TEXT NOT NULL,
      file_path TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (asin) REFERENCES asins(asin)
    );

    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER NOT NULL,
      asin TEXT NOT NULL,
      keyword TEXT NOT NULL,
      translation TEXT NOT NULL DEFAULT '',
      organic_rank INTEGER,
      organic_rank_detail TEXT NOT NULL DEFAULT '',
      organic_page INTEGER,
      organic_rank_position INTEGER,
      organic_total INTEGER,
      sp_rank INTEGER,
      sp_rank_detail TEXT NOT NULL DEFAULT '',
      sp_page INTEGER,
      sp_rank_position INTEGER,
      sp_total INTEGER,
      weekly_search_trend INTEGER,
      raw_json TEXT NOT NULL,
      source_row_number INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
      FOREIGN KEY (asin) REFERENCES asins(asin)
    );

    CREATE INDEX IF NOT EXISTS idx_collections_asin_created ON collections (asin, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_keywords_collection ON keywords (collection_id);
    CREATE INDEX IF NOT EXISTS idx_keywords_asin_keyword ON keywords (asin, keyword);
  `);
}
