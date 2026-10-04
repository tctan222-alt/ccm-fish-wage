import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { businessDateFromLegacy, legacyIsoDateFromBusinessDate } from '../lib/businessDate'
import { formatRetailDate } from '../lib/retailDate'
import { RETAIL_EDIT_WINDOW_MS, retailEditStatus } from '../lib/retailInvoice'
import { retailHistoryRange, shiftRetailWeek, type RetailHistoryRange } from '../lib/retailHistory'
import { makeRetailLine, MAX_RETAIL_LINES, prepareRetailSale, retailMoney, retailPriceCents, retailToday, retailWeightKg, type RetailFish, type RetailLine, type RetailSale, type RetailSaleInput } from '../lib/retailSales'
import { clearPendingRetailSale, initializeRetailFish, loadPendingRetailSale, loadRetailSale, newRetailSaleId, rememberPendingRetailSale, saveRetailFish, saveRetailSale, updateRetailSale, watchRetailFish, watchRetailSales, reconcilePendingRetailSale, type PendingRetailSale, type RetailHistorySnapshot } from '../services/retailSales'
import { RetailFishPicker } from '../components/RetailFishPicker'
import { RetailReceipt, RetailReceiptActions } from '../components/RetailReceipt'
import { RetailVesselPicker, useRetailVessels } from '../components/RetailVesselPicker'
import { useUnsavedChanges, useUnsavedForm } from '../components/dirtyState'
import './retailSales.css'

function message(error: unknown) {
  if (error instanceof Error) return `操作失败 Operation failed: ${error.message}`
  return '操作失败，请重试。 Operation failed. Please try again.'
}
function saved() { window.dispatchEvent(new Event('ccm:form-saved')) }

function useFish() {
  const [fish, setFish] = useState<RetailFish[] | null>(null), [error, setError] = useState('')
  useEffect(() => watchRetailFish(items => { setFish(items); setError('') }, () => { setFish(null); setError('无法载入鱼种，请检查连接及权限后刷新。 Unable to load fish. Check your connection and access, then refresh.') }), [])
  return { fish, error }
}

function RetailHeader({ title }: { title: string }) {
  return <header className="retail-no-print"><p className="eyebrow">门市 Retail</p><h1>{title}</h1>
    <nav className="retail-nav" aria-label="门市销售导航 Retail Navigation"><Link to="/retail-sales">现金销售 Cash Sales</Link><Link to="/retail-sales/history">销售历史 Sales History</Link><Link to="/retail-sales/fish">鱼名与建议价 Fish and Suggested Prices</Link></nav>
  </header>
}

function DateField({ value, onChange, label = '日期 Date' }: { value: string; onChange: (date: string) => void; label?: string }) {
  return <label>{label}<span className="retail-date-picker"><span aria-hidden="true">{value ? formatRetailDate(value) : '选择日期 Select Date'}</span><input aria-label={label} type="date" required value={value ? legacyIsoDateFromBusinessDate(value) : ''} onChange={event => onChange(event.target.value ? businessDateFromLegacy(event.target.value) : '')} /></span></label>
}

// Refresh at the actual creation-based deadline, and after a backgrounded page resumes.
// Firestore Rules independently enforce the window against request.time.
function useEditClock(sales: RetailSale[]) {
  const [, refresh] = useState(0)
  const now = Date.now()
  const deadlines = sales.flatMap(item => {
    try { const start = item.createdAt?.toDate().getTime(); return start !== undefined && Number.isFinite(start) && start <= now && start + RETAIL_EDIT_WINDOW_MS > now ? [start + RETAIL_EDIT_WINDOW_MS] : [] }
    catch { return [] }
  })
  const deadline = deadlines.length ? Math.min(...deadlines) : null
  useEffect(() => {
    const update = () => refresh(value => value + 1)
    const timer = deadline === null ? undefined : window.setTimeout(update, Math.min(2147483647, Math.max(0, deadline - Date.now())))
    window.addEventListener('focus', update); document.addEventListener('visibilitychange', update)
    return () => { if (timer !== undefined) window.clearTimeout(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update) }
  }, [deadline, now])
  return now
}

function editWindowMessage(status: ReturnType<typeof retailEditStatus>) {
  return status === 'expired' ? '已超过 30 天修改期限 / Editing period expired (30 days)' : '无法确认首次保存时间，暂不可编辑。 Original save time is unavailable; editing is disabled.'
}

function RetailEditEntry({ sale, now }: { sale: RetailSale; now: number }) {
  const status = retailEditStatus(sale, now)
  return <div className="retail-no-print retail-edit-entry">{status === 'editable' ? <Link to={`/retail-sales/history/${sale.id}/edit`}>编辑 Edit</Link> : <p role="status">{editWindowMessage(status)}</p>}</div>
}

