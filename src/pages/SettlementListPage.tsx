import { useEffect,useMemo,useRef,useState } from 'react'
import { Link,useSearchParams,useNavigationType } from 'react-router-dom'
import { businessDateFromLegacy,malaysiaBusinessDate } from '../lib/businessDate'
import { FISH_HEAD_SETTLEMENT_STATUS_NAMES,fishHeadSettlementDate,fishHeadSettlementFilterParams,fishHeadSettlementRange,parseFishHeadSettlementFilter,shiftFishHeadSettlementFilter,type FishHeadSettlementFilter } from '../lib/fishHeadSettlementList'
import { formatWeightKg } from '../lib/weighing'
import type { Vessel } from '../lib/purchasing'
import { money } from '../lib/wage'
import { loadVessels } from '../services/purchaseMasterData'
import { loadSettlementPage,type SettlementSearch,type SettlementPageLoader,type SettlementCursor,type SettlementSummary } from '../services/settlementSearch'

export interface SettlementListProps {
  productType:'fish_head'|'fish_meal'
  pageLoader?:SettlementPageLoader
  vesselLoader?:()=>Promise<Vessel[]>
  today?:()=>string
}
const STATUSES=[['all','全部 All'],['completed','称重已完成'],['weighing','称重中'],['processed','旧版采购单 Legacy processed']] as const
const MODES=[['today','今天 Today'],['week','按周 Week'],['month','按月 Month'],['custom','自订范围 Custom Range']] as const

