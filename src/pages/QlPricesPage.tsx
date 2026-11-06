import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { QL_METHOD_LABELS, QL_SEED_VERSION, matchQlPrice, selectQlVersion, type QlMethod, type QlPriceChange, type QlPriceVersion } from '../lib/qlPrices'
import { malaysiaDateKey, money } from '../lib/wage'
import { createQlPriceSync, type QlSheetReader } from '../services/qlPriceSync'
import './QlPricesPage.css'

/** Independent buyer reference. Checking or staging never persists business data. */
export function QlPricesPage({ reader, initialBusinessDate = malaysiaDateKey() }: {
  reader?: QlSheetReader
  initialBusinessDate?: string
}) {
  const [sync] = useState(() => createQlPriceSync({ reader }))
  const state = useSyncExternalStore(sync.subscribe, sync.getSnapshot, sync.getSnapshot)
  useEffect(() => () => sync.dispose(), [sync])
  const [businessDate, setBusinessDate] = useState(initialBusinessDate)
  const [search, setSearch] = useState('')
  const [method, setMethod] = useState<QlMethod | ''>('')
  let version: QlPriceVersion | null = null
  let dateError = ''
  try { version = selectQlVersion(state.history, businessDate) }
  catch { dateError = '请选择有效业务日期。' }
  const query = search.trim()
  const rows = version?.rows.filter(row => (!method || row.method === method)
    && (!query || row.label.includes(query) || row.aliases.some(alias => alias.includes(query)))) ?? []
  const needsReview = version && query && matchQlPrice(version, query, method || undefined).status === 'review-needed'
  const preview = state.preview
  const localVersion = version && version.version !== QL_SEED_VERSION.version

  return <main className="ql-prices"><header>
    <p className="eyebrow">CCM Fishery · QL Foods Sdn. Bhd.</p>
    <h1>QL 鱼头价格参考</h1>
    <Link className="page-link" to="/master-data">← 主资料中心</Link>
  </header>
    <p className="notice">QL 买家专用参考价。ERP 尚无关联买家的鱼头销售流程；此表不用于船只采购结算或门市销售。</p>
    <section className="ql-source" aria-label="QL 来源与版本">
      <p><strong>{localVersion ? '本页暂存版本（未发布）' : version ? '已核准参考版本' : '已载入参考版本（此日期不适用）'}</strong>：{version?.version ?? QL_SEED_VERSION.version}</p>
      <p>生效日期：{version?.effectiveDate ?? QL_SEED_VERSION.effectiveDate} · 来源：
        <a href={QL_SEED_VERSION.source.url} target="_blank" rel="noreferrer">QL Foods Google Sheet</a>
        {' '}({QL_SEED_VERSION.source.range})</p>
      <p className="ql-source-note">{version?.source.title ?? QL_SEED_VERSION.source.title}</p>
    </section>
    <div className="ql-filters">
      <label>业务日期<input type="date" value={businessDate} onChange={event => setBusinessDate(event.target.value)} /></label>
      <label>搜索鱼名 / 来源组别<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="例如：丁温、青兰" /></label>
      <label>作业方式<select value={method} onChange={event => setMethod(event.target.value as QlMethod | '')}>
        <option value="">全部方式</option>
        {Object.entries(QL_METHOD_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
    </div>
    {dateError && <p className="error" role="alert">{dateError}</p>}
    {!dateError && !version && <p className="notice" role="status">该业务日期尚无已生效的 QL 价格版本。</p>}
    {needsReview && <p className="notice" role="status">需要复核：请选择明确组别与作业方式，不会自动选用单价。来源简称不自动扩展。</p>}
    {version && <section aria-label="QL 价格组别">
      <p>显示 {rows.length} / {version.rows.length} 个来源组别 · RM/kg</p>
      {rows.length === 0 ? <p className="notice">没有符合条件的组别，请核对原表。</p>
        : <div className="ql-price-list">{rows.map(row => <article className="ql-price-card" key={`${row.groupKey}:${row.method}`}>
          <div><h2>{row.label}</h2><p>{QL_METHOD_LABELS[row.method]} · 来源第 {row.sourceRow} 行</p></div>
          <strong className="ql-price-value">RM{money(row.priceCentsPerKg)}<small>/kg</small></strong>
          <p className="ql-price-change">旧价 RM{money(row.oldPriceCentsPerKg)} · 调整 {row.changeCentsPerKg ? `${row.changeCentsPerKg > 0 ? '+' : '-'}RM${money(Math.abs(row.changeCentsPerKg))}` : '不变'}</p>
        </article>)}</div>}
    </section>}
    <section className="ql-sync" aria-label="QL 更新检查">
      <h2>检查原表更新</h2>
      <p>检查只读取原表并预览差异。后续价格发布须另行批准；不会自动更改历史单据。</p>
      <button type="button" onClick={() => void sync.check()}>检查 QL 更新</button>
      {state.status === 'checking' && <p role="status">正在检查 QL 原表…</p>}
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {preview && <section className="ql-preview" aria-label="QL 更新预览">
        <h3>更新预览（尚未采用）</h3>
        <p>版本 {preview.candidate.version} · 生效 {preview.candidate.effectiveDate} · {preview.diff.changes.length} 个组别有差异</p>
        {preview.diff.warnings.map(warning => <p className="notice" key={warning}>{warning}</p>)}
        {preview.diff.changes.length === 0 ? <p>与已载入版本一致。</p> : <PriceChanges changes={preview.diff.changes} />}
        <button type="button" disabled={state.status !== 'ready'} onClick={() => sync.stagePreview()}>仅在本页暂存预览</button>
        <p>暂存只保留到本页关闭或刷新，不发布价格，也不保存到业务资料。</p>
      </section>}
      {state.audit.length > 0 && <details className="ql-local-audit">
        <summary>本页暂存记录：{state.audit.length} 次</summary>
        <p>仅供本页复核，刷新即失。暂存版本均未发布。</p>
        <ol>{state.audit.map((entry, index) => <li key={`${entry.afterVersion}:${entry.at}:${index}`}>
          <p>{new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(entry.at))}（马来西亚时间）</p>
          <p>{entry.beforeVersion ?? '无先前版本'} → {entry.afterVersion} · 生效 {entry.effectiveDate}</p>
          <PriceChanges changes={entry.changes} />
        </li>)}</ol>
      </details>}
    </section>
  </main>
}

function PriceChanges({ changes }: { changes: readonly QlPriceChange[] }) {
  return <ul>{changes.map(change => <li key={change.key}>
    {change.after?.label ?? change.before?.label} · {QL_METHOD_LABELS[(change.after ?? change.before)!.method]}：
    {change.before ? `RM${money(change.before.priceCentsPerKg)}` : '无'} → {change.after ? `RM${money(change.after.priceCentsPerKg)}` : '无'} /kg
  </li>)}</ul>
}
