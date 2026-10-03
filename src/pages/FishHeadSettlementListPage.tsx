import { useEffect,useMemo,useState } from 'react'
import { Link,useSearchParams } from 'react-router-dom'
import { businessDateFromLegacy,malaysiaBusinessDate } from '../lib/businessDate'
import { formatWeightKg,type WeighingSession } from '../lib/weighing'
import { FISH_HEAD_SETTLEMENT_STATUS_NAMES,defaultFishHeadSettlementFilter,filterFishHeadSettlementSessions,fishHeadSettlementDate,fishHeadSettlementFilterParams,fishHeadSettlementPath,fishHeadSettlementRange,fishHeadSettlementSessions,fishHeadSettlementUpdatedTime,fishHeadSettlementVessels,parseFishHeadSettlementFilter,shiftFishHeadSettlementFilter,type FishHeadSettlementFilter } from '../lib/fishHeadSettlementList'
import { loadWeighingSessions } from '../services/weighing'

const STATUS_FILTERS=[['completed','待结单'],['weighing','称重中'],['processed','已结单'],['all','全部']] as const
const DATE_FILTERS=[['all','全部日期'],['today','今天 Today'],['week','按周 Week'],['month','按月 Month'],['custom','自订范围 Custom Range']] as const

export function FishHeadSettlementListPage({loader=loadWeighingSessions,today=malaysiaBusinessDate}:{loader?:()=>Promise<WeighingSession[]>;today?:()=>string}){
  const [items,setItems]=useState<WeighingSession[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [reload,setReload]=useState(0)
  const [params,setParams]=useSearchParams()
  const todayDate=useMemo(()=>today(),[today])
  const filter=useMemo(()=>parseFishHeadSettlementFilter(params,todayDate),[params,todayDate])
  const updateFilter=(changes:Partial<FishHeadSettlementFilter>)=>setParams(fishHeadSettlementFilterParams({...filter,...changes}),{replace:true})
  useEffect(()=>{
    let cancelled=false
    setLoading(true);setError('');setItems([])
    void (async()=>{
      const sessions=await loader()
      if(!cancelled)setItems(sessions)
    })().catch(problem=>{
      if(!cancelled)setError(`无法载入鱼头现场单：${problem instanceof Error?problem.message:'请稍后重试。'}`)
    }).finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[loader,reload])
  const sessions=useMemo(()=>fishHeadSettlementSessions(items),[items])
  const vessels=useMemo(()=>fishHeadSettlementVessels(items),[items])
  const result=useMemo(()=>{
    try{return {visible:filterFishHeadSettlementSessions(items,filter),range:fishHeadSettlementRange(filter),error:''}}
    catch(problem){return {visible:[],range:null,error:problem instanceof Error?problem.message:'日期范围无效，请重新选择。'}}
  },[items,filter])
  const pendingCount=sessions.filter(item=>item.status==='completed').length
  const defaultPending=filter.status==='completed'&&filter.mode==='all'&&!filter.vesselId
  const chooseMode=(mode:FishHeadSettlementFilter['mode'])=>updateFilter({mode,...(mode==='today'||mode==='week'||mode==='month'?{anchor:defaultFishHeadSettlementFilter(todayDate).anchor}:{})})
  return <main className="fish-head-settlement-list-page">
    <header><p className="eyebrow">CCM Fishery</p><h1>鱼头结单</h1>
      <Link className="page-link" to="/fish-head-purchase">← 返回现场录入</Link></header>
    <div className="settlement-list-heading"><h2>鱼头现场单</h2>
      <button type="button" disabled={loading} onClick={()=>setReload(current=>current+1)}>刷新</button></div>
    <div className="settlement-list-filters">
      <fieldset className="settlement-filter-group"><legend>状态 Status</legend>
        <div className="settlement-filter-segments">{STATUS_FILTERS.map(([status,label])=>
          <button key={status} type="button" aria-pressed={filter.status===status} onClick={()=>updateFilter({status})}>{label}</button>)}</div>
      </fieldset>
      <fieldset className="settlement-filter-group"><legend>日期范围 Date Range</legend>
        <div className="settlement-filter-segments settlement-date-segments">{DATE_FILTERS.map(([mode,label])=>
          <button key={mode} type="button" aria-pressed={filter.mode===mode} onClick={()=>chooseMode(mode)}>{label}</button>)}</div>
      </fieldset>
      {filter.mode==='week'||filter.mode==='month'?<div className="settlement-range-navigation">
        <button type="button" onClick={()=>setParams(fishHeadSettlementFilterParams(shiftFishHeadSettlementFilter(filter,-1)),{replace:true})}>{filter.mode==='week'?'上一周':'上一月'}</button>
        <button type="button" onClick={()=>setParams(fishHeadSettlementFilterParams(shiftFishHeadSettlementFilter(filter,1)),{replace:true})}>{filter.mode==='week'?'下一周':'下一月'}</button>
      </div>:null}
      {filter.mode==='month'?<div className="settlement-filter-controls"><label className="settlement-month-control">月份 Month
        <input type="month" value={filter.anchor.slice(0,7)} onChange={event=>{if(event.target.value)updateFilter({anchor:`${event.target.value}-01`})}}/>
      </label></div>:null}
      {filter.mode==='custom'?<div className="settlement-filter-controls">
        <label>开始日期 Start Date<input type="date" required value={filter.start} onChange={event=>updateFilter({start:event.target.value})}/></label>
        <label>结束日期 End Date<input type="date" required value={filter.end} onChange={event=>updateFilter({end:event.target.value})}/></label>
      </div>:null}
      <p className="settlement-current-range">{result.range?<><strong>{result.range.title}</strong>{businessDateFromLegacy(result.range.start)} – {businessDateFromLegacy(result.range.end)}</>:filter.mode==='all'?(filter.status==='completed'?'全部日期 · 包含较早的待结单':'全部日期 All Dates'):result.error?'请修正日期范围。':''}</p>
      <label className="settlement-vessel-filter">船号 Vessel<select value={filter.vesselId} onChange={event=>updateFilter({vesselId:event.target.value})}>
        <option value="">全部船</option>{vessels.map(vessel=><option key={vessel.id} value={vessel.id}>{vessel.label}</option>)}
        {filter.vesselId&&!vessels.some(vessel=>vessel.id===filter.vesselId)?<option value={filter.vesselId}>{filter.vesselId}（当前没有现场单）</option>:null}
      </select></label>
    </div>
    {loading?<p className="notice" role="status">正在载入鱼头现场单…</p>:error?
      <div className="settlement-list-error"><p className="error" role="alert">{error}</p>
        <button type="button" onClick={()=>setReload(current=>current+1)}>重试</button></div>:result.error?
      <p className="error" role="alert">{result.error}</p>:
      <>
        <p className="settlement-status-counts" role="status"><span>待结单 {pendingCount} 张</span>
          <span>称重中 {sessions.filter(item=>item.status==='weighing').length} 张</span>
          <span>已结单 {sessions.filter(item=>item.status==='processed').length} 张</span></p>
        {result.visible.length===0?<p className="notice">{defaultPending?'目前没有待结单鱼头现场单。':'这个筛选范围没有鱼头现场单。'}</p>:null}
        <div className="settlement-session-list">{result.visible.map(item=>
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