export function SettlementListPage({productType,pageLoader=loadSettlementPage,vesselLoader=loadVessels,today=malaysiaBusinessDate}:SettlementListProps){
  const productName=productType==='fish_head'?'鱼头':'鱼仔'
  const [params,setParams]=useSearchParams()
  const navigationType=useNavigationType()
  const todayDate=useMemo(()=>today(),[today])
  const filter=useMemo(()=>{
    const parsed=parseFishHeadSettlementFilter(params,todayDate)
    if(!params.has('mode')||parsed.mode==='all')return {...parsed,mode:'date' as const,dateMode:'custom' as const,start:parsed.anchor.slice(0,7)+'-01',end:parsed.anchor,status:params.has('status')?parsed.status:'all' as const}
    return !params.has('status')&&(parsed.mode==='vessel'||parsed.mode==='date')?{...parsed,status:'all' as const}:parsed
  },[params,todayDate])
  const range=useMemo(()=>{try{return {value:fishHeadSettlementRange(filter),error:''}}catch(problem){return {value:null,error:problem instanceof Error?problem.message:'日期范围无效。'}}},[filter])
  const period=filter.mode==='date'?filter.dateMode:filter.mode
  const vesselMode=filter.mode==='vessel'
  const query=useMemo<SettlementSearch|null>(()=>vesselMode?(filter.vesselId?{mode:'vessel',productType,from:'',to:'',vesselId:filter.vesselId,status:filter.status}:null):
    range.value?{productType,from:range.value.start,to:range.value.end,vesselId:filter.vesselId,status:filter.status}:null,[vesselMode,filter.vesselId,filter.status,range.value,productType])
  const filterError=vesselMode&&!filter.vesselId?'请选择船号；按船号模式无需日期。':range.error
  const queryKey=JSON.stringify(query)
  const [applied,setApplied]=useState<{query:SettlementSearch|null;key:string}>({query,key:queryKey})
  const [reload,setReload]=useState(0)
  const [items,setItems]=useState<SettlementSummary[]>([])
  const [cursor,setCursor]=useState<SettlementCursor|null>(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [vessels,setVessels]=useState<Vessel[]>([])
  const [vesselError,setVesselError]=useState('')
  const [vesselReload,setVesselReload]=useState(0)
  const [moreLoading,setMoreLoading]=useState(false)
  const [moreError,setMoreError]=useState('')
  const generation=useRef(0)
  const moreLock=useRef(false)
  const update=(changes:Partial<FishHeadSettlementFilter>)=>setParams(fishHeadSettlementFilterParams({...filter,...changes}),{replace:true})
  const search=()=>{if(query){setApplied({query,key:queryKey});setReload(value=>value+1)}}
  useEffect(()=>{
    if(navigationType==='POP')setApplied(current=>current.key===queryKey?current:{query,key:queryKey})
  },[navigationType,query,queryKey])

  useEffect(()=>{
    let active=true
    setVesselError('')
    vesselLoader().then(result=>{if(active)setVessels(result)}).catch(()=>{if(active)setVesselError('无法载入船号资料，仍可查询全部船。请重试船号。')})
    return()=>{active=false}
  },[vesselLoader,vesselReload])
  useEffect(()=>{
    const current=++generation.current
    const controller=new AbortController()
    setItems([]);setCursor(null);setMoreError('');setMoreLoading(false);moreLock.current=false;setError('')
    if(!applied.query){setLoading(false);return()=>{generation.current=current+1;controller.abort()}}
    setLoading(true)
    const deadline=window.setTimeout(()=>{if(generation.current===current){controller.abort();setError('结单查询超时，请缩小日期范围或检查网络后重试。');setLoading(false)}},20_000)
    pageLoader({...applied.query,productType},null,controller.signal).then(page=>{if(generation.current===current&&!controller.signal.aborted){setItems(page.items);setCursor(page.cursor)}})
      .catch(problem=>{if(generation.current===current&&!controller.signal.aborted)setError(problem instanceof Error?problem.message:'无法载入结单，请重试。')})
      .finally(()=>{window.clearTimeout(deadline);if(generation.current===current)setLoading(false)})
    return()=>{generation.current=current+1;controller.abort();window.clearTimeout(deadline)}
  },[pageLoader,applied,reload,productType])

  async function loadMore(){
    if(!applied.query||!cursor||moreLock.current)return
    moreLock.current=true;setMoreLoading(true);setMoreError('')
    const current=generation.current,controller=new AbortController()
    let settled=false
    const deadline=window.setTimeout(()=>{
      if(!settled&&generation.current===current){controller.abort();moreLock.current=false;setMoreLoading(false);setMoreError('下一页载入超时，请重试。')}
    },20_000)
    try{
      const page=await pageLoader({...applied.query,productType},cursor,controller.signal)
      if(generation.current===current&&!controller.signal.aborted){
        setItems(previous=>[...previous,...page.items.filter(item=>!previous.some(old=>old.id===item.id))]);setCursor(page.cursor)
      }
    }catch(problem){if(generation.current===current&&!controller.signal.aborted)setMoreError(problem instanceof Error?problem.message:'无法载入下一页，请重试。')}
    finally{settled=true;window.clearTimeout(deadline);if(generation.current===current&&!controller.signal.aborted){moreLock.current=false;setMoreLoading(false)}}
  }
  const vesselChoices=useMemo(()=>{
    const choices=vessels.map(vessel=>({id:vessel.id,label:vessel.vesselCode+(vessel.active?'':'（历史船 Historical）')}))
    for(const item of items)if(!choices.some(vessel=>vessel.id===item.vesselId))choices.push({id:item.vesselId,label:item.vesselCodeSnapshot})
    return choices
  },[vessels,items])
  const showResults=applied.key===queryKey&&!filterError
  const returnPath=`/${productType==='fish_head'?'fish-head':'fish-meal'}-settlement?${fishHeadSettlementFilterParams(filter).toString()}`
  const lifecycleNames={draft:'草稿 Draft',finalized:'已完成 Finalized',locked:'已锁定 Locked（90 天期限已到）',pending:'待结单',legacy_processed:'旧版采购单 Legacy processed',weighing:'称重中'}
  return <main className="fish-head-settlement-list-page settlement-search-page">
    <header><p className="eyebrow">CCM Fishery</p><h1>{productName}结单</h1>
      <Link className="page-link" to={productType==='fish_head'?'/fish-head-purchase':'/fish-meal-purchase'}>← 返回现场录入</Link></header>
    <div className="settlement-list-heading"><h2>{productName}现场单</h2><button type="button" disabled={loading} onClick={()=>setReload(value=>value+1)}>刷新</button></div>
    <div className="settlement-list-filters">
      <fieldset className="settlement-filter-group"><legend>查询方式 Search Mode</legend><div className="settlement-filter-segments">
        <button type="button" aria-pressed={!vesselMode} onClick={()=>update({mode:'date',dateMode:period==='today'||period==='week'||period==='month'?period:'custom'})}>按日期 Date Range</button>
        <button type="button" aria-pressed={vesselMode} onClick={()=>update({mode:'vessel',dateMode:period==='today'||period==='week'||period==='month'?period:'custom'})}>按船号 Vessel</button>
      </div></fieldset>
      {!vesselMode&&<fieldset className="settlement-filter-group"><legend>日期范围 Date Range</legend>
        <div className="settlement-filter-segments">{MODES.map(([mode,label])=><button key={mode} type="button" aria-pressed={period===mode} onClick={()=>update({mode:'date',dateMode:mode})}>{label}</button>)}</div>
      </fieldset>
      }
      {!vesselMode&&(period==='week'||period==='month')?<div className="settlement-range-navigation">
        <button type="button" onClick={()=>setParams(fishHeadSettlementFilterParams(shiftFishHeadSettlementFilter(filter,-1)),{replace:true})}>{period==='week'?'上一周':'上一月'}</button>
        <button type="button" onClick={()=>setParams(fishHeadSettlementFilterParams(shiftFishHeadSettlementFilter(filter,1)),{replace:true})}>{period==='week'?'下一周':'下一月'}</button>
      </div>:null}
      {!vesselMode&&period==='month'&&<label>月份 Month<input type="month" value={filter.anchor.slice(0,7)} onChange={event=>{if(event.target.value)update({anchor:event.target.value+'-01'})}}/></label>}
      {!vesselMode&&period==='custom'&&<div className="settlement-filter-controls">
        <label>开始日期 Start Date<input type="date" required value={filter.start} onChange={event=>update({start:event.target.value})}/></label>
        <label>结束日期 End Date<input type="date" required value={filter.end} onChange={event=>update({end:event.target.value})}/></label>
      </div>}
      {range.value&&<p className="settlement-current-range">{businessDateFromLegacy(range.value.start)} – {businessDateFromLegacy(range.value.end)}</p>}
      <fieldset className="settlement-filter-group"><legend>称重来源状态 Source Status</legend><div className="settlement-filter-segments">{STATUSES.map(([status,label])=><button key={status} type="button" aria-pressed={filter.status===status} onClick={()=>update({status})}>{label}</button>)}</div></fieldset>
      <label className="settlement-vessel-filter">船号 Vessel<select value={filter.vesselId} onChange={event=>update({vesselId:event.target.value})}>
        <option value="">{vesselMode?'请选择船号 Select Vessel':'全部船 All Vessels'}</option>{vesselChoices.map(vessel=><option key={vessel.id} value={vessel.id}>{vessel.label}</option>)}
        {filter.vesselId&&!vesselChoices.some(vessel=>vessel.id===filter.vesselId)&&<option value={filter.vesselId}>{filter.vesselId}（历史船）</option>}
      </select></label>
      <button type="button" className="settlement-search-button" disabled={!query} onClick={search}>查询 Search</button>
      {vesselError&&<div><p className="error" role="alert">{vesselError}</p><button type="button" onClick={()=>setVesselReload(value=>value+1)}>重试船号</button></div>}
    </div>
    {filterError?<p className="error" role="alert">{filterError}</p>:!showResults?<p className="notice" role="status">筛选已更改，请按查询 Search。</p>:loading?<p className="notice" role="status">正在载入{productName}结单摘要…</p>:error?<div><p className="error" role="alert">{error}</p><button type="button" onClick={()=>setReload(value=>value+1)}>重试</button></div>:<>
      <p role="status">已载入 {items.length} 张 · {applied.query?.vesselId?'指定船':'全部船 All Vessels'}</p>
      {items.length===0&&<p className="notice">{cursor?'当前已查询部分暂无记录，请载入更多继续查询较早月份。':vesselMode?'这艘船没有'+productName+'结单。':'这个日期范围没有'+productName+'结单。'}</p>}
      <div className="settlement-session-list">{items.map(item=><article key={item.id} className="settlement-session-card" aria-label={`现场单 ${item.sessionCode}`}>
        <div className="settlement-session-heading"><strong>{fishHeadSettlementDate(item.weighingDate)}</strong><span>{item.settlementState?lifecycleNames[item.settlementState]:FISH_HEAD_SETTLEMENT_STATUS_NAMES[item.status]}</span></div>
        <h3>船号 Vessel {item.vesselCodeSnapshot}</h3><p>{productName} · 系统现场单号：{item.sessionCode}</p>
        <div className="settlement-session-totals"><strong>{item.basketCount} 篮</strong><strong>{formatWeightKg(item.weightGrams)} kg</strong><strong>{item.totalAmountCents===null?'RM —':`RM ${money(item.totalAmountCents)}`}</strong></div>
        <p>{item.processedReceiptId?'采购单号 Receipt No.':`${productName}纸单号 Paper Slip No.`}：{item.referenceNumber||'—'}</p>
        {item.totalAmountCents===null&&<small>未结价或旧草稿待核对；打开明细查看。 Amount pending verification.</small>}
        <Link className="settlement-session-action" to={item.status==='weighing'?`/weighing/${encodeURIComponent(item.id)}`:`/${productType==='fish_head'?'fish-head':'fish-meal'}-settlement/${encodeURIComponent(item.id)}?return=${encodeURIComponent(returnPath)}`}>{item.status==='weighing'?'继续称重':'查看结单'}</Link>
      </article>)}</div>
      {moreError&&<p className="error" role="alert">{moreError}</p>}
      {cursor&&<button type="button" disabled={moreLoading} onClick={()=>void loadMore()}>{moreLoading?'载入中…':'载入更多 Load More（25）'}</button>}
    </>}
  </main>
}