export function RetailSalesPage() {
  const { fish, error: loadError } = useFish()
  const vesselOptions = useRetailVessels(), [vesselId, setVesselId] = useState('')
  const [businessDate, setDate] = useState(retailToday), [vendorName, setVendor] = useState(''), [remark, setRemark] = useState('')
  const [search, setSearch] = useState(''), [selected, setSelected] = useState<RetailFish | null>(null)
  const [createdFish, setCreatedFish] = useState<RetailFish[]>([]), [quickBusy, setQuickBusy] = useState(false)
  const [pickerVersion, setPickerVersion] = useState(0)
  const [weight, setWeight] = useState(''), [price, setPrice] = useState(''), [lines, setLines] = useState<RetailLine[]>([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [sale, setSale] = useState<RetailSale | null>(null)
  const [pending, setPending] = useState<PendingRetailSale | null>(null), [canRepairVessel, setCanRepairVessel] = useState(false)
  const saving = useRef(false), weightInput = useRef<HTMLInputElement>(null), searchInput = useRef<HTMLInputElement>(null)
  const [recoveryError, setRecoveryError] = useState('')
  useUnsavedChanges(!sale && (!!pending || !!vendorName || !!remark || !!weight || !!price || !!selected || lines.length > 0))
  const availableFish = fish === null ? null : [...fish, ...createdFish.filter(created => !fish.some(item => item.id === created.id))]
  useEffect(() => { if (selected && !quickBusy) weightInput.current?.focus() }, [selected, quickBusy])
  useEffect(() => {
    try {
      const restored = loadPendingRetailSale()
      if (restored) { setPending(restored); setDate(restored.input.businessDate); setVendor(restored.input.vendorName); setLines(prepareRetailSale(restored.input).lines); setRemark(restored.input.remark ?? ''); setVesselId(restored.vesselCorrection?.vesselId ?? restored.input.vesselId ?? '') }
    } catch { setRecoveryError('无法读取待确认结算，请从销售历史核对；暂不允许新结算。 Unable to restore the pending sale. Check Sales History before starting another checkout.') }
  }, [])
  const total = lines.reduce((sum, line) => sum + line.amountCents, 0)
  let preview: RetailLine | null = null
  try { if (selected && weight && price) preview = makeRetailLine(selected, weight, price) } catch { /* Show validation on add. */ }

  function select(item: RetailFish) {
    setSelected({ ...item }); setSearch(item.chineseName); setWeight(''); setPrice(item.suggestedPriceCents === null ? '' : (item.suggestedPriceCents / 100).toFixed(2))
    setError(''); weightInput.current?.focus()
  }
  function add(event: FormEvent) {
    event.preventDefault(); setError('')
    try {
      if (!selected || !availableFish?.some(item => item.id === selected.id && item.active)) throw new Error('请选择已有鱼种，或先补齐新鱼资料并保存。 Select an existing fish or complete and save the new fish details.')
      if (lines.length >= MAX_RETAIL_LINES) throw new Error(`本单已达 ${MAX_RETAIL_LINES} 条，请先结算。 This sale has reached ${MAX_RETAIL_LINES} items. Please check out first.`)
      const line = makeRetailLine(selected, weight, price)
      setLines(current => [...current, line]); setSelected(null); setWeight(''); setPrice(''); setSearch(''); searchInput.current?.focus()
    } catch (problem) { setError(message(problem)) }
  }
  async function checkout() {
    if (saving.current || quickBusy) return
    setError('')
    let attempt = pending
    try {
      if (!attempt) {
        if (selected || search.trim() || weight || price) throw new Error('请先加入或清除当前品名，再结算。 Add or clear the current fish before checkout.')
        const vessel = vesselOptions.vessels?.find(item => item.id === vesselId)
        if (!vessel) throw new Error('请先选择船号。 Please select a vessel.')
        const input = prepareRetailSale({ businessDate, vendorName, remark, lines, vesselId: vessel.id, vesselCodeSnapshot: vessel.vesselCode })
        attempt = { id: newRetailSaleId(), input }; rememberPendingRetailSale(attempt); setPending(attempt)
      } else if (canRepairVessel) {
        const vessel = vesselOptions.vessels?.find(item => item.id === vesselId)
        if (!vessel) throw new Error('请选择有效船号再重试。 Select an active vessel before retrying.')
        attempt = { ...attempt, vesselCorrection: { vesselId: vessel.id, vesselCodeSnapshot: vessel.vesselCode } }
        rememberPendingRetailSale(attempt); setPending(attempt)
      }
      // Freeze this attempted correction too: a lost response may hide a commit.
      // Another vessel change requires a fresh server reconciliation first.
      setCanRepairVessel(false); saving.current = true; setBusy(true)
      const result = attempt.vesselCorrection ? await saveRetailSale(attempt.id, attempt.input, attempt.vesselCorrection) : await saveRetailSale(attempt.id, attempt.input)
      clearPendingRetailSale(); setSale(result); setPending(null); saved()
    } catch (problem) { setError(message(problem)) } finally { saving.current = false; setBusy(false) }
  }
  async function repairVessel() {
    if (!pending || saving.current) return
    saving.current = true; setBusy(true); setError(''); setCanRepairVessel(false)
    try {
      const result = await reconcilePendingRetailSale(pending)
      if (result) { clearPendingRetailSale(); setSale(result); setPending(null); saved() }
      else { setCanRepairVessel(true); vesselOptions.retry() }
    } catch (problem) { setError(message(problem)) }
    finally { saving.current = false; setBusy(false) }
  }
  function nextVendor() {
    setSale(null); setLines([]); setVendor(''); setRemark(''); setSelected(null); setPrice(''); setWeight(''); setSearch(''); setError(''); setCanRepairVessel(false); saved()
  }
  if (sale) return <main className="retail-page"><RetailHeader title="结算完成 Checkout Complete" /><p className="success retail-no-print" role="status">现金结算已保存。 Cash sale saved.</p>
    <RetailReceipt sale={sale} /><RetailReceiptActions sale={sale} /><div className="retail-no-print retail-actions"><button onClick={nextVendor}>下一位小贩 Next Vendor</button></div></main>
  return <main className="retail-page retail-compact retail-entry"><RetailHeader title="门市销售 Retail Sales" />
    {(error || loadError || recoveryError) && <p className="error" role="alert">{error || loadError || recoveryError}</p>}
    {pending && <p className="notice">正在确认结算结果。失败时请点「重试结算」，系统会核对同一单号，避免重复保存。 Confirming checkout. If it fails, choose Retry Checkout; the same invoice ID prevents duplicate saves. 操作参考 Operation Reference：{pending.id}</p>}
    {pending && <button type="button" disabled={busy || quickBusy} onClick={() => void repairVessel()}>核对并重选船号 Verify and Reselect Vessel</button>}
    {canRepairVessel && <p className="notice">服务器确认此单尚未保存，可重选船号后重试；原单号及明细保留。 The server confirmed this invoice is not saved. Reselect a vessel and retry; the original ID and items are retained.</p>}
    <fieldset disabled={busy || quickBusy || (!!pending && !canRepairVessel)} className="retail-fields">
      <RetailVesselPicker {...vesselOptions} value={vesselId} onChange={setVesselId} historical={pending?.input} />
    </fieldset>
    <fieldset disabled={busy || quickBusy || !!pending} className="retail-fields">
      <section className="retail-context"><DateField value={businessDate} onChange={setDate} /><label>小贩 Vendor<input value={vendorName} maxLength={100} onChange={event => setVendor(event.target.value)} placeholder="直接输入小贩名 Enter vendor name" /></label></section>
      <section><RetailFishPicker key={pickerVersion} fish={availableFish} query={search} inputRef={searchInput} selectedFishId={selected?.id}
        onQueryChange={value => { setSearch(value); setSelected(null); setPrice(''); setWeight(''); setError('') }}
        onSelect={select} onCreated={item => setCreatedFish(current => [...current, item])} onBusyChange={setQuickBusy} />
        <p className="retail-selected">{selected ? <>{selected.chineseName} · {selected.malayName || '未填马来文名 No Malay Name'} · 建议 Suggested {selected.suggestedPriceCents === null ? '未设置 Not Set' : `${retailMoney(selected.suggestedPriceCents)}/kg`}</> : '输入鱼名，选择已有结果或直接新增。 Enter a fish name, then select a match or add a new fish.'}</p>
        <form onSubmit={add}>
        <div className="retail-numbers"><label>重量 Weight (kg)<input ref={weightInput} inputMode="decimal" value={weight} onChange={event => setWeight(event.target.value)} placeholder="0.1–300，最多一位小数 Max. 1 decimal place" /></label>
          <label>单价 Unit Price (RM/kg)<input inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} placeholder="手动输入售价 Enter unit price" /></label></div>
        <p className="retail-line-total">本行金额 Line Amount <strong>{preview ? retailMoney(preview.amountCents) : '—'}</strong></p>
        <div className="retail-actions"><button className="primary-action" disabled={!availableFish || !selected}>加入明细 Add Item</button><button type="button" onClick={() => { setSelected(null); setSearch(''); setWeight(''); setPrice(''); setError(''); setPickerVersion(current => current + 1) }}>清除当前品名 Clear Fish</button></div>
        </form></section>
      <section><h2>本单明细 Items ({lines.length})</h2><ol className="retail-lines">{lines.map((line, index) => <li key={index}><div><strong>{line.chineseName}</strong><small>{line.malayName}</small><span>{retailWeightKg(line)} kg × {retailMoney(line.unitPriceCents)}/kg</span></div><strong>{retailMoney(line.amountCents)}</strong><button aria-label={`移除第 ${index + 1} 条明细 Remove Item ${index + 1}`} onClick={() => setLines(current => current.filter((_, position) => position !== index))}>移除 Remove</button></li>)}</ol></section>
      <section><label>备注 Remark<textarea maxLength={500} value={remark} onChange={event => setRemark(event.target.value)} /></label></section>
    </fieldset>
    <section className="retail-checkout"><div>本次现金合计 Cash Total <strong>{retailMoney(total)}</strong></div><button className="primary-action" disabled={busy || quickBusy || !lines.length || !!recoveryError} onClick={() => void checkout()}>{busy ? '正在保存… Saving…' : pending ? '重试结算 Retry Checkout' : '结算 Checkout'}</button></section>
  </main>
}

export function RetailFishPage() {
  const { fish, error: loadError } = useFish()
  const [editing, setEditing] = useState<RetailFish | null | undefined>(undefined)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function initialize() {
    setBusy(true); setError('')
    try { await initializeRetailFish(); saved() } catch (problem) { setError(message(problem)) } finally { setBusy(false) }
  }
  return <main className="retail-page retail-master"><RetailHeader title="门市鱼种管理 Retail Master Data" />
    <p>建议价只供新交易带出，现场可改价；历史结算的名称和价格保持不变。 Suggested prices apply to new sales and can be overridden; historical names and prices stay unchanged.</p>
    {(error || loadError) && <p className="error" role="alert">{error || loadError}</p>}
    <button className="primary-action" disabled={fish === null || busy} onClick={() => setEditing(null)}>新增鱼种 Add Fish</button>
    {fish === null ? <p role="status">正在载入鱼种… Loading fish…</p> : fish.length === 0 ? <section><p>首次使用 First Use：建立 OWNER 已批准的 31 种门市鱼。仅甘丰 RM6、马丰 RM8、上过 RM33；其他建议价留空。 Create 31 approved Retail fish; unconfirmed prices remain blank.</p><button disabled={busy} onClick={() => void initialize()}>建立 31 种鱼 Create 31 Approved Fish</button></section> : null}
    <div className="master-card-list">{fish?.map(item => <article className="master-card" key={item.id}><h2>{item.chineseName}</h2><p>{item.malayName || '—'}</p><p>{item.suggestedPriceCents === null ? '—' : `${retailMoney(item.suggestedPriceCents)}/kg`} · {item.active ? '启用 Active' : '停用 Inactive'}</p><p>别名 Aliases：{item.aliases?.join(' / ') || '—'}</p><p>排序 Order：{item.sortOrder ?? 0}</p><button onClick={() => setEditing(item)}>修改 Edit {item.chineseName}</button></article>)}</div>
    {editing !== undefined && <RetailFishForm item={editing} close={() => setEditing(undefined)} />}
  </main>
}

function RetailFishForm({ item, close }: { item: RetailFish | null; close: () => void }) {
  const [chineseName, setChinese] = useState(item?.chineseName ?? ''), [malayName, setMalay] = useState(item?.malayName ?? '')
  const [price, setPrice] = useState(item?.suggestedPriceCents == null ? '' : (item.suggestedPriceCents / 100).toFixed(2)), [active, setActive] = useState(item?.active ?? true)
  const [aliases, setAliases] = useState(item?.aliases?.join('\n') ?? ''), [sortOrder, setSortOrder] = useState(item ? String(item.sortOrder ?? 0) : '')
  useUnsavedForm({ chineseName, malayName, price, active, aliases, sortOrder })
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('')
    try { await saveRetailFish(item?.id ?? null, { chineseName, malayName, suggestedPriceCents: price.trim() ? retailPriceCents(price) : null, active, aliases: aliases.split('\n').map(value => value.trim()).filter(Boolean), ...(sortOrder.trim() ? { sortOrder: Number(sortOrder) } : {}) }); saved(); close() }
    catch (problem) { setError(message(problem)); setBusy(false) }
  }
  return <div className="dialog-backdrop"><section className="form-dialog" role="dialog" aria-modal="true" aria-label={item ? '修改鱼种 Edit Fish' : '新增鱼种 Add Fish'}><h2>{item ? '修改鱼种 Edit Fish' : '新增鱼种 Add Fish'}</h2>
    <form className="master-form" onSubmit={event => void submit(event)}><fieldset disabled={busy} className="retail-fields">
      <label>中文鱼名 Chinese Fish Name<input required maxLength={100} value={chineseName} onChange={event => setChinese(event.target.value)} /></label>
      <label>马来文名（可空） Malay Name (Optional)<input maxLength={100} value={malayName} onChange={event => setMalay(event.target.value)} /></label>
      <label>建议单价（可空） Suggested Price (RM/kg, Optional)<input inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} /></label>
      <label>别名（每行一个，最多 5 个） Aliases (One per Line, up to 5)<textarea rows={3} maxLength={510} value={aliases} onChange={event => setAliases(event.target.value)} /></label>
      <label>排序 Order<input type="number" min={0} max={1000000} step={1} placeholder="自动排在末尾 Auto Append" value={sortOrder} onChange={event => setSortOrder(event.target.value)} /></label>
      <label className="check-label"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />启用 Active</label>
      {error && <p className="error" role="alert">{error}</p>}<button className="primary-action">{busy ? '正在保存… Saving…' : '保存鱼种 Save Fish'}</button><button type="button" onClick={close}>取消 Cancel</button>
    </fieldset></form></section></div>
}

