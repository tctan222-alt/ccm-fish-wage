import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { businessDateFromLegacy, legacyIsoDateFromBusinessDate } from '../lib/businessDate'
import { retailHistoryRange, shiftRetailWeek, type RetailHistoryRange } from '../lib/retailHistory'
import { makeRetailLine, MAX_RETAIL_LINES, prepareRetailSale, retailMoney, retailPriceCents, retailToday, retailWeightKg, type RetailFish, type RetailLine, type RetailSale, type RetailSaleInput } from '../lib/retailSales'
import { clearPendingRetailSale, initializeRetailFish, loadPendingRetailSale, loadRetailSale, newRetailSaleId, rememberPendingRetailSale, saveRetailFish, saveRetailSale, watchRetailFish, watchRetailSales, type RetailHistorySnapshot } from '../services/retailSales'
import { RetailFishPicker } from '../components/RetailFishPicker'
import { RetailReceipt, RetailReceiptActions } from '../components/RetailReceipt'
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
  return <label>{label}<input type="date" required value={value ? legacyIsoDateFromBusinessDate(value) : ''} onChange={event => onChange(event.target.value ? businessDateFromLegacy(event.target.value) : '')} /></label>
}

export function RetailSalesPage() {
  const { fish, error: loadError } = useFish()
  const [businessDate, setDate] = useState(retailToday), [vendorName, setVendor] = useState('')
  const [search, setSearch] = useState(''), [selected, setSelected] = useState<RetailFish | null>(null)
  const [createdFish, setCreatedFish] = useState<RetailFish[]>([]), [quickBusy, setQuickBusy] = useState(false)
  const [pickerVersion, setPickerVersion] = useState(0)
  const [weight, setWeight] = useState(''), [price, setPrice] = useState(''), [lines, setLines] = useState<RetailLine[]>([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [sale, setSale] = useState<RetailSale | null>(null)
  const [pending, setPending] = useState<{ id: string; input: RetailSaleInput } | null>(null)
  const saving = useRef(false), weightInput = useRef<HTMLInputElement>(null), searchInput = useRef<HTMLInputElement>(null)
  const [recoveryError, setRecoveryError] = useState('')
  const availableFish = fish === null ? null : [...fish, ...createdFish.filter(created => !fish.some(item => item.id === created.id))]
  useEffect(() => { if (selected && !quickBusy) weightInput.current?.focus() }, [selected, quickBusy])
  useEffect(() => {
    try {
      const restored = loadPendingRetailSale()
      if (restored) { setPending(restored); setDate(restored.input.businessDate); setVendor(restored.input.vendorName); setLines(restored.input.lines) }
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
        const input = prepareRetailSale({ businessDate, vendorName, lines })
        attempt = { id: newRetailSaleId(), input }; rememberPendingRetailSale(attempt); setPending(attempt)
      }
      saving.current = true; setBusy(true)
      const result = await saveRetailSale(attempt.id, attempt.input)
      clearPendingRetailSale(); setSale(result); setPending(null); saved()
    } catch (problem) { setError(message(problem)) } finally { saving.current = false; setBusy(false) }
  }
  function nextVendor() {
    setSale(null); setLines([]); setVendor(''); setDate(retailToday()); setSelected(null); setPrice(''); setWeight(''); setSearch(''); setError(''); saved()
  }
  if (sale) return <main className="retail-page"><RetailHeader title="结算完成 Checkout Complete" /><p className="success retail-no-print" role="status">现金结算已保存。 Cash sale saved.</p>
    <RetailReceipt sale={sale} /><RetailReceiptActions sale={sale} /><div className="retail-no-print retail-actions"><button onClick={nextVendor}>下一位小贩 Next Vendor</button></div></main>
  return <main className="retail-page retail-compact retail-entry"><RetailHeader title="门市销售 Retail Sales" />
    {(error || loadError || recoveryError) && <p className="error" role="alert">{error || loadError || recoveryError}</p>}
    {pending && <p className="notice">正在确认结算结果。失败时请点「重试结算」，系统会核对同一单号，避免重复保存。 Confirming checkout. If it fails, choose Retry Checkout; the same invoice ID prevents duplicate saves. 单号 Invoice No.：{pending.id}</p>}
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
  return <main className="retail-page"><RetailHeader title="门市鱼名与建议价 Retail Fish and Suggested Prices" />
    <p>建议价只供新交易带出，现场可改价；历史结算的名称和价格保持不变。 Suggested prices apply to new sales and can be overridden; historical names and prices stay unchanged.</p>
    {(error || loadError) && <p className="error" role="alert">{error || loadError}</p>}
    <button className="primary-action" disabled={fish === null || busy} onClick={() => setEditing(null)}>新增鱼种 Add Fish</button>
    {fish === null ? <p role="status">正在载入鱼种… Loading fish…</p> : fish.length === 0 ? <section><p>首次使用 First Use：建立 Create 甘丰 / kembung / RM6、马丰 / mabong / RM8、上过 / kerabu / RM33。</p><button disabled={busy} onClick={() => void initialize()}>建立初始三种鱼 Create Three Starter Fish</button></section> : null}
    <div className="master-card-list">{fish?.map(item => <article className="master-card" key={item.id}><h2>{item.chineseName}</h2><p>{item.malayName}</p><p>{item.suggestedPriceCents === null ? '未设建议价（现场输入） No Suggested Price (Enter at Sale)' : `${retailMoney(item.suggestedPriceCents)}/kg`} · {item.active ? '启用 Active' : '停用 Inactive'}</p><button onClick={() => setEditing(item)}>修改 Edit {item.chineseName}</button></article>)}</div>
    {editing !== undefined && <RetailFishForm item={editing} close={() => setEditing(undefined)} />}
  </main>
}

function RetailFishForm({ item, close }: { item: RetailFish | null; close: () => void }) {
  const [chineseName, setChinese] = useState(item?.chineseName ?? ''), [malayName, setMalay] = useState(item?.malayName ?? '')
  const [price, setPrice] = useState(item?.suggestedPriceCents == null ? '' : (item.suggestedPriceCents / 100).toFixed(2)), [active, setActive] = useState(item?.active ?? true)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('')
    try { await saveRetailFish(item?.id ?? null, { chineseName, malayName, suggestedPriceCents: price.trim() ? retailPriceCents(price) : null, active }); saved(); close() }
    catch (problem) { setError(message(problem)); setBusy(false) }
  }
  return <div className="dialog-backdrop"><section className="form-dialog" role="dialog" aria-modal="true" aria-label={item ? '修改鱼种 Edit Fish' : '新增鱼种 Add Fish'}><h2>{item ? '修改鱼种 Edit Fish' : '新增鱼种 Add Fish'}</h2>
    <form className="master-form" onSubmit={event => void submit(event)}><fieldset disabled={busy} className="retail-fields">
      <label>中文鱼名 Chinese Fish Name<input required maxLength={100} value={chineseName} onChange={event => setChinese(event.target.value)} /></label>
      <label>马来文名（可空） Malay Name (Optional)<input maxLength={100} value={malayName} onChange={event => setMalay(event.target.value)} /></label>
      <label>建议单价（可空） Suggested Price (RM/kg, Optional)<input inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} /></label>
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
  const filtered = snapshot?.sales.filter(item => item.vendorName.toLocaleLowerCase().includes(vendor.trim().toLocaleLowerCase())) ?? []
  return <main className="retail-page retail-compact retail-history"><RetailHeader title="销售历史 Sales History" />
    <section className="retail-history-filters" aria-label="历史筛选 History Filters">
      <div className="retail-period-switch" role="group" aria-label="查询方式 History Period">
        <button type="button" aria-pressed={mode === 'today'} onClick={() => { setToday(retailToday()); setMode('today') }}>今天 Today</button>
        <button type="button" aria-pressed={mode === 'week'} onClick={() => setMode('week')}>按周 Week</button>
        <button type="button" aria-pressed={mode === 'range'} aria-expanded={mode === 'range'} aria-controls="retail-history-range" onClick={() => setMode('range')}>范围 Range</button>
      </div>
      {mode === 'today' && <p className="retail-period-dates">日期 Date：{today}</p>}
      {mode === 'week' && <div className="retail-week-nav"><button type="button" aria-label="上一周 Previous Week" onClick={() => setWeekDate(date => shiftRetailWeek(date, -1))}>‹</button>
        <p className="retail-period-dates"><span>{fromDate} – {toDate}</span><small>周一至周日 Mon–Sun</small></p>
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
            <ul className="retail-history-list" aria-label="销售记录 Sales Records">{filtered.map(item => <li key={item.id}><Link className="retail-history-row" to={`/retail-sales/history/${item.id}`} aria-label={`查看结算单 View Invoice ${item.businessDate} ${item.vendorName} ${retailMoney(item.totalAmountCents)}`}>
              <time dateTime={legacyIsoDateFromBusinessDate(item.businessDate)} title={item.businessDate}>{item.businessDate.slice(0, 5)}</time><span className="retail-history-vendor">{item.vendorName}</span><strong>{retailMoney(item.totalAmountCents)}</strong><span aria-hidden="true">›</span>
            </Link></li>)}</ul></>}
      </>}
  </main>
}

export function RetailReceiptPage() {
  const { saleId = '' } = useParams(), [sale, setSale] = useState<RetailSale | null>(null), [error, setError] = useState('')
  useEffect(() => { let current = true; setSale(null); setError(''); void loadRetailSale(saleId).then(item => { if (current) setSale(item) }).catch(problem => { if (current) setError(message(problem)) }); return () => { current = false } }, [saleId])
  return <main className="retail-page"><RetailHeader title="门市现金结算单" />{error ? <p className="error" role="alert">{error}</p> : !sale ? <p role="status">正在载入结算单… Loading invoice…</p> : <><RetailReceipt sale={sale} /><RetailReceiptActions sale={sale} /></>}</main>
}
