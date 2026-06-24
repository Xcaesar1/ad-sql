import fs from "node:fs";
import path from "node:path";
import { applyBlockWords, normalizeBlockWord } from "./blockWords.js";
import { createPageDistribution } from "./rankings.js";
import { nowIso, safeTimestamp } from "./time.js";
import { parseSifWorkbook } from "./xlsxParser.js";

const ASIN_RE = /^[A-Z0-9]{10}$/;

export function normalizeAsin(asin) {
  return String(asin || "").trim().toUpperCase();
}

export function assertValidAsin(asin) {
  if (!ASIN_RE.test(asin)) {
    throw Object.assign(new Error("ASIN 必须是 10 位字母或数字"), { statusCode: 400 });
  }
}

function boolFromDb(value) {
  return Boolean(value);
}

function mapAsin(row) {
  return {
    asin: row.asin,
    country: row.country,
    isEnabled: boolFromDb(row.is_enabled),
    isDeleted: boolFromDb(row.is_deleted),
    lastCollectionStatus: row.last_collection_status,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapCollection(row) {
  return {
    id: row.id,
    asin: row.asin,
    country: row.country,
    period: row.period,
    sourceType: row.source_type,
    status: row.status,
    filePath: row.file_path,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}

function mapKeyword(row) {
  return {
    id: row.id,
    collectionId: row.collection_id,
    asin: row.asin,
    keyword: row.keyword,
    translation: row.translation,
    organicRank: row.organic_rank,
    organicRankDetail: row.organic_rank_detail,
    organicPage: row.organic_page,
    organicRankPosition: row.organic_rank_position,
    organicTotal: row.organic_total,
    spRank: row.sp_rank,
    spRankDetail: row.sp_rank_detail,
    spPage: row.sp_page,
    spRankPosition: row.sp_rank_position,
    spTotal: row.sp_total,
    weeklySearchTrend: row.weekly_search_trend,
    sourceRowNumber: row.source_row_number
  };
}

export class Repository {
  constructor({ db, dataDir }) {
    this.db = db;
    this.dataDir = dataDir;
  }

  upsertAsin(inputAsin) {
    const asin = normalizeAsin(inputAsin);
    assertValidAsin(asin);
    const existing = this.db.prepare("SELECT * FROM asins WHERE asin = ?").get(asin);
    const timestamp = nowIso();
    if (existing) {
      this.db.prepare(`
        UPDATE asins
        SET is_deleted = 0, updated_at = ?
        WHERE asin = ?
      `).run(timestamp, asin);
      return { created: false, item: this.getAsin(asin, true) };
    }

    this.db.prepare(`
      INSERT INTO asins (asin, country, created_at, updated_at)
      VALUES (?, 'US', ?, ?)
    `).run(asin, timestamp, timestamp);
    return { created: true, item: this.getAsin(asin, true) };
  }

  getAsin(inputAsin, includeDeleted = false) {
    const asin = normalizeAsin(inputAsin);
    const row = this.db
      .prepare(`SELECT * FROM asins WHERE asin = ? ${includeDeleted ? "" : "AND is_deleted = 0"}`)
      .get(asin);
    return row ? mapAsin(row) : null;
  }

  listAsins({ includeDeleted = false } = {}) {
    const rows = this.db
      .prepare(`SELECT * FROM asins ${includeDeleted ? "" : "WHERE is_deleted = 0"} ORDER BY created_at DESC`)
      .all();
    return rows.map(mapAsin);
  }

  patchAsin(inputAsin, patch) {
    const asin = normalizeAsin(inputAsin);
    assertValidAsin(asin);
    if (!this.getAsin(asin, true)) {
      throw Object.assign(new Error("ASIN 不存在"), { statusCode: 404 });
    }

    const sets = [];
    const values = [];
    if (Object.hasOwn(patch, "isEnabled")) {
      sets.push("is_enabled = ?");
      values.push(patch.isEnabled ? 1 : 0);
    }
    if (Object.hasOwn(patch, "isDeleted")) {
      sets.push("is_deleted = ?");
      values.push(patch.isDeleted ? 1 : 0);
    }
    if (!sets.length) return this.getAsin(asin, true);
    sets.push("updated_at = ?");
    values.push(nowIso(), asin);
    this.db.prepare(`UPDATE asins SET ${sets.join(", ")} WHERE asin = ?`).run(...values);
    return this.getAsin(asin, true);
  }

  listBlockWords() {
    return this.db.prepare("SELECT id, word, created_at AS createdAt FROM block_words ORDER BY word").all();
  }

  addBlockWord(inputWord) {
    const word = normalizeBlockWord(inputWord);
    if (!word) {
      throw Object.assign(new Error("屏蔽词不能为空"), { statusCode: 400 });
    }
    const timestamp = nowIso();
    this.db.prepare("INSERT OR IGNORE INTO block_words (word, created_at) VALUES (?, ?)").run(word, timestamp);
    return this.db.prepare("SELECT id, word, created_at AS createdAt FROM block_words WHERE word = ?").get(word);
  }

  deleteBlockWord(id) {
    this.db.prepare("DELETE FROM block_words WHERE id = ?").run(Number(id));
  }

  listCollections({ asin } = {}) {
    const normalized = asin ? normalizeAsin(asin) : "";
    const rows = normalized
      ? this.db.prepare("SELECT * FROM collections WHERE asin = ? ORDER BY created_at DESC").all(normalized)
      : this.db.prepare("SELECT * FROM collections ORDER BY created_at DESC LIMIT 200").all();
    return rows.map(mapCollection);
  }

  getLatestCollectionId(asin) {
    const row = this.db
      .prepare("SELECT id FROM collections WHERE asin = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1")
      .get(normalizeAsin(asin));
    return row?.id ?? null;
  }

  createCollection({ asin, sourceType, status = "running", filePath = "", errorMessage = "" }) {
    const normalized = normalizeAsin(asin);
    assertValidAsin(normalized);
    if (!this.getAsin(normalized, true)) this.upsertAsin(normalized);
    const timestamp = nowIso();
    const result = this.db.prepare(`
      INSERT INTO collections (asin, country, source_type, status, file_path, error_message, created_at)
      VALUES (?, 'US', ?, ?, ?, ?, ?)
    `).run(normalized, sourceType, status, filePath, errorMessage, timestamp);
    this.setAsinStatus(normalized, status, errorMessage);
    return Number(result.lastInsertRowid);
  }

  setAsinStatus(asin, status, errorMessage = "", successAt = null) {
    const normalized = normalizeAsin(asin);
    const timestamp = nowIso();
    this.db.prepare(`
      UPDATE asins
      SET last_collection_status = ?,
          last_error = ?,
          last_success_at = COALESCE(?, last_success_at),
          updated_at = ?
      WHERE asin = ?
    `).run(status, errorMessage, successAt, timestamp, normalized);
  }

  completeCollection(collectionId, filePath) {
    const timestamp = nowIso();
    const collection = this.db.prepare("SELECT asin FROM collections WHERE id = ?").get(collectionId);
    this.db.prepare(`
      UPDATE collections
      SET status = 'completed', file_path = ?, error_message = '', completed_at = ?
      WHERE id = ?
    `).run(filePath, timestamp, collectionId);
    if (collection) this.setAsinStatus(collection.asin, "completed", "", timestamp);
  }

  failCollection(collectionId, errorMessage) {
    const timestamp = nowIso();
    const collection = this.db.prepare("SELECT asin FROM collections WHERE id = ?").get(collectionId);
    this.db.prepare(`
      UPDATE collections
      SET status = 'failed', error_message = ?, completed_at = ?
      WHERE id = ?
    `).run(errorMessage, timestamp, collectionId);
    if (collection) this.setAsinStatus(collection.asin, "failed", errorMessage);
  }

  importWorkbook({ asin, sourcePath, sourceType = "manual_upload" }) {
    const normalized = normalizeAsin(asin);
    assertValidAsin(normalized);
    const parsed = parseSifWorkbook(sourcePath);
    if (parsed.metadata.asin && parsed.metadata.asin !== normalized) {
      throw Object.assign(
        new Error(`上传文件 ASIN(${parsed.metadata.asin}) 与选择 ASIN(${normalized}) 不一致`),
        { statusCode: 400 }
      );
    }

    if (!this.getAsin(normalized, true)) this.upsertAsin(normalized);

    const collectionId = this.createCollection({
      asin: normalized,
      sourceType,
      status: "parsing"
    });

    try {
      const archivedPath = this.archiveWorkbook({ asin: normalized, sourcePath, collectionId });
      this.replaceKeywords(collectionId, normalized, parsed.records);
      this.completeCollection(collectionId, archivedPath);
      return {
        collection: this.listCollections({ asin: normalized }).find((item) => item.id === collectionId),
        parsed: { rows: parsed.records.length, metadata: parsed.metadata }
      };
    } catch (error) {
      this.failCollection(collectionId, error.message);
      throw error;
    }
  }

  archiveWorkbook({ asin, sourcePath, collectionId }) {
    const dir = path.join(this.dataDir, "uploads", asin);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `${safeTimestamp()}-${collectionId}.xlsx`);
    fs.copyFileSync(sourcePath, target);
    return target;
  }

  replaceKeywords(collectionId, asin, records) {
    const timestamp = nowIso();
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM keywords WHERE collection_id = ?").run(collectionId);
      const insert = this.db.prepare(`
        INSERT INTO keywords (
          collection_id, asin, keyword, translation,
          organic_rank, organic_rank_detail, organic_page, organic_rank_position, organic_total,
          sp_rank, sp_rank_detail, sp_page, sp_rank_position, sp_total,
          weekly_search_trend, raw_json, source_row_number, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const record of records) {
        insert.run(
          collectionId,
          asin,
          record.keyword,
          record.translation,
          record.organicRank,
          record.organicRankDetail,
          record.organicPage,
          record.organicRankPosition,
          record.organicTotal,
          record.spRank,
          record.spRankDetail,
          record.spPage,
          record.spRankPosition,
          record.spTotal,
          record.weeklySearchTrend,
          JSON.stringify(record.raw),
          record.sourceRowNumber,
          timestamp
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getKeywordRows({ asin, collectionId }) {
    const normalized = normalizeAsin(asin);
    const targetCollectionId = collectionId ? Number(collectionId) : this.getLatestCollectionId(normalized);
    if (!targetCollectionId) return [];
    return this.db
      .prepare("SELECT * FROM keywords WHERE asin = ? AND collection_id = ? ORDER BY id")
      .all(normalized, targetCollectionId)
      .map(mapKeyword);
  }

  getFilteredKeywords({ asin, collectionId, search = "", showBlocked = false, onlyFirstPage = false, spFilter = "" }) {
    const blockWords = this.listBlockWords().map((item) => item.word);
    const searchTerm = String(search || "").trim().toLowerCase();
    let rows = applyBlockWords(this.getKeywordRows({ asin, collectionId }), blockWords);
    if (searchTerm) {
      rows = rows.filter(
        (row) =>
          row.keyword.toLowerCase().includes(searchTerm) ||
          row.translation.toLowerCase().includes(searchTerm)
      );
    }
    if (!showBlocked) rows = rows.filter((row) => !row.isBlocked);
    if (onlyFirstPage) {
      rows = rows.filter((row) => row.organicPage === 1 || row.spPage === 1);
    }
    if (spFilter === "hasSp") rows = rows.filter((row) => row.spRank !== null);
    if (spFilter === "noSp") rows = rows.filter((row) => row.spRank === null);
    return rows;
  }

  getDashboard({ asin, collectionId }) {
    const rows = this.getKeywordRows({ asin, collectionId });
    const blockWords = this.listBlockWords().map((item) => item.word);
    const decorated = applyBlockWords(rows, blockWords);
    const visibleRows = decorated.filter((row) => !row.isBlocked);
    const latestCollectionId = collectionId ? Number(collectionId) : this.getLatestCollectionId(asin);
    const collection = latestCollectionId
      ? this.db.prepare("SELECT * FROM collections WHERE id = ?").get(latestCollectionId)
      : null;

    const organicStrongNoSp = visibleRows.filter((row) => row.organicPage === 1 && row.spRank === null);
    const hasSpWeakOrganic = visibleRows.filter((row) => row.spRank !== null && (!row.organicPage || row.organicPage > 1));
    const bothWeak = visibleRows.filter((row) => (!row.organicPage || row.organicPage > 1) && (!row.spPage || row.spPage > 1));

    return {
      collection: collection ? mapCollection(collection) : null,
      summary: {
        totalKeywords: rows.length,
        visibleKeywords: visibleRows.length,
        blockedKeywords: decorated.length - visibleRows.length,
        organicCoverage: rows.filter((row) => row.organicRank !== null).length,
        spCoverage: rows.filter((row) => row.spRank !== null).length,
        firstPageOrganic: rows.filter((row) => row.organicPage === 1).length,
        firstPageSp: rows.filter((row) => row.spPage === 1).length
      },
      distributions: {
        organicByPage: createPageDistribution(rows, "organicPage"),
        spByPage: createPageDistribution(rows, "spPage")
      },
      opportunities: {
        counts: {
          organicStrongNoSp: organicStrongNoSp.length,
          hasSpWeakOrganic: hasSpWeakOrganic.length,
          bothWeak: bothWeak.length
        },
        organicStrongNoSp: organicStrongNoSp.slice(0, 20),
        hasSpWeakOrganic: hasSpWeakOrganic.slice(0, 20),
        bothWeak: bothWeak.slice(0, 20)
      }
    };
  }
}
