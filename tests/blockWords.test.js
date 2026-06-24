import { describe, expect, test } from "vitest";
import { applyBlockWords, normalizeBlockWord } from "../server/blockWords.js";

describe("block words", () => {
  test("normalizes values before storage", () => {
    expect(normalizeBlockWord("  Black  ")).toBe("black");
    expect(normalizeBlockWord("")).toBe("");
  });

  test("hides keywords using case-insensitive contains matching", () => {
    const rows = [
      { keyword: "black bathroom faucet" },
      { keyword: "bathroom sink faucet" }
    ];

    expect(applyBlockWords(rows, ["Black"])).toEqual([
      { keyword: "black bathroom faucet", isBlocked: true, blockedBy: "black" },
      { keyword: "bathroom sink faucet", isBlocked: false, blockedBy: "" }
    ]);
  });
});
