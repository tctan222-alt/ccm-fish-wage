import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { malaysiaBusinessDate, monthKeyFromBusinessDate } from '../lib/businessDate'
import { summarizeIceWorkMonth, type IceWorkMonthlySettlement } from '../lib/iceWork'
import { checkIceWorkMonthlySettlementSource, confirmIceWorkMonthlySettlement, createIceWorkMonthlySettlement, loadIceWorkRecords, loadIceWorkSettlement, rebuildIceWorkMonthlySettlement, reopenIceWorkMonthlySettlement, voidIceWorkMonthlySettlement } from '../services/iceWork'
import { loadVessels } from '../services/purchaseMasterData'

const money = (cents: number) => `RM ${(cents / 100).toFixed(2)}`
const statusText = (status: string) => ({ draft: '草稿', confirmed: '已确认', reopened: '已重新打开', voided: '已作废' }[status] ?? status)
const newOperationId = () => globalThis.crypto?.randomUUID?.() ?? `ice-settlement-${Date.now()}-${Math.random().toString(36).slice(2)}`

export function IceMonthlySettlementPage() {
  const { vesselId = '' } = useParams(), [params] = useSearchParams(), monthKey = params.get('month') ?? monthKeyFromBusinessDate(malaysiaBusinessDate())
  const [state, setState] = useState<{ settlement: IceWorkMonthlySettlement | null; summary: ReturnType<typeof summarizeIceWorkMonth>; code: string } | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [sourceChanged, setSourceChanged] = useState(false)
  const pendingOperation = useRef<Record<string, string>>({})
  const operationFor = (key: string) => pendingOperation.current[key] ?? (pendingOperation.current[key] = newOperationId())
  const finishOperation = (key: string) => { delete pendingOperation.current[key] }
  const refresh = async () => {
    const [vessels, records, settlement] = await Promise.all([loadVessels(), loadIceWorkRecords(vesselId, monthKey), loadIceWorkSettlement(vesselId, monthKey)])
    const vessel = vessels.find(item => item.id === vesselId || item.vesselCode === vesselId)
    setState({ settlement, summary: summarizeIceWorkMonth(records), code: vessel?.vesselCode ?? vesselId })
    if (settlement?.status === 'confirmed') {
      const source = await checkIceWorkMonthlySettlementSource(settlement, operationFor('check-source'))
      finishOperation('check-source')
      setSourceChanged(source.sourceChanged)
    } else setSourceChanged(false)
  }
  useEffect(() => { void refresh().catch(() => setError('无法载入月结。')) }, [vesselId, monthKey])
  const finalTotal = useMemo(() => state?.settlement?.finalTotalCents ?? (state?.summary.recordsTotalCents ?? 0) + 75_000, [state])
  const run = async (key: string, action: () => Promise<IceWorkMonthlySettlement>) => {
    if (busy || !state) return
    setBusy(true); setError('')
    try { setState({ ...state, settlement: await action() }); await refresh() }
    catch (problem) { setError(problem instanceof Error ? problem.message : '服务器未能完成月结操作。') }
    finally { finishOperation(key); setBusy(false) }
  }
  const create = () => state && run('rebuild', () => createIceWorkMonthlySettlement(vesselId, state.code, monthKey, operationFor('rebuild')))
  const rebuild = () => state?.settlement && run('rebuild', () => rebuildIceWorkMonthlySettlement(state.settlement!, operationFor('rebuild')))
  const transition = (kind: 'confirm' | 'reopen' | 'void') => {
    if (!state?.settlement) return
    const reason = kind === 'confirm' ? null : window.prompt(kind === 'reopen' ? '请输入重新打开原因' : '请输入作废原因')?.trim()
    if (kind !== 'confirm' && !reason) return
    return run(kind, () => kind === 'confirm'
      ? confirmIceWorkMonthlySettlement(state.settlement!, operationFor(kind))
      : kind === 'reopen'
        ? reopenIceWorkMonthlySettlement(state.settlement!, reason!, operationFor(kind))
        : voidIceWorkMonthlySettlement(state.settlement!, reason!, operationFor(kind)))
  }
  return <main><header><p className="eyebrow">CCM Fishery</p><h1>冰工月结</h1><Link className="page-link" to={`/ice-department/${vesselId}`}>← 返回冰工记录</Link></header>
    <p>船号：{state?.code ?? vesselId} · 月份：{monthKey}</p>{error && <p className="error">{error}</p>}
    {state && <section className="master-card"><p>已确认记录（仅供预览）：{state.summary.validRecordCount}</p>
      <p>服务器月结来源记录：{state.settlement?.sourceRecordCount ?? '尚未计算'}</p>
      {sourceChanged && <p className="error">来源记录已发生变化。已确认月结保持不变；请先重新打开，再重新计算并确认。</p>}
      <p>冰工工钱合计：{money(state.settlement?.workFeeSubtotalCents ?? state.summary.workFeeSubtotalCents)}</p><p>材料费合计：{money(state.settlement?.materialSubtotalCents ?? state.summary.materialSubtotalCents)}</p><p>单次记录总计：{money(state.settlement?.recordsTotalCents ?? state.summary.recordsTotalCents)}</p><p>船头费（每月一次）：RM 500.00</p><p>书记费（每月一次）：RM 250.00</p><h2>最终合计：{money(finalTotal)}</h2>
      {busy && <p>正在由服务器计算月结，请稍候…</p>}
      {state.settlement ? <><p>月结状态：{statusText(state.settlement.status)}</p><div className="master-actions">
        {(state.settlement.status === 'draft' || state.settlement.status === 'reopened') && <><button disabled={busy} onClick={() => void rebuild()}>重新计算</button><button className="primary-action" disabled={busy} onClick={() => void transition('confirm')}>确认月结</button></>}
        {state.settlement.status === 'confirmed' && <><button disabled={busy} onClick={() => void transition('reopen')}>重新打开</button><button className="danger-action" disabled={busy} onClick={() => void transition('void')}>作废月结</button></>}
      </div></> : <button className="primary-action" disabled={busy} onClick={() => void create()}>计算本月结算</button>}</section>}
  </main>
}
