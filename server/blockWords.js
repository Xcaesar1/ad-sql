export function normalizeBlockWord(word) {
  return String(word || "").trim().toLowerCase();
}

export function applyBlockWords(rows, blockWords) {
  const normalizedWords = blockWords.map(normalizeBlockWord).filter(Boolean);
  return rows.map((row) => {
    const keyword = String(row.keyword || "").toLowerCase();
    const blockedBy = normalizedWords.find((word) => keyword.includes(word)) || "";
    return {
      ...row,
      isBlocked: Boolean(blockedBy),
      blockedBy
    };
  });
}
