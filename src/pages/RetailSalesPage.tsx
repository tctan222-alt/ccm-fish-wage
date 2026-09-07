import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { businessDateFromLegacy, legacyIsoDateFromBusinessDate } from '../lib/businessDate'
import { makeRetailLine, MAX_RETAIL_LINES, prepareRetailSale, retailMoney, retailPriceCents, retailToday, retailWeightKg, type RetailFish, type RetailLine, type RetailSale, type RetailSaleInput } from '../lib/retailSales'
import { clearPendingRetailSale, initializeRetailFish, loadPendingRetailSale, loadRetailSale, loadRetailSales, newRetailSaleId, rememberPendingRetailSale, saveRetailFish, saveRetailSale, watchRetailFish } from '../services/retailSales'
import { RetailFishPicker } from '../components/RetailFishPicker'
import { RetailReceipt, RetailReceiptActions } from '../components/RetailReceipt'
import './retailSales.css'

function message(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试。' }
function saved() { window.dispatchEvent(new Event('ccm:form-saved')) }

function useFish() {
  const [fish, setFish] = useState<RetailFish[] | null>(null), [error, setError] = useState('')
  useEffect(() => watchRetailFish(items => { setFish(items); setError('') }, () => { setFish(null); setError('无法载入鱼种，请检查连接及权限后刷新。') }), [])
  return { fish, error }
}

function RetailHeader({ title }: { title: string }) {
  return <header className="retail-no-print"><p className="eyebrow">CCM Fishery</p><h1>{title}</h1>
    <nav className="retail-nav" aria-label="门市销售导航"><Link to="/retail-sales">现金销售</Link><Link to="/retail-sales/history">销售历史</Link><Link to="/retail-sales/fish">鱼名与建议价</Link></nav>
  </header>
}

function DateField({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  return <label>日期<input type="date" required value={value ? legacyIsoDateFromBusinessDate(value) : ''} onChange={event => onChange(event.target.value ? businessDateFromLegacy(event.target.value) : '')} /></label>
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
    } catch { setRecoveryError('无法读取待确认结算，请从销售历史核对；暂不允许新结算。') }
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
      if (!selected || !availableFish?.some(item => item.id === selected.id && item.active)) throw new Error('请选择已有鱼种，或先补齐新鱼资料并保存。')
      if (lines.length >= MAX_RETAIL_LINES) throw new Error(`本单已达 ${MAX_RETAIL_LINES} 条，请先结算。`)
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
        if (selected || search.trim() || weight || price) throw new Error('请先加入或清除当前品名，再结算。')
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
  if (sale) return <main className="retail-page"><RetailHeader title="结算完成" /><p className="success retail-no-print" role="status">现金结算已保存。</p>
    <RetailReceipt sale={sale} /><RetailReceiptActions sale={sale} /><div className="retail-no-print retail-actions"><button onClick={nextVendor}>下一位小贩</button></div></main>
  return <main className="retail-page"><RetailHeader title="门市销售" />
    {(error || loadError || recoveryError) && <p className="error" role="alert">{error || loadError || recoveryError}</p>}
    {pending && <p className="notice">正在确认结算结果。失败时请点「重试结算」，系统会核对同一单号，避免重复保存。单号：{pending.id}</p>}
    <fieldset disabled={busy || quickBusy || !!pending} className="retail-fields">
      <section className="retail-context"><DateField value={businessDate} onChange={setDate} /><label>小贩名<input value={vendorName} maxLength={100} onChange={event => setVendor(event.target.value)} placeholder="直接输入小贩名" /></label></section>
      <section><RetailFishPicker key={pickerVersion} fish={availableFish} query={search} inputRef={searchInput}
        onQueryChange={value => { setSearch(value); setSelected(null); setPrice(''); setWeight(''); setError('') }}
        onSelect={select} onCreated={item => setCreatedFish(current => [...current, item])} onBusyChange={setQuickBusy} />
        <p className="retail-selected">{selected ? <>{selected.chineseName} · {selected.malayName || '未填马来文名'} · 建议 {selected.suggestedPriceCents === null ? '未设置' : `${retailMoney(selected.suggestedPriceCents)}/kg`}</> : '输入鱼名，选择已有结果或直接新增。'}</p>
        <form onSubmit={add}>
        <div className="retail-numbers"><label>重量 kg<input ref={weightInput} inputMode="decimal" value={weight} onChange={event => setWeight(event.target.value)} placeholder="0.1–300，最多一位小数" /></label>
          <label>实际 RM/kg<input inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} placeholder="手动输入售价" /></label></div>
        <p className="retail-line-total">本行金额 <strong>{preview ? retailMoney(preview.amountCents) : '—'}</strong></p>
        <div className="retail-actions"><button className="primary-action" disabled={!availableFish || !selected}>加入明细</button><button type="button" onClick={() => { setSelected(null); setSearch(''); setWeight(''); setPrice(''); setError(''); setPickerVersion(current => current + 1) }}>清除当前品名</button></div>
        </form></section>
      <section><h2>本单明细（{lines.length}）</h2><ol className="retail-lines">{lines.map((line, index) => <li key={index}><div><strong>{line.chineseName}</strong><small>{line.malayName}</small><span>{retailWeightKg(line)} kg × {retailMoney(line.unitPriceCents)}/kg</span></div><strong>{retailMoney(line.amountCents)}</strong><button aria-label={`移除第 ${index + 1} 条明细`} onClick={() => setLines(current => current.filter((_, position) => position !== index))}>移除</button></li>)}</ol></section>
    </fieldset>
    <section className="retail-checkout"><div>本次现金合计 <strong>{retailMoney(total)}</strong></div><button className="primary-action" disabled={busy || quickBusy || !lines.length || !!recoveryError} onClick={() => void checkout()}>{busy ? '正在保存…' : pending ? '重试结算' : '结算'}</button></section>
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
  return <main className="retail-page"><RetailHeader title="门市鱼名与建议价" />
    <p>建议价只供新交易带出，现场可改价；历史结算的名称和价格保持不变。</p>
    {(error || loadError) && <p className="error" role="alert">{error || loadError}</p>}
    <button className="primary-action" disabled={fish === null || busy} onClick={() => setEditing(null)}>新增鱼种</button>
    {fish === null ? <p role="status">正在载入鱼种…</p> : fish.length === 0 ? <section><p>首次使用：建立甘丰 / kembung / RM6、马丰 / mabong / RM8、上过 / kerabu / RM33。</p><button disabled={busy} onClick={() => void initialize()}>建立初始三种鱼</button></section> : null}
    <div className="master-card-list">{fish?.map(item => <article className="master-card" key={item.id}><h2>{item.chineseName}</h2><p>{item.malayName}</p><p>{item.suggestedPriceCents === null ? '未设建议价（现场输入）' : `${retailMoney(item.suggestedPriceCents)}/kg`} · {item.active ? '启用' : '停用'}</p><button onClick={() => setEditing(item)}>修改 {item.chineseName}</button></article>)}</div>
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
  return <div className="dialog-backdrop"><section className="form-dialog" role="dialog" aria-modal="true" aria-label={item ? '修改鱼种' : '新增鱼种'}><h2>{item ? '修改鱼种' : '新增鱼种'}</h2>
    <form className="master-form" onSubmit={event => void submit(event)}><fieldset disabled={busy} className="retail-fields">
      <label>中文鱼名<input required maxLength={100} value={chineseName} onChange={event => setChinese(event.target.value)} /></label>
      <label>马来文名（可空）<input maxLength={100} value={malayName} onChange={event => setMalay(event.target.value)} /></label>
      <label>建议 RM/kg（可空）<input inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} /></label>
      <label className="check-label"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />启用</label>
      {error && <p className="error" role="alert">{error}</p>}<button className="primary-action">{busy ? '正在保存…' : '保存鱼种'}</button><button type="button" onClick={close}>取消</button>
    </fieldset></form></section></div>
}