type HistoryState = { rangeKey: string } & (
  | { status: 'loading' }
  | { status: 'ready'; snapshot: RetailHistorySnapshot }
  | { status: 'error'; message: string }
)

function historyError(problem: unknown): string {
  const code = problem && typeof problem === 'object' && 'code' in problem ? String(problem.code).replace(/^firestore\//, '') : ''
  if (code === 'permission-denied') return '没有读取销售历史的权限。 You do not have permission to read sales history. (permission-denied)'
  if (code === 'unauthenticated') return '登录已失效，请重新登录。 Your session has expired. Please sign in again. (unauthenticated)'
  if (code === 'unavailable') return '销售历史服务暂时无法连接，请检查网络后重试。 Sales history is unavailable. Check your connection and retry. (unavailable)'
  return `无法载入销售历史，请重试。 Unable to load sales history. Please retry. ${code ? `(${code}) ` : ''}${problem instanceof Error ? problem.message : ''}`
}

export function RetailHistoryPage() {
  const [mode, setMode] = useState<'today' | 'week' | 'range'>('today')
  const [today, setToday] = useState(retailToday), [weekDate, setWeekDate] = useState(retailToday)
  const [rangeFrom, setRangeFrom] = useState(retailToday), [rangeTo, setRangeTo] = useState(retailToday)
  const [vendor, setVendor] = useState('')
  let range: RetailHistoryRange | null = null, rangeError = ''
  try { range = retailHistoryRange(mode, mode === 'week' ? weekDate : today, rangeFrom, rangeTo) }
  catch (problem) { rangeError = message(problem) }
  const fromDate = range?.fromDate ?? '', toDate = range?.toDate ?? ''
  const rangeKey = `${fromDate}|${toDate}|${rangeError}`
  const [history, setHistory] = useState<HistoryState>({ rangeKey, status: 'loading' }), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    setHistory({ rangeKey, status: 'loading' })
    if (rangeError) { setHistory({ rangeKey, status: 'error', message: rangeError }); return }
    let stop = () => {}
    const fail = (problem: unknown) => { if (current) setHistory({ rangeKey, status: 'error', message: historyError(problem) }) }
    try {
      stop = watchRetailSales({ fromDate, toDate }, snapshot => { if (current) setHistory({ rangeKey, status: 'ready', snapshot }) }, fail)
    } catch (problem) { fail(problem) }
    return () => { current = false; stop() }
  }, [fromDate, toDate, rangeKey, rangeError, attempt])
  // Never show the previous range's rows or errors while a new subscription starts.
  const state = history.rangeKey === rangeKey ? history : { status: 'loading' as const }
  const snapshot = state.status === 'ready' ? state.snapshot : null
  const now = useEditClock(snapshot?.sales ?? [])
  const filtered = snapshot?.sales.filter(item => item.vendorName.toLocaleLowerCase().includes(vendor.trim().toLocaleLowerCase())) ?? []
  return <main className="retail-page retail-compact retail-history"><RetailHeader title="销售历史 Sales History" />
    <section className="retail-history-filters" aria-label="历史筛选 History Filters">
      <div className="retail-period-switch" role="group" aria-label="查询方式 History Period">
        <button type="button" aria-pressed={mode === 'today'} onClick={() => { setToday(retailToday()); setMode('today') }}>今天 Today</button>
        <button type="button" aria-pressed={mode === 'week'} onClick={() => setMode('week')}>按周 Week</button>
        <button type="button" aria-pressed={mode === 'range'} aria-expanded={mode === 'range'} aria-controls="retail-history-range" onClick={() => setMode('range')}>范围 Range</button>
      </div>
      {mode === 'today' && <p className="retail-period-dates">日期 Date：{formatRetailDate(today)}</p>}
      {mode === 'week' && <div className="retail-week-nav"><button type="button" aria-label="上一周 Previous Week" onClick={() => setWeekDate(date => shiftRetailWeek(date, -1))}>‹</button>
        <p className="retail-period-dates"><span>{formatRetailDate(fromDate)} – {formatRetailDate(toDate)}</span><small>周一至周日 Mon–Sun</small></p>
        <button type="button" aria-label="下一周 Next Week" onClick={() => setWeekDate(date => shiftRetailWeek(date, 1))}>›</button></div>}
      {mode === 'range' && <div className="retail-range-fields" id="retail-history-range"><DateField label="开始 From" value={rangeFrom} onChange={setRangeFrom} /><DateField label="结束 To" value={rangeTo} onChange={setRangeTo} /></div>}
      <label className="retail-history-search">搜索小贩 Search Vendor<input type="search" placeholder="小贩名 Vendor name" value={vendor} onChange={event => setVendor(event.target.value)} /></label>
    </section>
    {state.status === 'error' ? <><p className="error" role="alert">{state.message}</p>{!rangeError && <button type="button" onClick={() => setAttempt(value => value + 1)}>重试 Retry</button>}</>
      : state.status === 'loading' ? <p role="status">正在载入历史… Loading sales history…</p>
      : <>{snapshot?.fromCache && <p className="notice" role="status">{snapshot.sales.length ? '缓存 Cached：正在显示本机记录，服务器连接恢复后会自动更新。 Showing cached records; updates will arrive automatically when connected.' : '尚未取得服务器记录，连接恢复后会自动载入；目前不能确认所选范围内无销售。 Waiting for server records; sales will load automatically when connected. An empty sales history in this range is not yet confirmed.'}</p>}
        {!filtered.length ? (!snapshot?.fromCache || snapshot.sales.length > 0) && <p role="status">没有符合条件的销售。 No matching sales.</p>
          : <><p className="retail-history-summary">{filtered.length} 单 Sales · 合计 Total <strong>{retailMoney(filtered.reduce((sum, item) => sum + item.totalAmountCents, 0))}</strong></p>
            <div className="retail-history-columns" aria-hidden="true"><span>日期 Date</span><span>小贩 Vendor</span><span>总额 Total</span><span /></div>
            <ul className="retail-history-list" aria-label="销售记录 Sales Records">{filtered.map(item => <li key={item.id}><Link className="retail-history-row" to={`/retail-sales/history/${item.id}`} aria-label={`查看结算单 View Invoice ${formatRetailDate(item.businessDate)} ${item.vendorName} ${retailMoney(item.totalAmountCents)}`}>
              <time dateTime={legacyIsoDateFromBusinessDate(item.businessDate)}>{formatRetailDate(item.businessDate)}</time><span className="retail-history-vendor">{item.vendorName}<small>船号 Vessel：{item.vesselCodeSnapshot || '—'}</small><small>单号 No. {item.invoiceNumber ?? item.id}</small></span><strong>{retailMoney(item.totalAmountCents)}</strong><span aria-hidden="true">›</span>
            </Link>{retailEditStatus(item, now) === 'editable' && <Link className="retail-history-edit" to={`/retail-sales/history/${item.id}/edit`} aria-label={`编辑 Edit ${item.invoiceNumber ?? item.id} ${item.vendorName}`}>编辑 Edit</Link>}</li>)}</ul></>}
      </>}
  </main>
}

