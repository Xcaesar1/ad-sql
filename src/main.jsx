import React, { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
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
      bothStrong: 0,
      bothWeak: 0
    },
    organicStrongNoSp: [],
    hasSpWeakOrganic: [],
    bothStrong: [],
    bothWeak: []
  }
};

const pageSegments = [
  ["p1", "P1", "第一页"],
  ["p2", "P2", "第二页"],
  ["p3", "P3", "第三页"],
  ["p4plus", ">P3", "三页后"],
  ["missing", "无排名", "无排名"]
];

const statusMeta = {
  never: ["未采集", "muted"],
  running: ["采集中", "warning"],
  parsing: ["解析中", "warning"],
  completed: ["已完成", "success"],
  failed: ["失败", "danger"]
};

const pageSize = 60;

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
  return `${Math.round((Number(value || 0) / Number(total || 0)) * 1000) / 10}%`;
}

function formatDate(value) {
  if (!value) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .format(new Date(value))
    .replaceAll("/", "-");
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

function formatClock(value) {
  if (!value) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDateRange(value) {
  const end = value ? new Date(value) : new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  return `${formatDate(start)} ~ ${formatDate(end)}`;
}

function formatInputDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function getRetentionStartDate(retentionDays = 180) {
  const date = new Date();
  date.setDate(date.getDate() - Math.max(1, Number(retentionDays || 180)));
  return formatInputDate(date);
}

function clampPercent(value, min = 0) {
  return Math.max(min, Math.min(100, Number.isFinite(value) ? value : 0));
}

function getDistributionTotal(distribution = {}) {
  return pageSegments.reduce((sum, [key]) => sum + Number(distribution[key] || 0), 0);
}

function getRankScore(page, rank) {
  if (!page || !rank) return null;
  return (Number(page) - 1) * 48 + Number(rank);
}

function makeSparkPoints(seed = "", width = 92, height = 30) {
  let value = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0) || 17;
  const points = [];
  for (let index = 0; index < 12; index += 1) {
    value = (value * 37 + 23) % 97;
    const x = (index / 11) * width;
    const y = height - 5 - (value / 96) * (height - 8);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(" ");
}

function StatusBadge({ status }) {
  const [label, tone] = statusMeta[status || "never"] || [status || "未采集", "muted"];
  return <span className={`status-badge status-${tone}`}>{label}</span>;
}

function IconUpload() {
  return (
    <svg className="button-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 11.5V3.25" />
      <path d="M4.75 6.45 8 3.2l3.25 3.25" />
      <path d="M3.25 10.75v1.75c0 .55.45 1 1 1h7.5c.55 0 1-.45 1-1v-1.75" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg className="button-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M12.9 5.35A5 5 0 1 0 13 10" />
      <path d="M12.9 2.65v2.7h-2.7" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg className="meta-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.2 2.2v2" />
      <path d="M11.8 2.2v2" />
      <path d="M2.8 5.6h10.4" />
      <rect x="2.6" y="3.3" width="10.8" height="10" rx="1.4" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg className="meta-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.4" />
      <path d="M8 4.9v3.3l2.2 1.3" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg className="menu-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 5h8" />
      <path d="M4 8h8" />
      <path d="M4 11h8" />
    </svg>
  );
}

function TinySparkline({ seed, tone = "organic" }) {
  return (
    <svg className={`sparkline sparkline-${tone}`} viewBox="0 0 92 30" aria-hidden="true">
      <polyline points={makeSparkPoints(seed)} />
    </svg>
  );
}

function KpiCard({ label, value, detail, subDetail, tone = "neutral", sparkSeed }) {
  return (
    <article className={`kpi-card tone-${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{detail}</p>
        {subDetail && <small>{subDetail}</small>}
      </div>
      {sparkSeed && <TinySparkline seed={sparkSeed} tone={tone === "sp" ? "sp" : "organic"} />}
    </article>
  );
}

function DistributionPanel({ title, distribution, total, tone, legend }) {
  const distributionTotal = getDistributionTotal(distribution) || 1;
  return (
    <section className="panel distribution-panel">
      <div className="panel-title">
        <div>
          <h3>{title}</h3>
          <p>
            <span className={`dot dot-${tone}`} /> 全部 {formatNumber(total)} <span className="legend-muted" /> {legend}
          </p>
        </div>
      </div>
      <div className="distribution-list">
        {pageSegments.map(([key, shortLabel, label]) => {
          const count = Number(distribution?.[key] || 0);
          const percent = (count / distributionTotal) * 100;
          return (
            <div className="distribution-row" key={key}>
              <span>{shortLabel}</span>
              <div className="distribution-track">
                <i className={`fill-${tone}`} style={{ width: `${clampPercent(percent, count ? 2 : 0)}%` }} />
              </div>
              <b>{formatNumber(count)}</b>
              <em>{formatPercent(count, distributionTotal)}</em>
              <small>{label}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function OpportunityCard({ title, value, percent, detail, tone }) {
  return (
    <article className={`opportunity-card opportunity-${tone}`}>
      <span>{title}</span>
      <strong>{formatNumber(value)}</strong>
      <p>
        {percent} <small>{detail}</small>
      </p>
    </article>
  );
}

function OpportunityBoard({ dashboard }) {
  const total = dashboard.summary.visibleKeywords || 0;
  const counts = dashboard.opportunities?.counts || {};
  return (
    <section className="panel opportunity-board">
      <div className="panel-title">
        <div>
          <h3>机会 / 风险洞察</h3>
          <p>按自然和 SP 前 3 页覆盖拆成四类动作</p>
        </div>
      </div>
      <div className="opportunity-grid">
        <OpportunityCard
          title="自然强 / SP 弱"
          value={counts.organicStrongNoSp}
          percent={formatPercent(counts.organicStrongNoSp, total)}
          detail="自然 P1-3, SP 弱或无排名"
          tone="green"
        />
        <OpportunityCard
          title="SP 有位 / 自然弱"
          value={counts.hasSpWeakOrganic}
          percent={formatPercent(counts.hasSpWeakOrganic, total)}
          detail="SP P1-3, 自然 >P3 或无排名"
          tone="amber"
        />
        <OpportunityCard
          title="双强"
          value={counts.bothStrong}
          percent={formatPercent(counts.bothStrong, total)}
          detail="自然 P1-3 且 SP P1-3"
          tone="blue"
        />
        <OpportunityCard
          title="双弱"
          value={counts.bothWeak}
          percent={formatPercent(counts.bothWeak, total)}
          detail="自然 >P3 且 SP >P3 或无排名"
          tone="slate"
        />
      </div>
    </section>
  );
}

function CoverageRing({ label, count, total, tone }) {
  const hasData = Number(total || 0) > 0;
  const percent = hasData ? Math.round((Number(count || 0) / Number(total || 0)) * 1000) / 10 : null;
  const percentLabel = hasData ? `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%` : "--";
  return (
    <div className="coverage-ring">
      <i className={`ring ring-${tone} ${hasData ? "" : "ring-empty"}`} style={{ "--value": `${hasData ? percent * 3.6 : 0}deg` }}>
        <b>{percentLabel}</b>
      </i>
      <span>{label}</span>
      <small>
        {hasData ? `${formatNumber(count)} / ${formatNumber(total)}` : "暂无数据"}
      </small>
    </div>
  );
}

function CoveragePanel({ dashboard }) {
  return (
    <section className="panel coverage-panel">
      <div className="panel-title center">
        <h3>页一覆盖率</h3>
      </div>
      <div className="coverage-grid">
        <CoverageRing
          label="自然 P1 覆盖"
          count={dashboard.summary.firstPageOrganic}
          total={dashboard.summary.organicCoverage}
          tone="organic"
        />
        <CoverageRing
          label="SP P1 覆盖"
          count={dashboard.summary.firstPageSp}
          total={dashboard.summary.spCoverage}
          tone="sp"
        />
      </div>
    </section>
  );
}

function RankBadge({ detail, page, rank, total, tone }) {
  if (!detail) {
    return (
      <div className="rank-cell empty-rank">
        <strong>-</strong>
        <span>无排名</span>
      </div>
    );
  }
  return (
    <div className={`rank-cell rank-${tone}`}>
      <strong>{detail}</strong>
      <span>
        {rank || "-"} / {total || "-"} <em>页码 P{page || "-"}</em>
      </span>
    </div>
  );
}

function TrendCell({ row }) {
  return (
    <div className="trend-cell">
      <TinySparkline seed={`${row.keyword}-${row.weeklySearchTrend}`} />
      <span>{row.weeklySearchTrend ? formatNumber(row.weeklySearchTrend) : "-"}</span>
    </div>
  );
}

function RankLane({ row }) {
  const maxScore = 192;
  const organicScore = getRankScore(row.organicPage, row.organicRankPosition);
  const spScore = getRankScore(row.spPage, row.spRankPosition);
  const organicX = organicScore ? clampPercent((organicScore / maxScore) * 100, 2) : null;
  const spX = spScore ? clampPercent((spScore / maxScore) * 100, 2) : null;

  return (
    <div className="rank-lane" aria-label="自然和 SP 排名对比">
      <div className="rank-lane-labels">
        <span>自然</span>
        <span>SP</span>
      </div>
      <div className="lane-track">
        {organicX && (
          <i className="lane-dot lane-organic" style={{ left: `${organicX}%` }}>
            {row.organicRankPosition}
          </i>
        )}
        {spX && (
          <i className="lane-dot lane-sp" style={{ left: `${spX}%` }}>
            {row.spRankPosition}
          </i>
        )}
      </div>
      <div className="lane-axis">
        <span>1</span>
        <span>48</span>
        <span>96</span>
        <span>144</span>
        <span>192</span>
      </div>
    </div>
  );
}

function getKeywordInsight(row) {
  const organicStrong = row.organicPage && row.organicPage <= 3;
  const spStrong = row.spPage && row.spPage <= 3;
  if (organicStrong && spStrong) return "双强: 自然和 SP 都在前三页";
  if (organicStrong) return "机会: 自然前三页, SP 弱或无排名";
  if (spStrong) return "风险: SP 前三页, 自然弱或无排名";
  return "双弱: 自然和 SP 都弱或无排名";
}

function KeywordDetailDrawer({ row, onClose, onCopy, onBlock }) {
  if (!row) return null;
  return (
    <div className="keyword-detail-overlay" role="presentation" onClick={onClose}>
      <section
        className="keyword-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${row.keyword} 统计详情`}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>关键词统计</span>
            <h2>{row.keyword}</h2>
            <p>{row.translation || "暂无翻译"}</p>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="关闭统计详情">
            ×
          </button>
        </header>
        <div className="keyword-detail-summary">
          <article>
            <span>周搜索趋势</span>
            <strong>{formatNumber(row.weeklySearchTrend)}</strong>
          </article>
          <article>
            <span>自然排名</span>
            <strong>{row.organicRankDetail || "无排名"}</strong>
          </article>
          <article>
            <span>SP(常规)排名</span>
            <strong>{row.spRankDetail || "无排名"}</strong>
          </article>
        </div>
        <div className="keyword-detail-ranks">
          <div>
            <h3>自然排名详情</h3>
            <RankBadge
              detail={row.organicRankDetail}
              page={row.organicPage}
              rank={row.organicRankPosition}
              total={row.organicTotal}
              tone="organic"
            />
          </div>
          <div>
            <h3>SP(常规)排名详情</h3>
            <RankBadge detail={row.spRankDetail} page={row.spPage} rank={row.spRankPosition} total={row.spTotal} tone="sp" />
          </div>
        </div>
        <div className="keyword-detail-lane">
          <h3>排名对比</h3>
          <RankLane row={row} />
          <p>{getKeywordInsight(row)}</p>
        </div>
        <footer>
          <button type="button" onClick={() => onCopy(row.keyword)}>
            复制关键词
          </button>
          <button type="button" className="drawer-danger" onClick={() => onBlock(row.keyword)}>
            加入屏蔽词
          </button>
        </footer>
      </section>
    </div>
  );
}

function KeywordTable({
  rows,
  page,
  totalPages,
  activeActionKey,
  onToggleActionMenu,
  onOpenStats,
  onCopyKeyword,
  onBlockKeyword,
  onSearchKeyword
}) {
  return (
    <div className="keyword-table-wrap">
      <table className="keyword-table">
        <thead>
          <tr>
            <th>
              <input type="checkbox" aria-label="全选当前页" />
            </th>
            <th>#</th>
            <th>关键词</th>
            <th>翻译</th>
            <th>搜索趋势 (7天)</th>
            <th>自然排名详情</th>
            <th>SP(常规)排名详情</th>
            <th>排名对比</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const actionKey = `${row.collectionId}-${row.id}`;
            const isMenuOpen = activeActionKey === actionKey;
            return (
              <tr key={actionKey} className={row.isBlocked ? "is-blocked" : ""}>
                <td>
                  <input type="checkbox" aria-label={`选择 ${row.keyword}`} />
                </td>
                <td className="index-cell">{(page - 1) * pageSize + index + 1}</td>
                <td className="keyword-cell">
                  <span className={row.organicPage === 1 ? "star hot" : "star"}>★</span>
                  <strong>{row.keyword}</strong>
                  {row.isBlocked && <small>命中屏蔽词: {row.blockedBy}</small>}
                </td>
                <td className="translation-cell">{row.translation || "-"}</td>
                <td>
                  <TrendCell row={row} />
                </td>
                <td>
                  <RankBadge
                    detail={row.organicRankDetail}
                    page={row.organicPage}
                    rank={row.organicRankPosition}
                    total={row.organicTotal}
                    tone="organic"
                  />
                </td>
                <td>
                  <RankBadge detail={row.spRankDetail} page={row.spPage} rank={row.spRankPosition} total={row.spTotal} tone="sp" />
                </td>
                <td>
                  <RankLane row={row} />
                </td>
                <td className="action-cell">
                  <button type="button" className="row-stat-button" title="查看统计详情" onClick={() => onOpenStats(row)}>
                    统计
                  </button>
                  <div className="row-action-wrap">
                    <button
                      type="button"
                      className="row-more-button"
                      title="更多操作"
                      aria-expanded={isMenuOpen}
                      onClick={() => onToggleActionMenu(isMenuOpen ? "" : actionKey)}
                    >
                      ...
                    </button>
                    {isMenuOpen && (
                      <div className="row-action-menu">
                        <button type="button" onClick={() => onCopyKeyword(row.keyword)}>
                          复制关键词
                        </button>
                        <button type="button" onClick={() => onSearchKeyword(row.keyword)}>
                          搜索该词
                        </button>
                        <button type="button" className="danger-action" onClick={() => onBlockKeyword(row.keyword)}>
                          加入屏蔽词
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan="9" className="empty-cell">
                当前筛选下暂无关键词。可以调整搜索, SP 条件或屏蔽词显示开关。
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {totalPages > 1 && <span className="table-scroll-hint">表格可横向滚动查看更多列</span>}
    </div>
  );
}

function Pagination({ page, totalPages, totalRows, onChange }) {
  const pages = [];
  const maxVisible = Math.min(totalPages, 5);
  for (let index = 1; index <= maxVisible; index += 1) pages.push(index);
  if (totalPages > 6) pages.push("gap", totalPages);

  return (
    <footer className="pagination-bar">
      <p>
        共 {formatNumber(totalRows)} 条记录, 每页 {pageSize} 条
      </p>
      <div>
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          ‹
        </button>
        {pages.map((item, index) =>
          item === "gap" ? (
            <span key={`gap-${index}`}>...</span>
          ) : (
            <button key={item} type="button" className={item === page ? "active" : ""} onClick={() => onChange(item)}>
              {item}
            </button>
          )
        )}
        <button type="button" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          ›
        </button>
      </div>
    </footer>
  );
}

function SourceRail({
  asins,
  selectedAsin,
  selectedAsinItem,
  collections,
  selectedCollectionId,
  selectedCollectionDate,
  retentionDays,
  activePanel,
  dashboard,
  isPending,
  blockWords,
  onSelectAsin,
  onSelectCollection,
  onSelectCollectionDate,
  onPanelChange,
  onRunCollector,
  onAddAsin,
  onPatchAsin,
  onAddBlockWord,
  onDeleteBlockWord
}) {
  const [sourceSearch, setSourceSearch] = useState("");
  const [newAsin, setNewAsin] = useState("");
  const [newBlockWord, setNewBlockWord] = useState("");
  const [showAddAsin, setShowAddAsin] = useState(false);

  const filteredAsins = asins.filter((item) => item.asin.includes(sourceSearch.trim().toUpperCase()));
  const enabledCount = asins.filter((item) => item.isEnabled).length;
  const disabledCount = asins.length - enabledCount;

  async function submitAsin(event) {
    event.preventDefault();
    await onAddAsin(newAsin);
    setNewAsin("");
    setShowAddAsin(false);
  }

  async function submitBlockWord(event) {
    event.preventDefault();
    await onAddBlockWord(newBlockWord);
    setNewBlockWord("");
  }

  return (
    <aside className="source-rail">
      <div className="brand-row">
        <div className="brand-mark">A</div>
        <div>
          <h1>SIF Keyword Lab</h1>
          <span>US</span>
        </div>
      </div>

      <section className="rail-panel">
        <div className="rail-heading">
          <h2>数据源</h2>
          <button type="button" onClick={() => setShowAddAsin((value) => !value)} aria-label="新增 ASIN">
            +
          </button>
        </div>
        <label className="search-box">
          <span>⌕</span>
          <input value={sourceSearch} onChange={(event) => setSourceSearch(event.target.value)} placeholder="搜索 ASIN" />
        </label>
        <div className="source-tabs">
          <span>全部 {asins.length}</span>
          <span>启用 {enabledCount}</span>
          <span>停用 {disabledCount}</span>
        </div>
        {showAddAsin && (
          <form className="inline-form" onSubmit={submitAsin}>
            <input value={newAsin} onChange={(event) => setNewAsin(event.target.value.toUpperCase())} placeholder="B0DM96Z44F" maxLength={10} />
            <button type="submit">添加</button>
          </form>
        )}
        <div className="asin-list">
          {filteredAsins.map((asin) => (
            <button
              key={asin.asin}
              className={asin.asin === selectedAsin ? "asin-row active" : "asin-row"}
              type="button"
              onClick={() => onSelectAsin(asin.asin)}
            >
              <i>⌁</i>
              <span>
                <b>{asin.asin}</b>
                <small>{asin.lastSuccessAt ? formatClock(asin.lastSuccessAt) : "暂无成功采集"}</small>
              </span>
              <em className={`status-dot dot-${statusMeta[asin.lastCollectionStatus || "never"]?.[1] || "muted"}`} />
              <StatusBadge status={asin.lastCollectionStatus} />
            </button>
          ))}
          {!filteredAsins.length && <p className="empty-note">暂无匹配 ASIN</p>}
        </div>
        {selectedAsinItem && (
          <div className="source-actions">
            <button type="button" onClick={() => onPatchAsin(selectedAsin, { isEnabled: !selectedAsinItem.isEnabled })}>
              {selectedAsinItem.isEnabled ? "停用" : "启用"}
            </button>
            <button type="button" className="danger-link" onClick={() => onPatchAsin(selectedAsin, { isDeleted: true })}>
              删除
            </button>
          </div>
        )}
      </section>

      <nav className="rail-nav" aria-label="侧栏功能">
        <button className={activePanel === "block-words" ? "is-active" : ""} type="button" onClick={() => onPanelChange("block-words")}>
          <span>盾</span> 屏蔽词管理 <b>{blockWords.length}</b>
        </button>
        <button className={activePanel === "tasks" ? "is-active" : ""} type="button" onClick={() => onPanelChange("tasks")}>
          <span>采</span> 采集任务
        </button>
        <button className={activePanel === "history" ? "is-active" : ""} type="button" onClick={() => onPanelChange("history")}>
          <span>史</span> 历史批次
        </button>
        <button className={activePanel === "settings" ? "is-active" : ""} type="button" onClick={() => onPanelChange("settings")}>
          <span>设</span> 系统设置
        </button>
      </nav>

      <section className="rail-panel rail-detail-panel" id={activePanel}>
        {activePanel === "block-words" && (
          <>
            <div className="rail-heading">
              <h2>屏蔽词</h2>
              <small>{blockWords.length}</small>
            </div>
            <form className="inline-form" onSubmit={submitBlockWord}>
              <input value={newBlockWord} onChange={(event) => setNewBlockWord(event.target.value)} placeholder="例如 black" />
              <button type="submit">添加</button>
            </form>
            <div className="block-word-list">
              {blockWords.map((word) => (
                <button key={word.id} type="button" onClick={() => onDeleteBlockWord(word.id)}>
                  {word.word} <span>×</span>
                </button>
              ))}
              {!blockWords.length && <p className="empty-note">暂无屏蔽词</p>}
            </div>
          </>
        )}

        {activePanel === "tasks" && (
          <>
            <div className="rail-heading">
              <h2>采集任务</h2>
              <StatusBadge status={selectedAsinItem?.lastCollectionStatus} />
            </div>
            <div className="rail-info-card">
              <span>采集范围</span>
              <b>全部启用 ASIN</b>
              <small>当前启用: {enabledCount} 个</small>
            </div>
            <button className="rail-primary-action" type="button" onClick={onRunCollector} disabled={!enabledCount || isPending}>
              {isPending ? "刷新中" : "采集全部启用"}
            </button>
            <div className="rail-mini-list">
              {collections.slice(0, 4).map((collection) => (
                <button key={collection.id} type="button" onClick={() => onSelectCollection(String(collection.id))}>
                  <span>#{collection.id}</span>
                  <b>{collection.status}</b>
                  <small>{formatTime(collection.completedAt || collection.createdAt)}</small>
                </button>
              ))}
              {!collections.length && <p className="empty-note">暂无采集记录</p>}
            </div>
          </>
        )}

        {activePanel === "history" && (
          <>
            <div className="rail-heading">
              <h2>历史批次</h2>
              <small>{collections.length}</small>
            </div>
            <label className="rail-date-filter">
              <span>按日期查看</span>
              <input
                type="date"
                value={selectedCollectionDate}
                min={getRetentionStartDate(retentionDays)}
                max={formatInputDate(new Date())}
                onChange={(event) => onSelectCollectionDate(event.target.value)}
              />
            </label>
            <button className={selectedCollectionId ? "rail-history-row" : "rail-history-row active"} type="button" onClick={() => onSelectCollection("")}>
              <span>{selectedCollectionDate ? "所选日期最新批次" : "最新批次"}</span>
              <b>{formatTime(dashboard.collection?.completedAt || selectedAsinItem?.lastSuccessAt)}</b>
            </button>
            <div className="rail-history-list">
              {collections.map((collection) => (
                <button
                  key={collection.id}
                  className={String(collection.id) === String(selectedCollectionId) ? "rail-history-row active" : "rail-history-row"}
                  type="button"
                  onClick={() => onSelectCollection(String(collection.id))}
                >
                  <span>#{collection.id} · {collection.status}</span>
                  <b>{formatTime(collection.completedAt || collection.createdAt)}</b>
                  {collection.errorMessage && <small>{collection.errorMessage}</small>}
                </button>
              ))}
              {!collections.length && <p className="empty-note">暂无历史批次</p>}
            </div>
          </>
        )}

        {activePanel === "settings" && (
          <>
            <div className="rail-heading">
              <h2>系统设置</h2>
              <small>v1</small>
            </div>
            <dl className="rail-settings-list">
              <div>
                <dt>站点</dt>
                <dd>US</dd>
              </div>
              <div>
                <dt>周期</dt>
                <dd>最近7天</dd>
              </div>
              <div>
                <dt>采集方式</dt>
                <dd>SIF 下载流量词</dd>
              </div>
              <div>
                <dt>历史保留</dt>
                <dd>最近 {retentionDays} 天</dd>
              </div>
              <div>
                <dt>Chrome 配置</dt>
                <dd>data/chrome-profile</dd>
              </div>
              <div>
                <dt>上传兜底</dt>
                <dd>已移除</dd>
              </div>
            </dl>
          </>
        )}
      </section>
        <small className="version">v1.1.0</small>
    </aside>
  );
}

function TopBar({
  asins,
  selectedAsin,
  selectedAsinItem,
  dashboard,
  collections,
  selectedCollectionId,
  selectedCollectionDate,
  retentionDays,
  onSelectAsin,
  onSelectCollection,
  onSelectCollectionDate,
  onRunCollector,
  onRefresh,
  isPending
}) {
  const status = selectedAsinItem?.lastCollectionStatus || "never";
  const enabledCount = asins.filter((asin) => asin.isEnabled && !asin.isDeleted).length;
  const currentCollectionTime = dashboard.collection?.completedAt || selectedAsinItem?.lastSuccessAt;
  return (
    <header className="top-bar">
      <button className="icon-button" type="button" aria-label="折叠菜单">
        <IconMenu />
      </button>
      <label className="asin-select">
        <span>ASIN</span>
        <select value={selectedAsin} onChange={(event) => onSelectAsin(event.target.value)}>
          {asins.map((asin) => (
            <option key={asin.asin} value={asin.asin}>
              {asin.asin}
            </option>
          ))}
        </select>
      </label>
      <div className="top-chip">
        <IconCalendar />
        最近7天 <b>({formatDateRange(currentCollectionTime)})</b>
      </div>
      <div className="top-chip top-chip-plain">
        <IconClock />
        最新采集: <b>{formatTime(currentCollectionTime)}</b>
      </div>
      <StatusBadge status={status} />
      <label className="date-select">
        <span>日期</span>
        <input
          type="date"
          value={selectedCollectionDate}
          min={getRetentionStartDate(retentionDays)}
          max={formatInputDate(new Date())}
          onChange={(event) => onSelectCollectionDate(event.target.value)}
        />
      </label>
      <select className="batch-select" value={selectedCollectionId} onChange={(event) => onSelectCollection(event.target.value)} disabled={!collections.length}>
        <option value="">{selectedCollectionDate ? "所选日期最新批次" : "最新批次"}</option>
        {collections.map((collection) => (
          <option key={collection.id} value={collection.id}>
            #{collection.id} {collection.status} {formatTime(collection.completedAt || collection.createdAt)}
          </option>
        ))}
      </select>
      <button type="button" className="collect-button" onClick={onRunCollector} disabled={!enabledCount}>
        <IconUpload />
        采集全部
      </button>
      <button type="button" className="ghost-button" onClick={onRefresh} disabled={!selectedAsin || isPending}>
        <IconRefresh />
        {isPending ? "刷新中" : "刷新"}
      </button>
    </header>
  );
}

function FilterBar({ search, onSearch, spFilter, onSpFilter, onlyFirstPage, onOnlyFirstPage, showBlocked, onShowBlocked }) {
  return (
    <section className="filter-bar">
      <label className="filter-search">
        <span>⌕</span>
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索关键词 (支持回车)" />
      </label>
      <select aria-label="排名筛选">
        <option>排名: 全部</option>
      </select>
      <select aria-label="自然筛选">
        <option>自然: 全部</option>
      </select>
      <select value={spFilter} onChange={(event) => onSpFilter(event.target.value)} aria-label="SP 筛选">
        <option value="">SP: 全部</option>
        <option value="hasSp">SP: 仅有排名</option>
        <option value="noSp">SP: 仅无排名</option>
      </select>
      <label className="switch">
        <input type="checkbox" checked={onlyFirstPage} onChange={(event) => onOnlyFirstPage(event.target.checked)} />
        <span /> 仅看第一页
      </label>
      <label className="switch">
        <input type="checkbox" checked={spFilter === "hasSp"} onChange={(event) => onSpFilter(event.target.checked ? "hasSp" : "")} />
        <span /> 仅看有 SP
      </label>
      <label className="switch">
        <input type="checkbox" checked={spFilter === "noSp"} onChange={(event) => onSpFilter(event.target.checked ? "noSp" : "")} />
        <span /> 仅看无 SP
      </label>
      <label className="switch">
        <input type="checkbox" checked={showBlocked} onChange={(event) => onShowBlocked(event.target.checked)} />
        <span /> 显示已屏蔽
      </label>
    </section>
  );
}

function MobilePreview({ selectedAsin, dashboard }) {
  const counts = dashboard.opportunities?.counts || {};
  return (
    <aside className="mobile-preview">
      <div className="phone-status">
        <span>9:41</span>
        <span>▮▮▮</span>
      </div>
      <header>
        <button type="button">☰</button>
        <div>
          <strong>{selectedAsin || "ASIN"}</strong>
          <small>{formatDate(dashboard.collection?.completedAt)}</small>
        </div>
        <button type="button">...</button>
      </header>
      <div className="phone-kpis">
        <KpiCard label="关键词总数" value={formatNumber(dashboard.summary.totalKeywords)} detail="" />
        <KpiCard label="展示 (未屏蔽)" value={formatNumber(dashboard.summary.visibleKeywords)} detail="" />
        <KpiCard label="自然有排名" value={formatNumber(dashboard.summary.organicCoverage)} detail="" />
        <KpiCard label="SP 有排名" value={formatNumber(dashboard.summary.spCoverage)} detail="" />
      </div>
      <div className="phone-coverage">
        <h4>页一覆盖率</h4>
        <div>
          <CoverageRing label="自然 P1" count={dashboard.summary.firstPageOrganic} total={dashboard.summary.organicCoverage} tone="organic" />
          <CoverageRing label="SP P1" count={dashboard.summary.firstPageSp} total={dashboard.summary.spCoverage} tone="sp" />
        </div>
      </div>
      <div className="phone-list">
        <h4>机会洞察 (占比)</h4>
        <p>自然强 / SP 弱 <b>{formatNumber(counts.organicStrongNoSp)}</b></p>
        <p>SP 有位 / 自然弱 <b>{formatNumber(counts.hasSpWeakOrganic)}</b></p>
        <p>双强 <b>{formatNumber(counts.bothStrong)}</b></p>
        <p>双弱 <b>{formatNumber(counts.bothWeak)}</b></p>
      </div>
      <footer>
        <span>⌂<b>概览</b></span>
        <span>⌕<b>关键词</b></span>
        <span>▤<b>批次</b></span>
        <span>…<b>更多</b></span>
      </footer>
    </aside>
  );
}

function App() {
  const [asins, setAsins] = useState([]);
  const [selectedAsin, setSelectedAsin] = useState("");
  const [collections, setCollections] = useState([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [selectedCollectionDate, setSelectedCollectionDate] = useState("");
  const [retentionDays, setRetentionDays] = useState(180);
  const [blockWords, setBlockWords] = useState([]);
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [keywords, setKeywords] = useState([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [showBlocked, setShowBlocked] = useState(false);
  const [onlyFirstPage, setOnlyFirstPage] = useState(false);
  const [spFilter, setSpFilter] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedKeywordRow, setSelectedKeywordRow] = useState(null);
  const [activeActionKey, setActiveActionKey] = useState("");
  const [activeRailPanel, setActiveRailPanel] = useState("block-words");

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

  async function refreshCollections(asin, date = selectedCollectionDate) {
    if (!asin) {
      setCollections([]);
      return;
    }
    const params = new URLSearchParams({ asin });
    if (date) params.set("date", date);
    const payload = await api(`/api/collections?${params.toString()}`);
    if (payload.retentionDays) setRetentionDays(payload.retentionDays);
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
      const dashboardParams = new URLSearchParams({ asin: selectedAsin });
      const keywordParams = new URLSearchParams({
        asin: selectedAsin,
        search: deferredSearch,
        showBlocked: String(showBlocked),
        onlyFirstPage: String(onlyFirstPage),
        spFilter
      });
      if (selectedCollectionId) {
        dashboardParams.set("collectionId", selectedCollectionId);
        keywordParams.set("collectionId", selectedCollectionId);
      } else if (selectedCollectionDate) {
        dashboardParams.set("date", selectedCollectionDate);
        keywordParams.set("date", selectedCollectionDate);
      }
      const [dashboardPayload, keywordPayload] = await Promise.all([
        api(`/api/dashboard?${dashboardParams.toString()}`),
        api(`/api/keywords?${keywordParams.toString()}`)
      ]);
      setDashboard(dashboardPayload);
      setKeywords(keywordPayload.items);
      setError("");
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
    refreshCollections(selectedAsin, selectedCollectionDate).catch((err) => setError(err.message));
  }, [selectedAsin, selectedCollectionDate]);

  useEffect(() => {
    setSelectedCollectionId("");
  }, [selectedAsin]);

  useEffect(() => {
    refreshData();
  }, [selectedAsin, selectedCollectionId, selectedCollectionDate, deferredSearch, showBlocked, onlyFirstPage, spFilter, blockWords.length]);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, showBlocked, onlyFirstPage, spFilter, selectedCollectionId, selectedCollectionDate, selectedAsin]);

  useEffect(() => {
    setActiveActionKey("");
    setSelectedKeywordRow(null);
  }, [selectedAsin, selectedCollectionId, selectedCollectionDate, deferredSearch, showBlocked, onlyFirstPage, spFilter]);

  useEffect(() => {
    if (!activeActionKey) return undefined;

    function closeActionMenu() {
      setActiveActionKey("");
    }

    function handlePointerDown(event) {
      if (event.target instanceof Element && event.target.closest(".action-cell")) return;
      closeActionMenu();
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") closeActionMenu();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", closeActionMenu, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", closeActionMenu, true);
    };
  }, [activeActionKey]);

  async function handleAddAsin(input) {
    setError("");
    try {
      const item = await api("/api/asins", {
        method: "POST",
        body: JSON.stringify({ asin: input })
      });
      setMessage(`已添加 ASIN ${item.asin}`);
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

  async function handleAddBlockWord(input) {
    setError("");
    try {
      await api("/api/block-words", {
        method: "POST",
        body: JSON.stringify({ word: input })
      });
      await refreshBlockWords();
      setMessage("屏蔽词已更新");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteBlockWord(id) {
    setError("");
    try {
      await api(`/api/block-words/${id}`, { method: "DELETE" });
      await refreshBlockWords();
      setMessage("屏蔽词已删除");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCopyKeyword(keyword) {
    setError("");
    try {
      await navigator.clipboard.writeText(keyword);
      setMessage(`已复制关键词: ${keyword}`);
      setActiveActionKey("");
    } catch {
      setError("复制失败, 可以手动选中关键词复制");
    }
  }

  async function handleBlockKeyword(keyword) {
    await handleAddBlockWord(keyword);
    setActiveActionKey("");
  }

  function handleSearchKeyword(keyword) {
    updateSearch(keyword);
    setMessage(`已筛选关键词: ${keyword}`);
    setActiveActionKey("");
  }

  function handleOpenKeywordStats(row) {
    setActiveActionKey("");
    setSelectedKeywordRow(row);
  }

  async function handleRunCollector() {
    const enabledCount = asins.filter((asin) => asin.isEnabled && !asin.isDeleted).length;
    if (!enabledCount) {
      setError("没有启用的 ASIN, 请先添加或启用 ASIN");
      return;
    }
    setError("");
    try {
      await api("/api/collections/run", {
        method: "POST"
      });
      setMessage(`已提交全部启用 ASIN 采集任务, 共 ${enabledCount} 个。采集主机会打开或复用专用 Chrome, 请留意窗口状态。`);
      setSelectedCollectionDate("");
      setSelectedCollectionId("");
      await refreshAsins();
    } catch (err) {
      setError(err.message);
    }
  }

  function updateSearch(value) {
    startTransition(() => setSearch(value));
  }

  function handleSelectCollectionDate(value) {
    setSelectedCollectionDate(value);
    setSelectedCollectionId("");
  }

  const selectedAsinItem = asins.find((item) => item.asin === selectedAsin);
  const totalPages = Math.max(1, Math.ceil(keywords.length / pageSize));
  const pagedKeywords = useMemo(() => keywords.slice((page - 1) * pageSize, page * pageSize), [keywords, page]);
  const statusText = selectedAsinItem?.lastError ? `错误: ${selectedAsinItem.lastError}` : "自动采集状态正常";

  return (
    <main className="app-shell">
      <SourceRail
        asins={asins}
        selectedAsin={selectedAsin}
        selectedAsinItem={selectedAsinItem}
        collections={collections}
        selectedCollectionId={selectedCollectionId}
        selectedCollectionDate={selectedCollectionDate}
        retentionDays={retentionDays}
        activePanel={activeRailPanel}
        dashboard={dashboard}
        isPending={isPending}
        blockWords={blockWords}
        onSelectAsin={setSelectedAsin}
        onSelectCollection={setSelectedCollectionId}
        onSelectCollectionDate={handleSelectCollectionDate}
        onPanelChange={setActiveRailPanel}
        onRunCollector={handleRunCollector}
        onAddAsin={handleAddAsin}
        onPatchAsin={handlePatchAsin}
        onAddBlockWord={handleAddBlockWord}
        onDeleteBlockWord={handleDeleteBlockWord}
      />

      <section className="workspace">
        <TopBar
          asins={asins}
          selectedAsin={selectedAsin}
          selectedAsinItem={selectedAsinItem}
          dashboard={dashboard}
          collections={collections}
          selectedCollectionId={selectedCollectionId}
          selectedCollectionDate={selectedCollectionDate}
          retentionDays={retentionDays}
          onSelectAsin={setSelectedAsin}
          onSelectCollection={setSelectedCollectionId}
          onSelectCollectionDate={handleSelectCollectionDate}
          onRunCollector={handleRunCollector}
          onRefresh={refreshData}
          isPending={isPending}
        />

        {(message || error) && (
          <div className={error ? "notice notice-error" : "notice"}>
            <span>{error || message}</span>
            <button type="button" onClick={() => { setMessage(""); setError(""); }}>
              关闭
            </button>
          </div>
        )}

        <section className="kpi-grid">
          <KpiCard
            label="关键词总数"
            value={formatNumber(dashboard.summary.totalKeywords)}
            detail={dashboard.summary.totalKeywords ? "来自最新成功采集批次" : "暂无成功批次"}
            subDetail={statusText}
            tone="neutral"
            sparkSeed={`${selectedAsin}-total`}
          />
          <KpiCard
            label="展示 (未屏蔽)"
            value={formatNumber(dashboard.summary.visibleKeywords)}
            detail={`${formatPercent(dashboard.summary.visibleKeywords, dashboard.summary.totalKeywords)} 占比`}
            tone="organic"
          />
          <KpiCard
            label="自然有排名"
            value={formatNumber(dashboard.summary.organicCoverage)}
            detail={`${formatPercent(dashboard.summary.organicCoverage, dashboard.summary.totalKeywords)} 占比`}
            tone="organic"
          />
          <KpiCard
            label="SP(常规)有排名"
            value={formatNumber(dashboard.summary.spCoverage)}
            detail={`${formatPercent(dashboard.summary.spCoverage, dashboard.summary.totalKeywords)} 占比`}
            tone="sp"
          />
          <KpiCard
            label="被屏蔽"
            value={formatNumber(dashboard.summary.blockedKeywords)}
            detail={`${formatPercent(dashboard.summary.blockedKeywords, dashboard.summary.totalKeywords)} 占比`}
            tone="slate"
          />
          <KpiCard
            label="自动采集状态"
            value={statusMeta[selectedAsinItem?.lastCollectionStatus || "never"]?.[0] || "未采集"}
            detail={`最后成功: ${formatClock(selectedAsinItem?.lastSuccessAt)}`}
            tone={selectedAsinItem?.lastCollectionStatus === "failed" ? "danger" : "organic"}
          />
        </section>

        <section className="analysis-grid">
          <DistributionPanel
            title="自然排名分布"
            distribution={dashboard.distributions.organicByPage}
            total={dashboard.summary.organicCoverage}
            tone="organic"
            legend="仅自然有排名"
          />
          <DistributionPanel
            title="SP(常规)排名分布"
            distribution={dashboard.distributions.spByPage}
            total={dashboard.summary.spCoverage}
            tone="sp"
            legend="仅SP有排名"
          />
          <OpportunityBoard dashboard={dashboard} />
          <CoveragePanel dashboard={dashboard} />
        </section>

        <section className="data-workbench">
          <div className="table-zone">
            <FilterBar
              search={search}
              onSearch={updateSearch}
              spFilter={spFilter}
              onSpFilter={setSpFilter}
              onlyFirstPage={onlyFirstPage}
              onOnlyFirstPage={setOnlyFirstPage}
              showBlocked={showBlocked}
              onShowBlocked={setShowBlocked}
            />
            <section className="table-card">
              <KeywordTable
                rows={pagedKeywords}
                page={page}
                totalPages={totalPages}
                activeActionKey={activeActionKey}
                onToggleActionMenu={setActiveActionKey}
                onOpenStats={handleOpenKeywordStats}
                onCopyKeyword={handleCopyKeyword}
                onBlockKeyword={handleBlockKeyword}
                onSearchKeyword={handleSearchKeyword}
              />
              <Pagination page={page} totalPages={totalPages} totalRows={keywords.length} onChange={(nextPage) => {
                setActiveActionKey("");
                setPage(nextPage);
              }} />
            </section>
          </div>
        </section>
      </section>
      <KeywordDetailDrawer
        row={selectedKeywordRow}
        onClose={() => setSelectedKeywordRow(null)}
        onCopy={handleCopyKeyword}
        onBlock={handleBlockKeyword}
      />
    </main>
  );
}

const rootElement = document.getElementById("root");
const root = rootElement.__adSqlRoot || createRoot(rootElement);
rootElement.__adSqlRoot = root;

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
