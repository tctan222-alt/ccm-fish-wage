import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { malaysiaBusinessDate, monthKeyFromBusinessDate } from '../lib/businessDate'
import { summarizeIceWorkMonth } from '../lib/iceWork'
import { loadIceWorkRecords } from '../services/iceWork'
import { loadVessels } from '../services/purchaseMasterData'

const money = (cents: number) => `RM ${(cents / 100).toFixed(2)}`

export function IceMonthlySettlementPage() {
  const { vesselId = '' } = useParams(), [params] = useSearchParams(), monthKey = params.get('month') ?? monthKeyFromBusinessDate(malaysiaBusinessDate())
  const [state, setState] = useState<{ code: string; summary: ReturnType<typeof summarizeIceWorkMonth> } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    void Promise.all([loadVessels(), loadIceWorkRecords(vesselId, monthKey)]).then(([vessels, records]) => {
      const vessel = vessels.find(item => item.id === vesselId || item.vesselCode === vesselId)
      setState({ code: vessel?.vesselCode ?? vesselId, summary: summarizeIceWorkMonth(records) })
    }).catch(() => setError('无法载入本月冰工统计，请重试。'))
  }, [vesselId, monthKey])
  const estimatedTotal = useMemo(() => (state?.summary.recordsTotalCents ?? 0) + 75_000, [state])
  return <main><header><p className="eyebrow">CCM Fishery</p><h1>冰工本月统计</h1><Link className="page-link" to={`/ice-department/${vesselId}`}>← 返回冰工记录</Link></header>
    <p>船号：{state?.code ?? vesselId} · 月份：{monthKey}</p>
    <p className="master-card">正式冰工月结暂未启用。目前可查看本月记录与统计，月尾结算将在电脑端处理。</p>
    {error && <p className="error">{error}</p>}
    {state && <section className="master-card"><p>预览统计，尚未正式月结</p><p>有效已确认记录：{state.summary.validRecordCount}</p>
      <p>木斑什金额：{money(state.summary.factoryIncomingAmountCents)}</p><p>冰箱子金额：{money(state.summary.iceBoxAmountCents)}</p><p>柴油金额：{money(state.summary.dieselAmountCents)}</p><p>卖给小贩金额：{money(state.summary.hawkerSaleAmountCents)}</p><p>直接买冰金额：{money(state.summary.directIceAmountCents)}</p><p>塑料袋金额：{money(state.summary.plasticBagAmountCents)}</p><p>冰工工钱小计：{money(state.summary.workFeeSubtotalCents)}</p><p>材料费小计：{money(state.summary.materialSubtotalCents)}</p><p>记录合计：{money(state.summary.recordsTotalCents)}</p><p>预计船头费（每月一次）：RM 500.00</p><p>预计书记费（每月一次）：RM 250.00</p><h2>预计总额：{money(estimatedTotal)}</h2></section>}
  </main>
}
