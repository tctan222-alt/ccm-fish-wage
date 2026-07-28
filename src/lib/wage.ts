export const FIXED_RATE_CENTS = [12, 15, 18] as const
export function parseRateCents(value:string):number|null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null
  const cents=Math.round(Number(value)*100)
  return cents>=1 && cents<=999 ? cents : null
}
export function normalizeWeight(value:string):string {
  if (!/^\d*$/.test(value) || value==='') return value===''?'': '0'
  return String(Number(value))
}
export const validWeight=(value:string)=>/^\d+$/.test(value)&&Number(value)>=1&&Number(value)<=300
export const wageCents=(weightKg:number,rateCents:number)=>weightKg*rateCents
export const money=(cents:number)=>(cents/100).toFixed(2)
export function malaysiaDateKey(date=new Date()):string {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date)
  const get=(type:string)=>parts.find(p=>p.type===type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