export function RetailReceiptPage() {
  const { saleId = '' } = useParams(), [sale, setSale] = useState<RetailSale | null>(null), [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0), [notFound, setNotFound] = useState(false)
  useEffect(() => {
    let current = true; setSale(null); setError(''); setNotFound(false)
    void loadRetailSale(saleId).then(item => { if (current) setSale(item) }).catch(problem => {
      if (!current) return
      if (problem?.code === 'retail/not-found') setNotFound(true)
      else setError(message(problem))
    })
    return () => { current = false }
  }, [saleId, attempt])
  const now = useEditClock(sale ? [sale] : [])
  return <main className="retail-page"><RetailHeader title="门市现金结算单" />{error ? <><p className="error" role="alert">{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重新载入 Reload</button></> : notFound ? <p className="notice" role="status">找不到此现金结算单。 Cash invoice not found.</p> : !sale ? <p role="status">正在载入结算单… Loading invoice…</p> : <><RetailReceipt sale={sale} /><RetailEditEntry sale={sale} now={now} /><RetailReceiptActions sale={sale} /></>}</main>
}

type EditableRetailLine = { key: number; sourceIndex: number; fishId: string; chineseName: string; malayName: string; weight: string; price: string }
function editableLine(line: RetailLine, key: number): EditableRetailLine {
  return { key, sourceIndex: key, fishId: line.fishId, chineseName: line.chineseName, malayName: line.malayName, weight: retailWeightKg(line), price: (line.unitPriceCents / 100).toFixed(2) }
}
function editedLine(line: EditableRetailLine): RetailLine {
  return makeRetailLine({ id: line.fishId, chineseName: line.chineseName, malayName: line.malayName, suggestedPriceCents: null, active: true }, line.weight, line.price)
}

export function RetailEditPage() {
  const { saleId = '' } = useParams()
  const [sale, setSale] = useState<RetailSale | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true; setSale(null); setError('')
    void loadRetailSale(saleId).then(item => { if (current) setSale(item) }).catch(problem => { if (current) setError(message(problem)) })
    return () => { current = false }
  }, [saleId, attempt])
  return <main className="retail-page retail-compact retail-edit"><RetailHeader title="编辑结算单 Edit Invoice" />
    {error ? <><p className="error" role="alert">{error}</p><button onClick={() => setAttempt(value => value + 1)}>重新载入 Reload Invoice</button></> : sale ? <RetailInvoiceEditor key={`${sale.id}:${attempt}`} original={sale} reload={() => setAttempt(value => value + 1)} /> : <p role="status">正在载入结算单… Loading invoice…</p>}
  </main>
}

