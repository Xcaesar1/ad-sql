import React, { startTransition, useDeferredValue, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const emptyDashboard = {
  collection: null,
  summary: {
    totalKeywords: 0,
    visibleKeywords: 0,
    blockedKeywords: 0,
    organicCoverage: 0,
    spCoverage: 0,
    firstPageOrganic: 0,
    firstPageSp: 0
  },
  distributions: {
    organicByPage: { p1: 0, p2: 0, p3: 0, p4plus: 0, missing: 0 },
    spByPage: { p1: 0, p2: 0, p3: 0, p4plus: 0, missing: 0 }
  },
  opportunities: {
    counts: {
      organicStrongNoSp: 0,
      hasSpWeakOrganic: 0,
      bothWeak: 0
    },
    organicStrongNoSp: [],
    hasSpWeakOrganic: [],
    bothWeak: []
  }
};

const pageSegments = [
  ["p1", "P1", "第一页", "page-p1"],
  ["p2", "P2", "第二页", "page-p2"],
  ["p3", "P3", "第三页", "page-p3"],
  ["p4plus", ">P3", "三页后", "page-p4"],
  ["missing", "无", "无排名", "page-missing"]
];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `请求失败: ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatPercent(value, total) {
  if (!total) return "0%";
  return `${Math.round((Number(value || 0) / total) * 1000) / 10}%`;
}

function formatTime(value) {
  if (!value) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getDistributionTotal(distribution = {}) {
  return pageSegments.reduce((sum, [key]) => sum + Number(distribution[key] || 0), 0);
}

function clampPercent(value) {
  return Math.max(2, Math.min(100, value));
}

function StatusPill({ status }) {
  const labelMap = {
    never: "未采集",
    running: "采集中",
    parsing: "解析中",
    completed: "已完成",
    failed: "失败"
  };
  return <span className={`status-pill status-${status || "never"}`}>{labelMap[status] || status || "未采集"}</span>;
}

function KpiCard({ label, value, detail, tone = "neutral" }) {
  return (
    <article className={`kpi-card kpi-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function DistributionPanel({ title, subtitle, distribution, accent }) {
  const total = getDistributionTotal(distribution) || 1;

  return (
    <section className="analysis-card distribution-panel">
      <div className="card-heading">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <strong>{formatNumber(total)}</strong>
      </div>
      <div className="distribution-rows">
        {pageSegments.map(([key, shortLabel, label, className]) => {
          const count = Number(distribution?.[key] || 0);
          return (
            <div className="distribution-row" key={key}>
              <span>{shortLabel}</span>
              <div className="bar-track">
                <i
                  className={`${className} ${accent}`}
                  style={{ width: `${clampPercent((count / total) * 100)}%` }}
                />
              </div>
              <b>{formatNumber(count)}</b>
              <em>{label}</em>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CoverageRing({ label, count, total, tone }) {
  const percent = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className="coverage-ring">
      <i className={`ring ring-${tone}`} style={{ "--value": `${percent * 3.6}deg` }} />
      <div>
        <strong>{percent}%</strong>
        <span>{label}</span>
        <small>
          {formatNumber(count)} / {formatNumber(total)}
        </small>
      </div>
    </div>
  );
}

function OpportunityTile({ title, count, note, tone }) {
  return (
    <article className={`opportunity-tile tile-${tone}`}>
      <span>{title}</span>
      <strong>{formatNumber(count)}</strong>
      <small>{note}</small>
    </article>
  );
}

function OpportunityList({ title, count, rows, emptyText }) {
  return (
    <section className="analysis-card opportunity-list">
      <div className="card-heading compact">
        <h3>{title}</h3>
        <strong>{formatNumber(count ?? rows.length)}</strong>
      </div>
      {rows.length ? (
        <ol>
          {rows.slice(0, 5).map((row) => (
            <li key={`${row.collectionId}-${row.id}`}>
              <span>{row.keyword}</span>
              <b>
                自然 {row.organicRankDetail || "-"} · SP {row.spRankDetail || "-"}
              </b>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-note">{emptyText}</p>
      )}
    </section>
  );
}

function RankChip({ type, detail, page, rank, total }) {
  if (!detail) {
    return (
      <div className={`rank-chip rank-${type} rank-empty`}>
        <strong>-</strong>
        <span>无排名</span>
      </div>
    );
  }

  const pageLabel = page ? `P${page}` : "-";
  return (
    <div className={`rank-chip rank-${type} page-${page || "none"}`}>
      <strong>{detail}</strong>
      <span>
        {pageLabel} · {rank || "-"} / {total || "-"}
      </span>
    </div>
  );
}

function getRankScore(page, rank) {
  if (!page || !rank) return null;
  return (Number(page) - 1) * 48 + Number(rank);
}

function RankLane({ row }) {
  const maxScore = 192;
  const organicScore = getRankScore(row.organicPage, row.organicRankPosition);
  const spScore = getRankScore(row.spPage, row.spRankPosition);
  const organicX = organicScore ? clampPercent((organicScore / maxScore) * 100) : null;
  const spX = spScore ? clampPercent((spScore / maxScore) * 100) : null;

  return (
    <div className="rank-lane" aria-label="自然和 SP 排名对比">
      <div className="lane-axis">
        <span>1</span>
        <span>48</span>
        <span>96</span>
        <span>144</span>
        <span>192</span>
      </div>
      <div className="lane-track">
        {organicX && <i className="lane-dot lane-organic" style={{ left: `${organicX}%` }} title="自然排名" />}
        {spX && <i className="lane-dot lane-sp" style={{ left: `${spX}%` }} title="SP 排名" />}
      </div>
      <div className="lane-legend">
        <span className="legend-organic">自然</span>
        <span className="legend-sp">SP</span>
      </div>
    </div>
  );
}

function TrendMeter({ value, max }) {
  const percent = max ? clampPercent((Number(value || 0) / max) * 100) : 0;
  return (
    <div className="trend-meter">
      <span>{value ? formatNumber(value) : "-"}</span>
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}

function KeywordTable({ rows, maxTrend }) {
  return (
    <div className="keyword-table-wrap">
      <table className="keyword-table">
        <thead>
          <tr>
            <th>#</th>
            <th>关键词</th>
            <th>翻译</th>
            <th>周搜索趋势</th>
            <th>自然排名详情</th>
            <th>SP(常规)排名详情</th>
            <th>排名对比</th>
            <th>屏蔽</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.collectionId}-${row.id}`} className={row.isBlocked ? "is-blocked" : ""}>
              <td className="index-cell">{index + 1}</td>
              <td className="keyword-cell">
                <strong>{row.keyword}</strong>
              </td>
              <td className="translation-cell">{row.translation || "-"}</td>
              <td>
                <TrendMeter value={row.weeklySearchTrend} max={maxTrend} />
              </td>
              <td>
                <RankChip
                  type="organic"
                  detail={row.organicRankDetail}
                  page={row.organicPage}
                  rank={row.organicRankPosition}
                  total={row.organicTotal}
                />
              </td>
              <td>
                <RankChip
                  type="sp"
                  detail={row.spRankDetail}
                  page={row.spPage}
                  rank={row.spRankPosition}
                  total={row.spTotal}
                />
              </td>
              <td>
                <RankLane row={row} />
              </td>
              <td>{row.isBlocked ? <span className="blocked-tag">{row.blockedBy}</span> : <span className="muted-dash">-</span>}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan="8" className="empty-cell">
                暂无可展示关键词。可以上传 SIF XLSX, 或打开“显示已屏蔽”检查过滤结果。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [asins, setAsins] = useState([]);
  const [selectedAsin, setSelectedAsin] = useState("");
  const [collections, setCollections] = useState([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [blockWords, setBlockWords] = useState([]);
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [keywords, setKeywords] = useState([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [showBlocked, setShowBlocked] = useState(false);
  const [onlyFirstPage, setOnlyFirstPage] = useState(false);
  const [spFilter, setSpFilter] = useState("");
  const [newAsin, setNewAsin] = useState("");
  const [newBlockWord, setNewBlockWord] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function refreshAsins() {
    const payload = await api("/api/asins");
    setAsins(payload.items);
    if (!selectedAsin && payload.items.length) {
      setSelectedAsin(payload.items[0].asin);
    }
  }

  async function refreshBlockWords() {
    const payload = await api("/api/block-words");
    setBlockWords(payload.items);
  }

  async function refreshCollections(asin) {
    if (!asin) {
      setCollections([]);
      return;
    }
    const payload = await api(`/api/collections?asin=${encodeURIComponent(asin)}`);
    setCollections(payload.items);
  }

  async function refreshData() {
    if (!selectedAsin) {
      setDashboard(emptyDashboard);
      setKeywords([]);
      return;
    }
    setIsPending(true);
    try {
      const collectionParam = selectedCollectionId ? `&collectionId=${selectedCollectionId}` : "";
      const [dashboardPayload, keywordPayload] = await Promise.all([
        api(`/api/dashboard?asin=${encodeURIComponent(selectedAsin)}${collectionParam}`),
        api(
          `/api/keywords?asin=${encodeURIComponent(selectedAsin)}${collectionParam}&search=${encodeURIComponent(
            deferredSearch
          )}&showBlocked=${showBlocked}&onlyFirstPage=${onlyFirstPage}&spFilter=${spFilter}`
        )
      ]);
      setDashboard(dashboardPayload);
      setKeywords(keywordPayload.items);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsPending(false);
    }
  }

  useEffect(() => {
    refreshAsins().catch((err) => setError(err.message));
    refreshBlockWords().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    refreshCollections(selectedAsin).catch((err) => setError(err.message));
    setSelectedCollectionId("");
  }, [selectedAsin]);

  useEffect(() => {
    refreshData();
  }, [selectedAsin, selectedCollectionId, deferredSearch, showBlocked, onlyFirstPage, spFilter, blockWords.length]);

  async function handleAddAsin(event) {
    event.preventDefault();
    setError("");
    try {
      const item = await api("/api/asins", {
        method: "POST",
        body: JSON.stringify({ asin: newAsin })
      });
      setMessage(`已添加 ASIN ${item.asin}`);
      setNewAsin("");
      await refreshAsins();
      setSelectedAsin(item.asin);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handlePatchAsin(asin, patch) {
    setError("");
    try {
      await api(`/api/asins/${asin}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      await refreshAsins();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAddBlockWord(event) {
    event.preventDefault();
    setError("");
    try {
      await api("/api/block-words", {
        method: "POST",
        body: JSON.stringify({ word: newBlockWord })
      });
      setNewBlockWord("");
      await refreshBlockWords();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteBlockWord(id) {
    setError("");
    try {
      await api(`/api/block-words/${id}`, { method: "DELETE" });
      await refreshBlockWords();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file || !selectedAsin) return;
    setError("");
    const data = new FormData();
    data.append("asin", selectedAsin);
    data.append("file", file);
    try {
      const result = await api("/api/import/xlsx", { method: "POST", body: data });
      setMessage(`已导入 ${result.parsed.rows} 个关键词`);
      await refreshCollections(selectedAsin);
      await refreshData();
    } catch (err) {
      setError(err.message);
    } finally {
      event.target.value = "";
    }
  }

  async function handleRunCollector() {
    if (!selectedAsin) return;
    setError("");
    try {
      await api("/api/collections/run", {
        method: "POST",
        body: JSON.stringify({ asins: [selectedAsin] })
      });
      setMessage("已提交采集任务, 请留意采集主机 Chrome 状态");
      await refreshAsins();
    } catch (err) {
      setError(err.message);
    }
  }

  function updateSearch(value) {
    startTransition(() => setSearch(value));
  }

  const selectedAsinItem = asins.find((item) => item.asin === selectedAsin);
  const visibleTotal = dashboard.summary.visibleKeywords;
  const opportunityCounts = dashboard.opportunities?.counts || {};
  const organicGapCount = opportunityCounts.organicStrongNoSp ?? dashboard.opportunities.organicStrongNoSp.length;
  const spWeakCount = opportunityCounts.hasSpWeakOrganic ?? dashboard.opportunities.hasSpWeakOrganic.length;
  const bothWeakCount = opportunityCounts.bothWeak ?? dashboard.opportunities.bothWeak.length;
  const maxTrend = keywords.reduce((max, row) => Math.max(max, Number(row.weeklySearchTrend || 0)), 0);

  return (
    <main className="app-shell">
      <aside className="source-rail">
        <div className="brand-lockup">
          <div className="brand-mark">A</div>
          <div>
            <h1>SIF Keyword Lab</h1>
            <p>US · 最近 7 天 · ASIN 反查</p>
          </div>
        </div>

        <section className="rail-section">
          <div className="rail-title">
            <h2>数据源</h2>
            <span>{asins.length}</span>
          </div>
          <form className="rail-form" onSubmit={handleAddAsin}>
            <input
              value={newAsin}
              onChange={(event) => setNewAsin(event.target.value.toUpperCase())}
              placeholder="B0DM96Z44F"
              maxLength={10}
            />
            <button type="submit">添加</button>
          </form>
          <div className="asin-list">
            {asins.map((asin) => (
              <button
                key={asin.asin}
                className={asin.asin === selectedAsin ? "asin-row active" : "asin-row"}
                type="button"
                onClick={() => setSelectedAsin(asin.asin)}
              >
                <span>
                  <b>{asin.asin}</b>
                  <small>{asin.lastSuccessAt ? formatTime(asin.lastSuccessAt) : "暂无成功采集"}</small>
                </span>
                <StatusPill status={asin.lastCollectionStatus} />
              </button>
            ))}
            {!asins.length && <p className="empty-note">先添加一个 ASIN。</p>}
          </div>
          {selectedAsinItem && (
            <div className="rail-actions">
              <button type="button" onClick={() => handlePatchAsin(selectedAsin, { isEnabled: !selectedAsinItem.isEnabled })}>
                {selectedAsinItem.isEnabled ? "停用" : "启用"}
              </button>
              <button type="button" className="danger" onClick={() => handlePatchAsin(selectedAsin, { isDeleted: true })}>
                删除
              </button>
            </div>
          )}
        </section>

        <section className="rail-section">
          <div className="rail-title">
            <h2>屏蔽词</h2>
            <span>{blockWords.length}</span>
          </div>
          <form className="rail-form" onSubmit={handleAddBlockWord}>
            <input
              value={newBlockWord}
              onChange={(event) => setNewBlockWord(event.target.value)}
              placeholder="例如 black"
            />
            <button type="submit">添加</button>
          </form>
          <div className="block-list">
            {blockWords.map((word) => (
              <button key={word.id} type="button" onClick={() => handleDeleteBlockWord(word.id)}>
                {word.word} <span>×</span>
              </button>
            ))}
            {!blockWords.length && <p className="empty-note">暂无屏蔽词。</p>}
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="command-bar">
          <div className="command-main">
            <span className="meta-line">Reverse ASIN Keyword Ranking</span>
            <h2>{selectedAsin || "选择一个 ASIN"}</h2>
            <p>
              最新批次 {formatTime(dashboard.collection?.completedAt)} ·{" "}
              {selectedAsinItem?.lastError ? `错误: ${selectedAsinItem.lastError}` : "自动采集失败时可以上传 XLSX 兜底"}
            </p>
          </div>
          <div className="command-actions">
            <select
              value={selectedCollectionId}
              onChange={(event) => setSelectedCollectionId(event.target.value)}
              disabled={!collections.length}
            >
              <option value="">最新成功批次</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  #{collection.id} {collection.status} {formatTime(collection.completedAt || collection.createdAt)}
                </option>
              ))}
            </select>
            <button type="button" className="soft-button" onClick={refreshData} disabled={!selectedAsin || isPending}>
              {isPending ? "刷新中" : "刷新"}
            </button>
            <label className="upload-button">
              上传 XLSX
              <input type="file" accept=".xlsx,.xls" onChange={handleUpload} />
            </label>
            <button type="button" className="primary-button" onClick={handleRunCollector} disabled={!selectedAsin}>
              立即采集
            </button>
          </div>
        </header>

        {(message || error) && (
          <div className={error ? "notice error" : "notice"}>
            <span>{error || message}</span>
            <button type="button" onClick={() => { setMessage(""); setError(""); }}>
              关闭
            </button>
          </div>
        )}

        <section className="kpi-grid">
          <KpiCard
            label="展示关键词"
            value={formatNumber(visibleTotal)}
            detail={`原始 ${formatNumber(dashboard.summary.totalKeywords)} · 已屏蔽 ${formatNumber(dashboard.summary.blockedKeywords)}`}
            tone="neutral"
          />
          <KpiCard
            label="自然第一页覆盖"
            value={formatNumber(dashboard.summary.firstPageOrganic)}
            detail={`${formatPercent(dashboard.summary.firstPageOrganic, dashboard.summary.totalKeywords)} of 全部词`}
            tone="organic"
          />
          <KpiCard
            label="SP 第一页覆盖"
            value={formatNumber(dashboard.summary.firstPageSp)}
            detail={`${formatPercent(dashboard.summary.firstPageSp, dashboard.summary.totalKeywords)} of 全部词`}
            tone="sp"
          />
          <KpiCard
            label="自然强但无 SP"
            value={formatNumber(organicGapCount)}
            detail="优先评估广告补位"
            tone="danger"
          />
        </section>

        <section className="insight-grid">
          <DistributionPanel
            title="自然排名分布"
            subtitle="看自然搜索占位是否集中在第一页"
            distribution={dashboard.distributions.organicByPage}
            accent="organic"
          />
          <DistributionPanel
            title="SP(常规)排名分布"
            subtitle="看广告是否覆盖高价值流量词"
            distribution={dashboard.distributions.spByPage}
            accent="sp"
          />
          <section className="analysis-card opportunity-board">
            <div className="card-heading">
              <div>
                <h3>机会 / 风险洞察</h3>
                <p>把排名差异翻译成运营动作</p>
              </div>
            </div>
            <div className="opportunity-tiles">
              <OpportunityTile title="自然强 / SP 弱" count={organicGapCount} note="自然 P1 且 SP 无排名" tone="green" />
              <OpportunityTile title="SP 有位 / 自然弱" count={spWeakCount} note="广告在跑, 自然未进 P1" tone="amber" />
              <OpportunityTile title="双弱词" count={bothWeakCount} note="自然和 SP 都偏弱" tone="slate" />
              <OpportunityTile title="已屏蔽" count={dashboard.summary.blockedKeywords} note="默认不进入展示" tone="muted" />
            </div>
          </section>
          <section className="analysis-card coverage-card">
            <div className="card-heading compact">
              <h3>页一覆盖率</h3>
            </div>
            <CoverageRing
              label="自然 P1"
              count={dashboard.summary.firstPageOrganic}
              total={dashboard.summary.totalKeywords}
              tone="organic"
            />
            <CoverageRing
              label="SP P1"
              count={dashboard.summary.firstPageSp}
              total={dashboard.summary.totalKeywords}
              tone="sp"
            />
          </section>
        </section>

        <section className="table-card">
          <div className="table-toolbar">
            <div>
              <span className="meta-line">Keyword Detail</span>
              <h3>关键词排名明细</h3>
              <p>{isPending ? "刷新中..." : `当前展示 ${formatNumber(keywords.length)} 行`}</p>
            </div>
            <div className="filters">
              <input value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="搜索关键词或翻译" />
              <select value={spFilter} onChange={(event) => setSpFilter(event.target.value)}>
                <option value="">全部 SP 状态</option>
                <option value="hasSp">只看有 SP</option>
                <option value="noSp">只看无 SP</option>
              </select>
              <label>
                <input type="checkbox" checked={onlyFirstPage} onChange={(event) => setOnlyFirstPage(event.target.checked)} />
                只看第一页
              </label>
              <label>
                <input type="checkbox" checked={showBlocked} onChange={(event) => setShowBlocked(event.target.checked)} />
                显示已屏蔽
              </label>
            </div>
          </div>
          <KeywordTable rows={keywords} maxTrend={maxTrend} />
        </section>

        <section className="opportunity-grid">
          <OpportunityList
            title="优先补 SP"
            count={organicGapCount}
            rows={dashboard.opportunities.organicStrongNoSp}
            emptyText="暂无自然第一页但 SP 空缺的关键词。"
          />
          <OpportunityList
            title="自然待优化"
            count={spWeakCount}
            rows={dashboard.opportunities.hasSpWeakOrganic}
            emptyText="暂无 SP 有排名但自然偏弱的关键词。"
          />
          <OpportunityList
            title="低优先级观察"
            count={bothWeakCount}
            rows={dashboard.opportunities.bothWeak}
            emptyText="暂无自然和 SP 都偏弱的关键词。"
          />
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
