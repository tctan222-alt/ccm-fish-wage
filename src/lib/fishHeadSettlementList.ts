import { assertBusinessDate,businessDateFromLegacy,formatAuditTimestamp,legacyIsoDateFromBusinessDate,sortKeyFromBusinessDate } from './businessDate'
import type { WeighingSession,WeighingSessionStatus } from './weighing'

export const FISH_HEAD_SETTLEMENT_STATUS_NAMES:Record<WeighingSessionStatus,string>={
  weighing:'称重中',completed:'待结单',processed:'已结单',voided:'已作废',
}

const WEEKDAYS=['星期日 Sun','星期一 Mon','星期二 Tue','星期三 Wed','星期四 Thu','星期五 Fri','星期六 Sat']

export type FishHeadSettlementFilter={
  status:'completed'|'weighing'|'processed'|'all'
  mode:'all'|'today'|'week'|'month'|'custom'
  anchor:string
  start:string
  end:string
  vesselId:string
}

export function defaultFishHeadSettlementFilter(todayBusinessDate:string):FishHeadSettlementFilter {
  const today=legacyIsoDateFromBusinessDate(businessDateFromLegacy(todayBusinessDate))
  return {status:'completed',mode:'all',anchor:today,start:today,end:today,vesselId:''}
}

function validIsoDate(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false
  try{return legacyIsoDateFromBusinessDate(businessDateFromLegacy(value))===value}catch{return false}
}

