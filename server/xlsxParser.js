import path from "node:path";
import XLSX from "xlsx";
import { parseRankDetail, toNullableNumber } from "./rankings.js";

const REQUIRED_HEADERS = [
  "关键词",
  "自然排名",
  "自然排名详情",
  "SP(常规)排名",
  "SP(常规)排名详情"
];

function getWorkbook(source) {
  if (Buffer.isBuffer(source)) {
    return XLSX.read(source, { type: "buffer", cellDates: false });
  }
  return XLSX.readFile(source, { cellDates: false });
}

function parseAsinFromText(text) {
  const match = String(text || "").match(/ASIN\(([A-Z0-9]{10})\)|\b([A-Z0-9]{10})\b/i);
  return (match?.[1] || match?.[2] || "").toUpperCase();
}

function parseCountry(sheetName, metadataText) {
  const source = `${sheetName} ${metadataText}`;
  if (/美国|US\b/i.test(source)) return "US";
  return "US";
}

function normalizeHeader(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function buildHeaderIndex(headers) {
  const index = new Map();
  headers.forEach((header, idx) => {
    index.set(normalizeHeader(header), idx);
  });
  return index;
}

function getCell(row, headerIndex, headerName) {
  const idx = headerIndex.get(normalizeHeader(headerName));
  if (idx === undefined) return "";
  return row[idx] ?? "";
}

function assertRequiredHeaders(headerIndex) {
  const missing = REQUIRED_HEADERS.filter((header) => !headerIndex.has(normalizeHeader(header)));
  if (missing.length) {
    throw new Error(`SIF XLSX 表头不匹配, 缺少: ${missing.join(", ")}`);
  }
}

export { parseRankDetail };

export function parseSifWorkbook(source) {
  const workbook = getWorkbook(source);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("XLSX 文件没有工作表");
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: ""
  });

  if (rows.length < 3) {
    throw new Error("SIF XLSX 行数不足, 至少需要元信息、表头和数据行");
  }

  const metadataText = String(rows[0]?.[0] || "");
  const headers = rows[1] || [];
  const headerIndex = buildHeaderIndex(headers);
  assertRequiredHeaders(headerIndex);

  const records = rows
    .slice(2)
    .filter((row) => String(getCell(row, headerIndex, "关键词")).trim())
    .map((row, rowOffset) => {
      const organicRankDetail = String(getCell(row, headerIndex, "自然排名详情") || "").trim();
      const spRankDetail = String(getCell(row, headerIndex, "SP(常规)排名详情") || "").trim();
      const organicParsed = parseRankDetail(organicRankDetail);
      const spParsed = parseRankDetail(spRankDetail);

      return {
        sourceRowNumber: rowOffset + 3,
        keyword: String(getCell(row, headerIndex, "关键词") || "").trim(),
        translation: String(getCell(row, headerIndex, "翻译") || "").trim(),
        organicRank: toNullableNumber(getCell(row, headerIndex, "自然排名")),
        organicRankDetail,
        organicPage: organicParsed?.page ?? null,
        organicRankPosition: organicParsed?.rank ?? null,
        organicTotal: organicParsed?.total ?? null,
        spRank: toNullableNumber(getCell(row, headerIndex, "SP(常规)排名")),
        spRankDetail,
        spPage: spParsed?.page ?? null,
        spRankPosition: spParsed?.rank ?? null,
        spTotal: spParsed?.total ?? null,
        weeklySearchTrend: toNullableNumber(getCell(row, headerIndex, "周搜索趋势")),
        raw: Object.fromEntries(headers.map((header, idx) => [String(header || `列${idx + 1}`), row[idx] ?? ""]))
      };
    });

  const sourcePath = typeof source === "string" ? source : "";
  return {
    metadata: {
      asin: parseAsinFromText(metadataText) || parseAsinFromText(sheetName) || parseAsinFromText(path.basename(sourcePath)),
      country: parseCountry(sheetName, metadataText),
      sheetName,
      exportedText: metadataText
    },
    headers: headers.map(String),
    records
  };
}