function RetailInvoiceEditor({ original, reload }: { original: RetailSale; reload: () => void }) {
  const { fish, error: fishError } = useFish()
  const vesselOptions = useRetailVessels(), [vesselId, setVesselId] = useState(original.vesselId ?? '')
  const [vendorName, setVendor] = useState(original.vendorName), [remark, setRemark] = useState(original.remark ?? '')
  const [lines, setLines] = useState(() => original.lines.map(editableLine)), nextLineKey = useRef(original.lines.length)
  const [changingKey, setChangingKey] = useState<number | null>(null), [fishQuery, setFishQuery] = useState('')
  const [createdFish, setCreatedFish] = useState<RetailFish[]>([]), [quickBusy, setQuickBusy] = useState(false)
  const fishInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RetailSale | null>(null)
  const [pending, setPending] = useState<{ input: RetailSaleInput; operationId: string; originalLineIndices: number[] } | null>(null)
  const originalLines = original.lines.map(editableLine)
  useUnsavedChanges(!result && (!!pending || vendorName !== original.vendorName || remark !== (original.remark ?? '') || vesselId !== (original.vesselId ?? '') || JSON.stringify(lines) !== JSON.stringify(originalLines)))
  const saving = useRef(false), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const now = useEditClock([original]), status = retailEditStatus(original, now)
  const availableFish = fish === null ? null : [...fish, ...createdFish.filter(created => !fish.some(item => item.id === created.id))]
  let total: number | null = null
  try { total = lines.reduce((sum, line) => sum + editedLine(line).amountCents, 0) } catch { /* Do not show a partial total for invalid items. */ }
  function changeLine(key: number, update: Partial<EditableRetailLine>) { setLines(current => current.map(line => line.key === key ? { ...line, ...update } : line)) }
  function selectFish(selected: RetailFish) {
    if (!selected.active || changingKey === null) return
    const snapshot = { sourceIndex: -1, fishId: selected.id, chineseName: selected.chineseName, malayName: selected.malayName, price: selected.suggestedPriceCents === null ? '' : (selected.suggestedPriceCents / 100).toFixed(2) }
    if (changingKey === -1) {
      if (lines.length >= MAX_RETAIL_LINES) return
      setLines(current => [...current, { key: nextLineKey.current++, ...snapshot, weight: '' }])
    } else if (lines.find(line => line.key === changingKey)?.fishId !== selected.id) changeLine(changingKey, snapshot)
    setChangingKey(null); setFishQuery('')
  }
  function picker() {
    return <RetailFishPicker fish={availableFish} query={fishQuery} inputRef={fishInput} onQueryChange={setFishQuery} onSelect={selectFish}
      onCreated={item => setCreatedFish(current => [...current, item])} onBusyChange={setQuickBusy} />
  }
  async function saveEdit() {
    if (saving.current || quickBusy) return
    setError('')
    let update = pending
    try {
      // An uncertain committed update may be retried after expiry using the same operation ID.
      if (!update) {
        if (retailEditStatus(original) !== 'editable') throw new Error(editWindowMessage(retailEditStatus(original)))
        const vessel = vesselOptions.vessels?.find(item => item.id === vesselId)
        const vesselFields = vesselId === (original.vesselId ?? '') ? { vesselId: original.vesselId, vesselCodeSnapshot: original.vesselCodeSnapshot } : vessel ? { vesselId: vessel.id, vesselCodeSnapshot: vessel.vesselCode } : null
        if (!vesselFields) throw new Error('请选择有效船号。 Select a valid vessel.')
        update = { input: prepareRetailSale({ businessDate: original.businessDate, vendorName, remark, ...vesselFields, lines: lines.map(editedLine) }), operationId: newRetailSaleId(), originalLineIndices: lines.map(line => line.sourceIndex) }
        setPending(update)
      }
      saving.current = true; setBusy(true)
      const updated = await updateRetailSale(original.id, update.input, original.revision ?? 1, update.operationId, update.originalLineIndices)
      if (mounted.current) { setResult(updated); setPending(null); saved() }
    } catch (problem) { if (mounted.current) setError(message(problem)) }
    finally { saving.current = false; if (mounted.current) setBusy(false) }
  }
  if (result) return <><p className="success retail-no-print" role="status">修改已保存。 Changes saved.</p><RetailReceipt sale={result} /><RetailReceiptActions sale={result} /><Link className="retail-no-print" to="/retail-sales/history">返回销售历史 Back to Sales History</Link></>
  if (status !== 'editable' && !pending) return <><p role="status">{editWindowMessage(status)}</p><RetailReceipt sale={original} /><RetailReceiptActions sale={original} /></>
  return <div>
    <section className="retail-edit-identity"><p>单号 Invoice No.：<strong>{original.invoiceNumber ?? original.id}</strong></p><p>日期 Date：{formatRetailDate(original.businessDate)}</p><p>版本 Revision：{original.revision ?? 1}</p><small>保存后日期与单号不可修改。 The saved date and invoice number cannot be changed.</small></section>
    {error && <p className="error" role="alert">{error}</p>}
    {pending && <p className="notice">正在确认修改结果；重试会使用同一次修改，不会新增结算单。 Confirming this update; retry reuses the same operation and cannot create another invoice.</p>}
    {status !== 'editable' && <p role="status">{editWindowMessage(status)}</p>}
    <fieldset className="retail-fields" disabled={busy || quickBusy || !!pending || status !== 'editable'}>
      <section><label>小贩 Vendor<input required maxLength={100} value={vendorName} onChange={event => setVendor(event.target.value)} /></label></section>
      <RetailVesselPicker {...vesselOptions} value={vesselId} onChange={setVesselId} historical={original} />
      <section><h2>本单明细 Items ({lines.length})</h2><ol className="retail-edit-lines">{lines.map((line, index) => {
        let amount: number | null = null; try { amount = editedLine(line).amountCents } catch { /* Invalid values remain editable until submit. */ }
        return <li key={line.key}><h3>明细 Item {index + 1}</h3><button type="button" aria-label={`替换鱼种 Change Fish ${index + 1}`} onClick={() => { setChangingKey(line.key); setFishQuery('') }}>替换鱼种 Change Fish</button>
          {changingKey === line.key && picker()}
          <div className="retail-context"><label>中文鱼名 Chinese Fish Name<input aria-label={`中文鱼名 Chinese Fish Name ${index + 1}`} required maxLength={100} value={line.chineseName} onChange={event => changeLine(line.key, { chineseName: event.target.value })} /></label>
            <label>马来文名 Malay Name<input aria-label={`马来文名 Malay Name ${index + 1}`} maxLength={100} value={line.malayName} onChange={event => changeLine(line.key, { malayName: event.target.value })} /></label></div>
          <div className="retail-numbers"><label>重量 Weight (kg)<input aria-label={`重量 Weight (kg) ${index + 1}`} required inputMode="decimal" value={line.weight} onChange={event => changeLine(line.key, { weight: event.target.value })} /></label>
            <label>单价 Unit Price (RM/kg)<input aria-label={`单价 Unit Price (RM/kg) ${index + 1}`} required inputMode="decimal" value={line.price} onChange={event => changeLine(line.key, { price: event.target.value })} /></label></div>
          <p>金额 Amount (RM)：<strong>{amount === null ? '—' : retailMoney(amount)}</strong></p><button type="button" aria-label={`移除第 ${index + 1} 条明细 Remove Item ${index + 1}`} onClick={() => setLines(current => current.filter(item => item.key !== line.key))}>移除 Remove</button></li>
      })}</ol>
      {fishError && <p className="error" role="alert">{fishError}</p>}
      <button type="button" disabled={!fish || lines.length >= MAX_RETAIL_LINES} onClick={() => { setChangingKey(-1); setFishQuery('') }}>加入鱼种 Add Fish</button>
      {changingKey === -1 && picker()}
      <p className="notice">名称与价格只修改此结算单，不回写鱼种资料。 Names and prices update this invoice only; Master Data stays unchanged.</p></section>
      <section><label>备注 Remark<textarea maxLength={500} value={remark} onChange={event => setRemark(event.target.value)} /></label></section>
    </fieldset>
    <section className="retail-checkout"><div>总额 Total <strong>{total === null ? '—' : retailMoney(total)}</strong></div><button type="button" onClick={() => void saveEdit()} className="primary-action" disabled={busy || quickBusy || (!pending && (status !== 'editable' || !lines.length))}>{busy ? '正在保存… Saving…' : pending ? '重试修改 Retry Update' : '保存修改 Save Changes'}</button></section>
    {error && <button type="button" disabled={busy} onClick={reload}>重新载入（放弃未保存修改） Reload Invoice (Discard Unsaved Changes)</button>}
  </div>
}
