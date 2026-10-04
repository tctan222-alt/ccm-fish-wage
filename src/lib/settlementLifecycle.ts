export type SettlementStatus='settlement_draft'|'settlement_finalized'
export interface SettlementLifecycle {status:SettlementStatus;finalizedAt?:unknown;finalizedBy?:string}
export const SETTLEMENT_EDIT_WINDOW_MS=90*24*60*60*1000

export function settlementFinalizedTime(value:SettlementLifecycle):Date|null {
  const stamp=value.finalizedAt
  try{
    let millis:number
    if(stamp instanceof Date)millis=stamp.getTime()
    else if(stamp&&typeof stamp==='object'){
      const timestamp=stamp as {toMillis?:()=>number;seconds?:number;nanoseconds?:number}
      if(typeof timestamp.toMillis==='function')millis=timestamp.toMillis()
      else if(Number.isInteger(timestamp.seconds)&&Number.isInteger(timestamp.nanoseconds??0)
        &&(timestamp.nanoseconds??0)>=0&&(timestamp.nanoseconds??0)<1_000_000_000)millis=timestamp.seconds!*1000+(timestamp.nanoseconds??0)/1_000_000
      else return null
    }else return null
    return Number.isFinite(millis)?new Date(millis):null
  }catch{return null}
}
export function settlementEditDeadline(value:SettlementLifecycle):Date|null {
  const time=settlementFinalizedTime(value)
  return time?new Date(time.getTime()+SETTLEMENT_EDIT_WINDOW_MS):null
}
/** Display/preflight only. Firestore request.time remains the authority. */
export function canEditSettlement(value:SettlementLifecycle,now:Date=new Date()):boolean {
  if(value.status==='settlement_draft')return true
  const deadline=settlementEditDeadline(value)
  return deadline!==null&&now.getTime()<deadline.getTime()
}
