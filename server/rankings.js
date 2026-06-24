const RANK_DETAIL_RE = /^p(\d+),(\d+)\/(\d+)$/i;

export function parseRankDetail(value) {
  if (!value) return null;
  const match = String(value).trim().match(RANK_DETAIL_RE);
  if (!match) return null;
  return {
    page: Number(match[1]),
    rank: Number(match[2]),
    total: Number(match[3])
  };
}

export function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? numeric : null;
}

export function createPageDistribution(rows, pageField) {
  const distribution = { p1: 0, p2: 0, p3: 0, missing: 0 };
  for (const row of rows) {
    const page = row[pageField];
    if (!page) {
      distribution.missing += 1;
    } else if (page === 1) {
      distribution.p1 += 1;
    } else if (page === 2) {
      distribution.p2 += 1;
    } else if (page === 3) {
      distribution.p3 += 1;
    }
  }
  return distribution;
}
