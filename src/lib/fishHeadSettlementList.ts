import { assertBusinessDate,businessDateFromLegacy,formatAuditTimestamp,sortKeyFromBusinessDate } from './businessDate'
import type { WeighingSession,WeighingSessionStatus } from './weighing'

export const FISH_HEAD_SETTLEMENT_STATUS_NAMES:Record<WeighingSessionStatus,string>={
  weighing:'称重中',completed:'待结单',processed:'已结单',voided:'已作废',
}

const WEEKDAYS=['星期日 Sun','星期一 Mon','星期二 Tue','星期三 Wed','星期四 Thu','星期五 Fri','星期六 Sat']

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
