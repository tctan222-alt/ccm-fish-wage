import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { businessDateFromLegacy, legacyIsoDateFromBusinessDate } from '../lib/businessDate'
import { formatRetailDate } from '../lib/retailDate'
import { buildRetailDailyReport, retailTotalWeight, type RetailDailyReport } from '../lib/retailDailyReport'
import { retailMoney, retailToday } from '../lib/retailSales'
import { watchRetailSales, type RetailHistorySnapshot } from '../services/retailSales'
import { RetailReceipt } from '../components/RetailReceipt'
import './retailSales.css'

type DailyState = { date: string; snapshot?: RetailHistorySnapshot; error?: string }

export function RetailDailyPrintPage() {
  const [date, setDate] = useState(retailToday), [vessel, setVessel] = useState('all')
  const [mode, setMode] = useState<'invoices' | 'summary'>('summary'), [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<DailyState>({ date }), [printError, setPrintError] = useState('')
  useEffect(() => {
    let current = true
    setState({ date }); setPrintError('')
    if (!date) { setState({ date, error: '请选择有效业务日期。 Select a valid business date.' }); return }
    const fail = (problem: unknown) => { if (current) setState({ date, error: `无法载入当天全部销售，请重试。 Unable to load the full day. ${problem instanceof Error ? problem.message : ''}` }) }
    let stop = () => {}
    try { stop = watchRetailSales({ fromDate: date, toDate: date }, snapshot => { if (current) setState({ date, snapshot }) }, fail) }
    catch (problem) { fail(problem) }
    return () => { current = false; stop() }
  }, [date, attempt])
  // Do not reuse the previous date's rows during a new subscription or a failed read.
  const snapshot = state.date === date ? state.snapshot : undefined
  let report: RetailDailyReport | null = null, problem = state.date === date ? state.error ?? '' : ''
  try { if (snapshot) report = buildRetailDailyReport(snapshot.sales, date, vessel) }
  catch (error) { problem = error instanceof Error ? error.message : '无法生成正确汇总。 Unable to build report.' }
  const tooMany = (report?.invoiceCount ?? 0) > 1000
  const ready = !!report?.invoiceCount && !snapshot?.fromCache && !snapshot?.hasPendingWrites && !problem && !tooMany
  function print() {
    if (!ready) return
    setPrintError('')
    try { window.print() } catch { setPrintError('系统打印未能打开，请重试。 Unable to open print dialog.') }
  }
  return <main className="retail-page retail-daily-print"><header className="retail-no-print"><p className="eyebrow">门市 Retail</p><h1>当天销售批量打印 Daily Print</h1>
    <nav className="retail-nav"><Link to="/retail-sales">现金销售 Cash Sales</Link><Link to="/retail-sales/history">销售历史 Sales History</Link></nav></header>
    <section className="retail-no-print retail-daily-filters" aria-label="批量打印筛选 Print Filters"><label>销售日期 Print Date<input type="date" aria-label="销售日期 Print Date" value={date ? legacyIsoDateFromBusinessDate(date) : ''}
      onChange={event => setDate(event.target.value ? businessDateFromLegacy(event.target.value) : '')} /></label>
      <label>打印船号 Print Vessel<select aria-label="打印船号 Print Vessel" value={vessel} onChange={event => { setVessel(event.target.value); setPrintError('') }}><option value="all">全部船号 All Vessels</option>
        {report?.vessels.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        {vessel !== 'all' && !report?.vessels.some(item => item.key === vessel) && <option value={vessel}>所选船号（本日无销售）</option>}</select></label>
      <fieldset><legend>打印模式 Print Mode</legend><label><input type="radio" name="retail-print-mode" checked={mode === 'invoices'} onChange={() => setMode('invoices')} />当天全部销售单 All Invoices</label>
        <label><input type="radio" name="retail-print-mode" checked={mode === 'summary'} onChange={() => setMode('summary')} />当天销售总结 Daily Summary</label></fieldset>
      <button type="button" className="primary-action" disabled={!ready} onClick={print}>{mode === 'invoices' ? '打印全部单 Print All Invoices' : '打印总结 Print Summary'}</button>
      {problem && <><p role="alert" className="error">{problem}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重新载入 Retry</button></>}
      {!problem && !snapshot && <p role="status">正在载入当天全部销售… Loading all sales for this date…</p>}
      {snapshot?.fromCache && <p role="status">缓存尚未与服务器核对，暂不可打印。 Cached results are not yet verified with the server.</p>}
      {snapshot?.hasPendingWrites && <p role="status">尚有未确认保存的销售，暂不可打印。 Waiting for pending sales to be confirmed.</p>}
      {report && !report.invoiceCount && !snapshot?.fromCache && <p role="status">当天没有符合船号筛选的销售单。 No sales match this date and vessel.</p>}
      {tooMany && <p role="alert">超过1000单，未截断或打印部分记录；请按船号筛选后分批打印。 More than 1,000 invoices: choose a vessel before printing.</p>}
      {printError && <p role="alert">{printError}</p>}
    </section>
    {ready && report && <section className="retail-daily-report" aria-label="批量打印预览 Print Preview"><header><h2>{mode === 'invoices' ? '当天全部销售单' : '当天销售总结'}</h2>
      <p>日期 Date：{formatRetailDate(report.businessDate)}</p><p>船号筛选 Vessel：{report.vesselLabel}</p>
      <p>{report.invoiceCount} 单 Sales · {retailTotalWeight(report.totalWeightDeciKg)} kg · {retailMoney(report.totalAmountCents)}</p></header>
      {mode === 'invoices' ? report.sales.map(sale => <div className="retail-batch-invoice" key={sale.id}><RetailReceipt sale={sale} /></div>)
        : <table className="retail-daily-summary"><caption>按已保存船号汇总 Vessel Subtotals</caption><thead><tr><th scope="col">船号 Vessel</th><th scope="col">单据 Sales</th><th scope="col">重量 kg</th><th scope="col">销售金额 RM</th></tr></thead><tbody>
          {report.vesselTotals.map(total => <tr key={total.key}><th scope="row">{total.label}</th><td>{total.invoiceCount}</td><td>{retailTotalWeight(total.totalWeightDeciKg)}</td><td>{retailMoney(total.totalAmountCents)}</td></tr>)}
        </tbody><tfoot><tr><th scope="row">筛选范围合计 Filtered Total</th><td>{report.invoiceCount}</td><td>{retailTotalWeight(report.totalWeightDeciKg)}</td><td>{retailMoney(report.totalAmountCents)}</td></tr></tfoot></table>}
    </section>}
  </main>
}
