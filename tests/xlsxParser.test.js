import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseRankDetail, parseSifWorkbook } from "../server/xlsxParser.js";

const sampleWorkbook = path.resolve(
  "C:/Users/god/Downloads/asinKeywords_B0DM96Z44F_1782265683901.xlsx"
);

describe("SIF workbook parser", () => {
  test("parses rank detail strings without crashing on blanks", () => {
    expect(parseRankDetail("p1,37/48")).toEqual({ page: 1, rank: 37, total: 48 });
    expect(parseRankDetail("")).toBeNull();
    expect(parseRankDetail(null)).toBeNull();
  });

  test("reads the SIF export headers and target ranking fields", () => {
    const parsed = parseSifWorkbook(sampleWorkbook);

    expect(parsed.metadata.asin).toBe("B0DM96Z44F");
    expect(parsed.metadata.country).toBe("US");
    expect(parsed.records).toHaveLength(412);
    expect(parsed.records[0]).toMatchObject({
      keyword: "bathroom sink faucet",
      translation: "浴室水槽水龙头",
      organicRank: 37,
      organicRankDetail: "p1,37/48",
      spRank: 4,
      spRankDetail: "p1,4/12",
      weeklySearchTrend: 51812
    });
    expect(parsed.records[1].spRank).toBeNull();
    expect(parsed.records[1].spRankDetail).toBe("");
  });
});
