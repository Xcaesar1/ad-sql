import path from "node:path";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import { parseRankDetail, toNullableNumber } from "./rankings.js";

const REQUIRED_HEADERS = [
  "关键词",
  "自然排名",
  "自然排名详情",
  "SP(常规)排名",
  "SP(常规)排名详情"
];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "#text",
  trimValues: false
});

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

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getZipText(zip, entryName) {
  const entry = zip.getEntry(entryName);
  if (!entry) return "";
  return entry.getData().toString("utf8");
}

function parseXml(xml) {
  return xmlParser.parse(xml);
}

function getTextNode(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    if (value["#text"] !== undefined) return String(value["#text"]);
    if (value.t !== undefined) return getTextNode(value.t);
  }
  return "";
}

function richTextToString(si) {
  if (!si) return "";
  if (si.t !== undefined) return getTextNode(si.t);
  return ensureArray(si.r)
    .map((run) => getTextNode(run.t))
    .join("");
}

function loadSharedStrings(zip) {
  const xml = getZipText(zip, "xl/sharedStrings.xml");
  if (!xml) return [];
  const parsed = parseXml(xml);
  return ensureArray(parsed.sst?.si).map(richTextToString);
}

function resolveFirstSheet(zip) {
  const workbook = parseXml(getZipText(zip, "xl/workbook.xml"));
  const rels = parseXml(getZipText(zip, "xl/_rels/workbook.xml.rels"));
  const sheets = ensureArray(workbook.workbook?.sheets?.sheet);
  if (!sheets.length) return null;

  const firstSheet = sheets[0];
  const relationships = ensureArray(rels.Relationships?.Relationship);
  const relationship = relationships.find((rel) => rel.Id === firstSheet["r:id"]);
  const target = relationship?.Target || "worksheets/sheet1.xml";
  const normalizedTarget = target.startsWith("/") ? target.slice(1) : target;
  return {
    name: firstSheet.name || "Sheet1",
    path: normalizedTarget.startsWith("xl/") ? normalizedTarget : `xl/${normalizedTarget}`
  };
}

function columnIndex(cellRef) {
  const letters = String(cellRef || "").match(/[A-Z]+/)?.[0] || "A";
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index - 1;
}

function getCellValue(cell, sharedStrings) {
  if (!cell) return "";
  const type = cell.t;
  if (type === "s") {
    const sharedIndex = Number(getTextNode(cell.v));
    return sharedStrings[sharedIndex] ?? "";
  }
  if (type === "inlineStr") {
    return richTextToString(cell.is);
  }
  return getTextNode(cell.v);
}

function loadRows(zip, sheetPath, sharedStrings) {
  const worksheet = parseXml(getZipText(zip, sheetPath));
  return ensureArray(worksheet.worksheet?.sheetData?.row).map((row) => {
    const values = [];
    for (const cell of ensureArray(row.c)) {
      values[columnIndex(cell.r)] = getCellValue(cell, sharedStrings);
    }
    return values.map((value) => value ?? "");
  });
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
  const zip = Buffer.isBuffer(source) ? new AdmZip(source) : new AdmZip(source);
  const sharedStrings = loadSharedStrings(zip);
  const firstSheet = resolveFirstSheet(zip);
  if (!firstSheet) {
    throw new Error("XLSX 文件没有工作表");
  }

  const sheetName = firstSheet.name;
  const rows = loadRows(zip, firstSheet.path, sharedStrings);

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
