import { useEffect,useMemo,useState } from 'react'
import { Link } from 'react-router-dom'
import { formatMalaysiaDate,formatWeightKg,type WeighingSession,type WeighingSessionStatus } from '../lib/weighing'
import { loadWeighingSessions } from '../services/weighing'

const STATUS_NAMES:Record<WeighingSessionStatus,string>={
  weighing:'称重中',completed:'已完成',processed:'已处理',voided:'已作废',
}

export function WeighingSessionsPage({loader=loadWeighingSessions}:{loader?:()=>Promise<WeighingSession[]>}){
  const [items,setItems]=useState<WeighingSession[]|null>(null)
  const [date,setDate]=useState(''),[vessel,setVessel]=useState(''),[status,setStatus]=useState('all')
  const [search,setSearch]=useState('')
  const [error,setError]=useState('')
  useEffect(()=>{loader().then(setItems).catch(()=>{setItems([]);setError('无法载入现场称重单。')})},[loader])
  const vessels=useMemo(()=>Array.from(new Map((items??[]).map(item=>[item.vesselId,item.vesselCodeSnapshot])).entries()),[items])
  const visible=useMemo(()=>(items??[]).filter(item=>
    (!date||item.weighingDate===date)&&(!vessel||item.vesselId===vessel)&&(status==='all'||item.status===status)
      &&`${item.sessionCode} ${item.externalSlipNo}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  ),[items,date,vessel,status,search])
  return <main className="weighing-admin-page"><header><p className="eyebrow">CCM Fishery</p><h1>现场称重单</h1>
    <Link className="page-link" to="/">← 返回主页</Link></header>
    <nav className="summary-nav"><Link className="primary-action summary-link" to="/weighing/new">开始现场称重</Link>
      <Link className="summary-link monthly" to="/purchases">采购与收货</Link></nav>
    <section className="weighing-filters">
      <label>日期<input type="date" value={date} onChange={event=>setDate(event.target.value)}/></label>
      <label>船号<select aria-label="船号" value={vessel} onChange={event=>setVessel(event.target.value)}>
        <option value="">全部</option>{vessels.map(([id,code])=><option key={id} value={id}>{code}</option>)}</select></label>
      <label>状态<select aria-label="状态" value={status} onChange={event=>setStatus(event.target.value)}>
        <option value="all">全部</option>{Object.entries(STATUS_NAMES).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
      <label className="weighing-search">单号搜索<input aria-label="手写单号或现场单号" value={search}
        placeholder="手写单号或现场单号" onChange={event=>setSearch(event.target.value)}/></label>
    </section>
    <section className="master-summary weighing-list-summary"><div><span>现场单</span><strong>{visible.length}</strong></div>
      <div><span>总重量</span><strong>{formatWeightKg(visible.reduce((sum,item)=>sum+item.totalWeightGrams,0))} kg</strong></div></section>
    {error&&<p className="error" role="alert">{error}</p>}
    {items===null?<p className="notice">正在载入现场称重单…</p>:<div className="weighing-session-list">
      {visible.map(item=><Link className="weighing-session-card" key={item.id} to={`/weighing/${item.id}/review`}>
        <div><small>{formatMalaysiaDate(item.weighingDate)} · {item.externalSlipNo||'没有手写单号'}</small>
          <strong>{item.sessionCode}</strong><span>{item.vesselNameSnapshot||item.vesselCodeSnapshot}</span>
          <span>鱼头 {item.fishHeadBasketCount} 篮 · {formatWeightKg(item.fishHeadWeightGrams)} kg</span>
          <span>鱼仔 {formatWeightKg(item.fishMealTotalWeightGrams)} kg</span></div>
        <div><span className={`record-status ${item.status}`}>{STATUS_NAMES[item.status]}</span>
          <strong>{item.fishHeadBasketCount+item.fishMealBucketBasketCount+item.fishMealBagBasketCount} 篮</strong>
          <b>{formatWeightKg(item.totalWeightGrams)} kg</b></div>
      </Link>)}
      {visible.length===0&&<p className="notice">没有符合条件的现场称重单。</p>}
    </div>}
  </main>
}
