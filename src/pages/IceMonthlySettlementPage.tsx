import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { malaysiaBusinessDate, monthKeyFromBusinessDate } from '../lib/businessDate'
import { summarizeIceWorkMonth, type IceWorkMonthlySettlement } from '../lib/iceWork'
import { confirmIceWorkMonthlySettlement, createIceWorkMonthlySettlement, loadIceWorkRecords, loadIceWorkSettlement, reopenIceWorkMonthlySettlement, voidIceWorkMonthlySettlement } from '../services/iceWork'
import { loadVessels } from '../services/purchaseMasterData'

const money=(cents:number)=>`RM ${(cents/100).toFixed(2)}`
const statusText=(status:string)=>({draft:'草稿',confirmed:'已确认',reopened:'已重新打开',voided:'已作废'}[status]??status)
export function IceMonthlySettlementPage(){
  const {vesselId=''}=useParams(),[params]=useSearchParams(),monthKey=params.get('month')??monthKeyFromBusinessDate(malaysiaBusinessDate())
  const [state,setState]=useState<{settlement:IceWorkMonthlySettlement|null;summary:ReturnType<typeof summarizeIceWorkMonth>;code:string}|null>(null),[error,setError]=useState('')
  useEffect(()=>{void Promise.all([loadVessels(),loadIceWorkRecords(vesselId,monthKey),loadIceWorkSettlement(vesselId,monthKey)]).then(([vessels,records,settlement])=>{const vessel=vessels.find(item=>item.id===vesselId||item.vesselCode===vesselId);setState({settlement,summary:summarizeIceWorkMonth(records),code:vessel?.vesselCode??vesselId})}).catch(()=>setError('无法载入月结。'))},[vesselId,monthKey])
  const finalTotal=useMemo(()=>state?.settlement?.finalTotalCents??(state?.summary.recordsTotalCents??0)+75_000,[state])
  async function create(){if(!state)return;try{setState({...state,settlement:await createIceWorkMonthlySettlement(vesselId,state.code,monthKey)})}catch(problem){setError(problem instanceof Error?problem.message:'无法建立月结。')}}
  async function transition(kind:'confirm'|'reopen'|'void'){if(!state?.settlement)return;const reason=kind==='confirm'?null:window.prompt(kind==='reopen'?'请输入重新打开原因':'请输入作废原因')?.trim();if(kind!=='confirm'&&!reason)return;try{const settlement=kind==='confirm'?await confirmIceWorkMonthlySettlement(state.settlement):kind==='reopen'?await reopenIceWorkMonthlySettlement(state.settlement,reason!):await voidIceWorkMonthlySettlement(state.settlement,reason!);setState({...state,settlement})}catch(problem){setError(problem instanceof Error?problem.message:'无法更新月结。')}}
  return <main><header><p className="eyebrow">CCM Fishery</p><h1>冰工月结</h1><Link className="page-link" to={`/ice-department/${vesselId}`}>← 返回冰工记录</Link></header><p>船号：{state?.code??vesselId} · 月份：{monthKey}</p>{error&&<p className="error">{error}</p>}{state&&<section className="master-card"><p>有效确认记录：{state.summary.validRecordCount}</p><p>冰工工钱合计：{money(state.summary.workFeeSubtotalCents)}</p><p>材料费合计：{money(state.summary.materialSubtotalCents)}</p><p>单次记录总计：{money(state.summary.recordsTotalCents)}</p><p>船头费（每月一次）：RM 500.00</p><p>书记费（每月一次）：RM 250.00</p><h2>最终合计：{money(finalTotal)}</h2>{state.settlement?<><p>月结状态：{statusText(state.settlement.status)}</p><div className="master-actions">{(state.settlement.status==='draft'||state.settlement.status==='reopened')&&<button className="primary-action" onClick={()=>void transition('confirm')}>确认月结</button>}{state.settlement.status==='confirmed'&&<><button onClick={()=>void transition('reopen')}>重新打开</button><button className="danger-action" onClick={()=>void transition('void')}>作废月结</button></>}</div></>:<button className="primary-action" onClick={()=>void create()}>建立本月结算</button>}</section>}</main>
}