export function fishHeadSettlementRange(filter:FishHeadSettlementFilter):{start:string;end:string;title:string}|null {
  if(filter.mode==='all')return null
  if(filter.mode==='custom'){
    if(!filter.start||!filter.end)throw new Error('请选择开始日期和结束日期。')
    if(!validIsoDate(filter.start)||!validIsoDate(filter.end))throw new Error('日期范围必须为有效日期。')
    if(filter.start>filter.end)throw new Error('开始日期不能晚于结束日期。')
    return {start:filter.start,end:filter.end,title:'自选日期 Custom Range'}
  }
  const anchor=legacyIsoDateFromBusinessDate(businessDateFromLegacy(filter.anchor))
  if(filter.mode==='week'){
    const date=new Date(`${anchor}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7)
    const start=date.toISOString().slice(0,10)
    date.setUTCDate(date.getUTCDate()+6)
    return {start,end:date.toISOString().slice(0,10),title:'周范围 Week'}
  }
  if(filter.mode==='month'){
    const {year,month}=assertBusinessDate(businessDateFromLegacy(anchor))
    return {start:new Date(Date.UTC(year,month-1,1)).toISOString().slice(0,10),
      end:new Date(Date.UTC(year,month,0)).toISOString().slice(0,10),title:`${year}年${month}月`}
  }
  return {start:anchor,end:anchor,title:'今天 Today'}
}

export function shiftFishHeadSettlementFilter(filter:FishHeadSettlementFilter,direction:-1|1):FishHeadSettlementFilter {
  if(filter.mode!=='week'&&filter.mode!=='month')return filter
  const date=new Date(`${legacyIsoDateFromBusinessDate(businessDateFromLegacy(filter.anchor))}T00:00:00Z`)
  if(filter.mode==='month'){
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth()+direction)
  }else date.setUTCDate(date.getUTCDate()+7*direction)
  return {...filter,anchor:date.toISOString().slice(0,10)}
}

export function parseFishHeadSettlementFilter(params:URLSearchParams,todayBusinessDate:string):FishHeadSettlementFilter {
  const defaults=defaultFishHeadSettlementFilter(todayBusinessDate)
  const status=params.get('status')
  const requestedMode=params.get('mode')
  const mode:FishHeadSettlementFilter['mode']=requestedMode==='today'||requestedMode==='week'||requestedMode==='month'||requestedMode==='custom'?requestedMode:'all'
  const anchor=params.get('anchor')??''
  const month=params.get('month')??''
  let parsedAnchor=validIsoDate(anchor)?anchor:defaults.anchor
  if(mode==='today')parsedAnchor=defaults.anchor
  else if(mode==='month'&&/^\d{4}-\d{2}$/.test(month)&&validIsoDate(`${month}-01`))parsedAnchor=`${month}-01`
  return {...defaults,
    status:status==='weighing'||status==='processed'||status==='all'?status:'completed',
    mode,anchor:parsedAnchor,
    start:params.get('start')??(mode==='custom'?'':defaults.start),end:params.get('end')??(mode==='custom'?'':defaults.end),
    vesselId:params.get('vessel')??'',
  }
}

export function fishHeadSettlementFilterParams(filter:FishHeadSettlementFilter):URLSearchParams {
  return new URLSearchParams({status:filter.status,mode:filter.mode,anchor:filter.anchor,
    start:filter.start,end:filter.end,vessel:filter.vesselId})
}

export function fishHeadSettlementVessels(items:WeighingSession[]):{id:string;label:string}[] {
  const vessels=new Map<string,{id:string;label:string}>()
  for(const session of fishHeadSettlementSessions(items)){
    if(!session.vesselId||vessels.has(session.vesselId))continue
    vessels.set(session.vesselId,{id:session.vesselId,
      label:session.vesselCodeSnapshot?.trim()||session.vesselNameSnapshot?.trim()||session.vesselId})
  }
  return [...vessels.values()].sort((a,b)=>a.label.localeCompare(b.label,'zh-Hans',{numeric:true})||a.id.localeCompare(b.id))
}

export function filterFishHeadSettlementSessions(items:WeighingSession[],filter:FishHeadSettlementFilter):WeighingSession[] {
  const range=fishHeadSettlementRange(filter)
  return fishHeadSettlementSessions(items).filter(item=>{
    if(filter.status!=='all'&&item.status!==filter.status)return false
    if(filter.vesselId&&item.vesselId!==filter.vesselId)return false
    if(!range)return true
    const date=legacyIsoDateFromBusinessDate(businessDateFromLegacy(item.weighingDate))
    return date>=range.start&&date<=range.end
  })
}

function timestampMillis(value:unknown):number|null {
  try{
    let millis:number
    if(value instanceof Date)millis=value.getTime()
    else if(value&&typeof value==='object'){
      const timestamp=value as {toMillis?:()=>number;toDate?:()=>Date;seconds?:number;nanoseconds?:number}
      if(typeof timestamp.toMillis==='function')millis=timestamp.toMillis()
      else if(typeof timestamp.toDate==='function')millis=timestamp.toDate().getTime()
      else if(typeof timestamp.seconds==='number'){
        const nanos=timestamp.nanoseconds??0
        if(!Number.isInteger(timestamp.seconds)||!Number.isInteger(nanos)||nanos<0||nanos>=1_000_000_000)return null
        millis=timestamp.seconds*1000+nanos/1_000_000
      }else return null
    }else return null
    return Number.isFinite(millis)&&Number.isFinite(new Date(millis).getTime())?millis:null
  }catch{return null}
}

function updatedMillis(session:Pick<WeighingSession,'updatedAt'|'createdAt'>){
  return timestampMillis(session.updatedAt)??timestampMillis(session.createdAt)
}

export function fishHeadSettlementSessions(items:WeighingSession[]):WeighingSession[]{
  return items.filter(item=>item.productType==='fish_head'
    &&(item.status==='weighing'||item.status==='completed'||item.status==='processed'))
    .sort((a,b)=>sortKeyFromBusinessDate(businessDateFromLegacy(b.weighingDate))-sortKeyFromBusinessDate(businessDateFromLegacy(a.weighingDate))
      ||(updatedMillis(b)??0)-(updatedMillis(a)??0)||a.id.localeCompare(b.id))
}

export function fishHeadSettlementPath(session:Pick<WeighingSession,'id'|'status'>):string {
  const id=encodeURIComponent(session.id)
  return session.status==='weighing'?`/weighing/${id}`:`/fish-head-settlement/${id}`
}

export function fishHeadSettlementDate(value:string):string {
  const canonical=businessDateFromLegacy(value)
  const {year,month,day}=assertBusinessDate(canonical)
  const weekday=new Date(Date.UTC(year,month-1,day)).getUTCDay()
  return `${canonical} ${WEEKDAYS[weekday]}`
}

export function fishHeadSettlementUpdatedTime(session:Pick<WeighingSession,'updatedAt'|'createdAt'>):string {
  const millis=updatedMillis(session)
  return millis===null?'时间未记录':formatAuditTimestamp(new Date(millis))
}