export function RetailHistoryPage() {
  const [date, setDate] = useState(retailToday), [vendor, setVendor] = useState('')
  const [sales, setSales] = useState<RetailSale[] | null>(null), [error, setError] = useState('')
  useEffect(() => {
    let current = true
    setSales(null); setError('')
    if (!date) { setError('请选择日期。'); return }
    void loadRetailSales(date).then(items => { if (current) setSales(items) }).catch(() => { if (current) setError('无法载入历史，请检查连接及权限。') })
    return () => { current = false }
  }, [date])
  const filtered = sales?.filter(item => item.vendorName.toLocaleLowerCase().includes(vendor.trim().toLocaleLowerCase()))
  return <main className="retail-page"><RetailHeader title="门市销售历史" /><section className="retail-context"><DateField value={date} onChange={setDate} /><label>搜索小贩名<input type="search" value={vendor} onChange={event => setVendor(event.target.value)} /></label></section>
    {error ? <p className="error" role="alert">{error}</p> : sales === null ? <p role="status">正在载入历史…</p> : !filtered?.length ? <p>没有符合条件的销售。</p> : <><p>{filtered.length} 单 · 合计 {retailMoney(filtered.reduce((sum, item) => sum + item.totalAmountCents, 0))}</p>{filtered.map(item => <article className="master-card" key={item.id}><h2>{item.vendorName}</h2><p>{item.businessDate} · {item.lines.length} 项 · {retailMoney(item.totalAmountCents)}</p><Link className="page-link" to={`/retail-sales/history/${item.id}`}>查看并打印 {item.vendorName}</Link></article>)}</>}
  </main>
}

export function RetailReceiptPage() {
  const { saleId = '' } = useParams(), [sale, setSale] = useState<RetailSale | null>(null), [error, setError] = useState('')
  useEffect(() => { let current = true; setSale(null); setError(''); void loadRetailSale(saleId).then(item => { if (current) setSale(item) }).catch(problem => { if (current) setError(message(problem)) }); return () => { current = false } }, [saleId])
  return <main className="retail-page"><RetailHeader title="现金结算单" />{error ? <p className="error" role="alert">{error}</p> : !sale ? <p role="status">正在载入结算单…</p> : <><RetailReceipt sale={sale} /><RetailReceiptActions sale={sale} /></>}</main>
}
