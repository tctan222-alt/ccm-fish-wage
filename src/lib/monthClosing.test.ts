import { describe,expect,it } from 'vitest'
import type { StoredWageEntry } from '../services/wages'
import {
  applyPayment,
  assertMonthCanClose,
  buildClosingSnapshot,
  canReopenMonth,
  nextCloseVersion,
  paymentStatus,
  validateReopenReason,
  voidPaymentAmount,
} from './monthClosing'

const entries:StoredWageEntry[]=[
  {id:'e1',dateKey:'2026-07-01',workerId:'w1',workerName:'Ah Mei',weightKg:74,rateRm:'0.12',wageRm:'8.88',createdBy:'admin',deleted:false},
  {id:'e2',dateKey:'2026-07-02',workerId:'w1',workerName:'Ah Mei',weightKg:71,rateRm:'0.15',wageRm:'10.65',createdBy:'admin',deleted:false},
  {id:'e3',dateKey:'2026-07-02',workerId:'w2',workerName:'Ali',weightKg:80,rateRm:'0.18',wageRm:'14.40',createdBy:'admin',deleted:false},
  {id:'e4',dateKey:'2026-07-03',workerId:'w1',workerName:'Ah Mei',weightKg:60,rateRm:'0.20',wageRm:'12.00',createdBy:'admin',deleted:false},
  {id:'deleted',dateKey:'2026-07-04',workerId:'w2',workerName:'Ali',weightKg:100,rateRm:'0.18',wageRm:'18.00',createdBy:'admin',deleted:true},
]

describe('wage month closing',()=>{
  it('excludes deleted entries and calculates month totals in integer cents',()=>{
    const result=buildClosingSnapshot('2026-07',1,entries)
    expect(result.month).toMatchObject({
      monthKey:'2026-07',
      status:'closed',
      closeVersion:1,
      workerCount:2,
      basketCount:4,
      totalWeightKg:285,
      totalWageCents:4593,
      paidCents:0,
    })
  })

  it('creates one statement snapshot per worker',()=>{
    const result=buildClosingSnapshot('2026-07',1,entries)
    expect(result.statements.map(statement=>({
      id:statement.id,
      workerName:statement.workerName,
      basketCount:statement.basketCount,
      totalWeightKg:statement.totalWeightKg,
      wageCents:statement.wageCents,
    }))).toEqual([
      {id:'1_w1',workerName:'Ah Mei',basketCount:3,totalWeightKg:205,wageCents:3153},
      {id:'1_w2',workerName:'Ali',basketCount:1,totalWeightKg:80,wageCents:1440},
    ])
  })

  it('calculates fixed and custom rate breakdowns',()=>{
    const ahMei=buildClosingSnapshot('2026-07',1,entries).statements[0]
    expect(ahMei.rateBreakdown).toEqual({
      rate12Cents:888,
      rate15Cents:1065,
      rate18Cents:0,
      customCents:1200,
    })
  })

  it('rejects closing a month with no active wage records',()=>{
    expect(()=>buildClosingSnapshot('2026-07',1,[{...entries[0],deleted:true}])).toThrow('no active wage records')
  })

  it('increments closeVersion after reopen while starting a new month at one',()=>{
    expect(nextCloseVersion(null)).toBe(1)
    expect(nextCloseVersion({closeVersion:1})).toBe(2)
  })

  it('rejects repeated close but permits takeover of a stale closing lock',()=>{
    expect(()=>assertMonthCanClose({status:'closed'})).toThrow('already closed')
    expect(()=>assertMonthCanClose({
      status:'open',closingToken:'active',closingAt:{toMillis:()=>1_000},
    },1_000+4*60*1000)).toThrow('already being closed')
    expect(()=>assertMonthCanClose({
      status:'open',closingToken:'stale',closingAt:{toMillis:()=>1_000},
    },1_000+5*60*1000)).not.toThrow()
  })

  it.each([
    [0,1000,'unpaid'],
    [250,1000,'partial'],
    [1000,1000,'paid'],
  ] as const)('derives %s/%s as %s',(paid,wage,status)=>{
    expect(paymentStatus(paid,wage)).toBe(status)
  })

  it('accumulates partial payments using integer cents',()=>{
    expect(applyPayment(250,300,1000)).toBe(550)
  })

  it('rejects zero and overpayments',()=>{
    expect(()=>applyPayment(0,0,1000)).toThrow('greater than zero')
    expect(()=>applyPayment(800,300,1000)).toThrow('exceeds the outstanding balance')
  })

  it('subtracts a voided payment without going below zero',()=>{
    expect(voidPaymentAmount(550,300)).toBe(250)
    expect(()=>voidPaymentAmount(200,300)).toThrow('below zero')
  })

  it('blocks reopen while valid payments remain',()=>{
    expect(canReopenMonth(1)).toBe(false)
    expect(canReopenMonth(0)).toBe(true)
  })

  it('requires a reopen reason between 3 and 100 characters',()=>{
    expect(validateReopenReason('  correction needed  ')).toBe('correction needed')
    expect(()=>validateReopenReason('no')).toThrow('3 to 100')
    expect(()=>validateReopenReason('x'.repeat(101))).toThrow('3 to 100')
  })
})
