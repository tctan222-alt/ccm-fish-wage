import { FIXED_RATE_CENTS,rmStringToCents } from './wage'
import type { StoredWageEntry } from '../services/wages'

export type PaymentStatus='unpaid'|'partial'|'paid'

export interface RateBreakdown {
  rate12Cents:number
  rate15Cents:number
  rate18Cents:number
  customCents:number
}

export interface ClosingMonthSnapshot {
  monthKey:string
  status:'closed'
  closeVersion:number
  workerCount:number
  basketCount:number
  totalWeightKg:number
  totalWageCents:number
  paidCents:number
}

export interface ClosingStatementSnapshot {
  id:string
  monthKey:string
  closeVersion:number
  workerId:string
  workerName:string
  basketCount:number
  totalWeightKg:number
  wageCents:number
  paidCents:number
  rateBreakdown:RateBreakdown
}

export function paymentStatus(paidCents:number,wageCents:number):PaymentStatus {
  if(paidCents<=0)return 'unpaid'
  if(paidCents>=wageCents)return 'paid'
  return 'partial'
}

export function applyPayment(paidCents:number,amountCents:number,wageCents:number):number {
  if(!Number.isInteger(amountCents)||amountCents<=0)throw new Error('Payment must be greater than zero')
  if(paidCents+amountCents>wageCents)throw new Error('Payment exceeds the outstanding balance')
  return paidCents+amountCents
}

export function voidPaymentAmount(paidCents:number,amountCents:number):number {
  const next=paidCents-amountCents
  if(next<0)throw new Error('Payment total cannot go below zero')
  return next
}

export const canReopenMonth=(paidCents:number)=>paidCents===0

export function validateReopenReason(reason:string):string {
  const clean=reason.trim()
  if(clean.length<3||clean.length>100)throw new Error('Reopen reason must be 3 to 100 characters')
  return clean
}

export const nextCloseVersion=(month:{closeVersion:number}|null)=>month?month.closeVersion+1:1

interface ClosableMonth {
  status:'open'|'closed'
  closingToken?:string|null
  closingAt?:unknown
}

export function assertMonthCanClose(month:ClosableMonth|null,nowMs=Date.now()):void {
  if(month?.status==='closed')throw new Error('This month is already closed')
  const closingAt=month?.closingAt
  const lockIsStale=typeof closingAt==='object'&&closingAt!==null
    && 'toMillis' in closingAt&&typeof closingAt.toMillis==='function'
    && nowMs-closingAt.toMillis()>=5*60*1000
  if(month?.closingToken&&!lockIsStale)throw new Error('This month is already being closed')
}

function emptyBreakdown():RateBreakdown {
  return {rate12Cents:0,rate15Cents:0,rate18Cents:0,customCents:0}
}

export function buildClosingSnapshot(
  monthKey:string,
  closeVersion:number,
  sourceEntries:StoredWageEntry[],
):{month:ClosingMonthSnapshot;statements:ClosingStatementSnapshot[]} {
  const entries=sourceEntries.filter(entry=>entry.deleted!==true&&entry.dateKey.slice(0,7)===monthKey)
  if(entries.length===0)throw new Error('Cannot close a month with no active wage records')

  const grouped=new Map<string,ClosingStatementSnapshot>()
  for(const entry of entries){
    const key=entry.workerId||entry.workerName
    const statement=grouped.get(key)??{
      id:`${closeVersion}_${key}`,
      monthKey,
      closeVersion,
      workerId:entry.workerId,
      workerName:entry.workerName,
      basketCount:0,
      totalWeightKg:0,
      wageCents:0,
      paidCents:0,
      rateBreakdown:emptyBreakdown(),
    }
    const entryWageCents=rmStringToCents(entry.wageRm)
    const rateCents=rmStringToCents(entry.rateRm)
    statement.basketCount+=1
    statement.totalWeightKg+=entry.weightKg
    statement.wageCents+=entryWageCents
    if(rateCents===FIXED_RATE_CENTS[0])statement.rateBreakdown.rate12Cents+=entryWageCents
    else if(rateCents===FIXED_RATE_CENTS[1])statement.rateBreakdown.rate15Cents+=entryWageCents
    else if(rateCents===FIXED_RATE_CENTS[2])statement.rateBreakdown.rate18Cents+=entryWageCents
    else statement.rateBreakdown.customCents+=entryWageCents
    grouped.set(key,statement)
  }

  const statements=[...grouped.values()].sort((a,b)=>a.workerName.localeCompare(b.workerName))
  return {
    month:{
      monthKey,
      status:'closed',
      closeVersion,
      workerCount:statements.length,
      basketCount:entries.length,
      totalWeightKg:entries.reduce((sum,entry)=>sum+entry.weightKg,0),
      totalWageCents:statements.reduce((sum,statement)=>sum+statement.wageCents,0),
      paidCents:0,
    },
    statements,
  }
}
