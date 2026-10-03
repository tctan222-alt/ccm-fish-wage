import { useEffect,useMemo,useState } from 'react'
import { Link } from 'react-router-dom'
import { formatWeightKg,type WeighingSession } from '../lib/weighing'
import { FISH_HEAD_SETTLEMENT_STATUS_NAMES,fishHeadSettlementDate,fishHeadSettlementPath,fishHeadSettlementSessions,fishHeadSettlementUpdatedTime } from '../lib/fishHeadSettlementList'
import { loadWeighingSessions } from '../services/weighing'

export function FishHeadSettlementListPage({loader=loadWeighingSessions}:{loader?:()=>Promise<WeighingSession[]>}){
  const [items,setItems]=useState<WeighingSession[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [reload,setReload]=useState(0)
  useEffect(()=>{
    let cancelled=false
    setLoading(true);setError('')
    void (async()=>{
      const sessions=await loader()
      if(!cancelled)setItems(sessions)
    })().catch(problem=>{
      if(!cancelled)setError(`无法载入鱼头现场单：${problem instanceof Error?problem.message:'请稍后重试。'}`)
    }).finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[loader,reload])
  const visible=useMemo(()=>fishHeadSettlementSessions(items),[items])
  const pendingCount=visible.filter(item=>item.status==='completed').length
  return <main className="fish-head-settlement-list-page">
    <header><p className="eyebrow">CCM Fishery</p><h1>鱼头结单</h1>
      <Link className="page-link" to="/fish-head-purchase">← 返回现场录入</Link></header>
    <div className="settlement-list-heading"><h2>最近鱼头现场单</h2>
      <button type="button" disabled={loading} onClick={()=>setReload(current=>current+1)}>刷新</button></div>
    {loading?<p className="notice" role="status">正在载入鱼头现场单…</p>:error?
      <div className="settlement-list-error"><p className="error" role="alert">{error}</p>
        <button type="button" onClick={()=>setReload(current=>current+1)}>重试</button></div>:
      <>
        {pendingCount>0?<p className="settlement-pending-count" role="status">待结单 {pendingCount} 张</p>:
          <p className="notice">目前没有待结单鱼头现场单。</p>}
        <div className="settlement-session-list">{visible.map(item=>
          <article key={item.id} className={`settlement-session-card ${item.status}`} aria-label={`现场单 ${item.sessionCode}`}>
            <div className="settlement-session-heading"><strong>{fishHeadSettlementDate(item.weighingDate)}</strong>
              <span className={`settlement-session-status ${item.status}`}>{FISH_HEAD_SETTLEMENT_STATUS_NAMES[item.status]}</span></div>
            <h3>船号 {item.vesselCodeSnapshot}</h3>
            <p className="settlement-session-slip">手写单号：{item.externalSlipNo||'没有手写单号'}</p>
            <p className="settlement-session-code">现场单号：{item.sessionCode}</p>
            <div className="settlement-session-totals"><strong>{item.fishHeadBasketCount} 篮</strong><strong>{formatWeightKg(item.fishHeadWeightGrams)} kg</strong></div>
            <small className="settlement-session-time">更新 / 建立：{fishHeadSettlementUpdatedTime(item)}</small>
            <Link className="settlement-session-action" to={fishHeadSettlementPath(item)}>{item.status==='weighing'?'继续称重':'查看结单'}</Link>
          </article>)}</div>
      </>}
  </main>
}
