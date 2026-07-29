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
export function rmStringToCents(value:string):number {
  const match=/^(\d+)(?:\.(\d{1,2}))?$/.exec(value)
  if(!match)return 0
  return Number(match[1])*100+Number((match[2]??'').padEnd(2,'0'))
}
export function malaysiaDateKey(date=new Date()):string {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date)
  const get=(type:string)=>parts.find(p=>p.type===type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
export const monthKeyFromDateKey=(dateKey:string)=>dateKey.slice(0,7)
export function malaysiaMonthKey(date=new Date()):string {
  return monthKeyFromDateKey(malaysiaDateKey(date))
}
export function monthDateRange(monthKey:string):{startDateKey:string;endDateKey:string} {
  const match=/^(\d{4})-(\d{2})$/.exec(monthKey)
  if(!match)return {startDateKey:'',endDateKey:''}
  const yearValue=Number(match[1])
  const monthValue=Number(match[2])
  if(monthValue<1||monthValue>12)return {startDateKey:'',endDateKey:''}
  const lastDay=new Date(Date.UTC(yearValue,monthValue,0)).getUTCDate()
  return {
    startDateKey:`${monthKey}-01`,
    endDateKey:`${monthKey}-${String(lastDay).padStart(2,'0')}`,
  }
}
