import React, { startTransition, useEffect, useState, useDeferredValue } from "react";
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
    organicByPage: { p1: 0, p2: 0, p3: 0, missing: 0 },
    spByPage: { p1: 0, p2: 0, p3: 0, missing: 0 }
  },
  opportunities: {
    organicStrongNoSp: [],
    hasSpWeakOrganic: [],
    bothWeak: []
  }
};

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

function formatTime(value) {
  if (!value) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function StatusPill({ status }) {
  const labelMap = {
    never: "未采集",
    running: "采集中",
    parsing: "解析中",
    completed: "已完成",
    failed: "失败"
  };
  return <span className={`pill status-${status || "never"}`}>{labelMap[status] || status || "未采集"}</span>;
}

function MetricCard({ label, value, note }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function DistributionBar({ title, distribution }) {
  const total =
    distribution.p1 + distribution.p2 + distribution.p3 + distribution.missing || 1;
  const segments = [
    ["p1", "第一页", distribution.p1],
    ["p2", "第二页", distribution.p2],
    ["p3", "第三页", distribution.p3],
    ["missing", "无排名", distribution.missing]
  ];
  return (
    <section className="distribution-card">
      <div className="section-heading">
        <h3>{title}</h3>
        <span>{formatNumber(total)} 词</span>
      </div>
      <div className="distribution-bar" aria-label={title}>
        {segments.map(([key, label, count]) => (
          <div
            key={key}
            className={`segment segment-${key}`}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${label}: ${count}`}
          />
        ))}
      </div>
      <div className="legend-row">
        {segments.map(([key, label, count]) => (
          <span key={key}>
            <i className={`dot segment-${key}`} />
            {label} {formatNumber(count)}
          </span>
        ))}
      </div>
    </section>
  );
}

function OpportunityList({ title, rows, emptyText }) {
  return (
    <section className="opportunity-card">
      <div className="section-heading">
        <h3>{title}</h3>
        <span>{rows.length}</span>
      </div>
      {rows.length ? (
        <ul>
          {rows.slice(0, 6).map((row) => (
            <li key={`${row.collectionId}-${row.id}`}>
              <b>{row.keyword}</b>
              <span>
                自然 {row.organicRankDetail || "-"} / SP {row.spRankDetail || "-"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{emptyText}</p>
      )}
    </section>
  );
}

function KeywordTable({ rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>关键词</th>
            <th>翻译</th>
            <th>自然排名详情</th>
            <th>SP(常规)排名详情</th>
            <th>周搜索趋势</th>
            <th>屏蔽</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.collectionId}-${row.id}`} className={row.isBlocked ? "is-blocked" : ""}>
              <td>{index + 1}</td>
              <td>
                <strong>{row.keyword}</strong>
              </td>
              <td>{row.translation || "-"}</td>
              <td>
                <span className="rank organic">{row.organicRankDetail || "-"}</span>
              </td>
              <td>
                <span className="rank sp">{row.spRankDetail || "-"}</span>
              </td>
              <td>{row.weeklySearchTrend ? formatNumber(row.weeklySearchTrend) : "-"}</td>
              <td>{row.isBlocked ? row.blockedBy : "-"}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan="7" className="empty-cell">
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

  return (
    <main className="app-shell">
      <aside className="side-panel">
        <div className="brand-block">
          <div className="brand-mark">S</div>
          <div>
            <h1>SIF 反查流量词</h1>
            <p>ASIN 采集与排名看板</p>
          </div>
        </div>

        <section className="panel-section">
          <h2>ASIN 数据源</h2>
          <form className="inline-form" onSubmit={handleAddAsin}>
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
                className={asin.asin === selectedAsin ? "asin-item active" : "asin-item"}
                type="button"
                onClick={() => setSelectedAsin(asin.asin)}
              >
                <span>{asin.asin}</span>
                <StatusPill status={asin.lastCollectionStatus} />
              </button>
            ))}
            {!asins.length && <p className="muted">先添加一个 ASIN。</p>}
          </div>
          {selectedAsinItem && (
            <div className="asin-actions">
              <button type="button" onClick={() => handlePatchAsin(selectedAsin, { isEnabled: !selectedAsinItem.isEnabled })}>
                {selectedAsinItem.isEnabled ? "停用" : "启用"}
              </button>
              <button type="button" className="danger" onClick={() => handlePatchAsin(selectedAsin, { isDeleted: true })}>
                删除
              </button>
            </div>
          )}
        </section>

        <section className="panel-section">
          <h2>屏蔽词</h2>
          <form className="inline-form" onSubmit={handleAddBlockWord}>
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
            {!blockWords.length && <p className="muted">暂无屏蔽词。</p>}
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyeline">US / 最近 7 天 / XLSX 入库</span>
            <h2>{selectedAsin || "选择一个 ASIN"}</h2>
            <p>
              最新批次 {formatTime(dashboard.collection?.completedAt)} ·{" "}
              {selectedAsinItem?.lastError ? `错误: ${selectedAsinItem.lastError}` : "自动采集失败时可直接上传 XLSX 兜底"}
            </p>
          </div>
          <div className="top-actions">
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
            <label className="upload-button">
              上传 XLSX
              <input type="file" accept=".xlsx,.xls" onChange={handleUpload} />
            </label>
            <button type="button" className="primary" onClick={handleRunCollector} disabled={!selectedAsin}>
              自动采集
            </button>
          </div>
        </header>

        {(message || error) && (
          <div className={error ? "notice error" : "notice"}>
            {error || message}
            <button type="button" onClick={() => { setMessage(""); setError(""); }}>
              关闭
            </button>
          </div>
        )}

        <section className="metric-grid">
          <MetricCard label="全部关键词" value={formatNumber(dashboard.summary.totalKeywords)} note="原始 XLSX 行数" />
          <MetricCard label="当前展示" value={formatNumber(dashboard.summary.visibleKeywords)} note={`屏蔽 ${formatNumber(dashboard.summary.blockedKeywords)} 词`} />
          <MetricCard label="自然排名覆盖" value={formatNumber(dashboard.summary.organicCoverage)} note={`第一页 ${formatNumber(dashboard.summary.firstPageOrganic)}`} />
          <MetricCard label="SP(常规)覆盖" value={formatNumber(dashboard.summary.spCoverage)} note={`第一页 ${formatNumber(dashboard.summary.firstPageSp)}`} />
        </section>

        <section className="chart-grid">
          <DistributionBar title="自然排名页码分布" distribution={dashboard.distributions.organicByPage} />
          <DistributionBar title="SP(常规)排名页码分布" distribution={dashboard.distributions.spByPage} />
        </section>

        <section className="opportunity-grid">
          <OpportunityList
            title="自然强, SP 空缺"
            rows={dashboard.opportunities.organicStrongNoSp}
            emptyText="暂无第一页自然词缺 SP 的机会。"
          />
          <OpportunityList
            title="SP 有位, 自然偏弱"
            rows={dashboard.opportunities.hasSpWeakOrganic}
            emptyText="暂无 SP 有排名但自然偏弱的关键词。"
          />
          <OpportunityList
            title="自然和 SP 都偏弱"
            rows={dashboard.opportunities.bothWeak}
            emptyText="暂无双弱关键词。"
          />
        </section>

        <section className="table-card">
          <div className="table-toolbar">
            <div>
              <h3>关键词明细</h3>
              <p>{isPending ? "刷新中..." : `展示 ${formatNumber(keywords.length)} 行`}</p>
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
          <KeywordTable rows={keywords} />
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
