import { Timestamp } from 'firebase/firestore'
import { describe,expect,it } from 'vitest'
import { FISH_HEAD_SETTLEMENT_STATUS_NAMES,fishHeadSettlementDate,fishHeadSettlementPath,fishHeadSettlementSessions,fishHeadSettlementUpdatedTime } from './fishHeadSettlementList'
import type { WeighingSession } from './weighing'

function session(id:string,overrides:Partial<WeighingSession>={}):WeighingSession {
  return {
    id,sessionCode:`FH-833-20260908-${id}`,productType:'fish_head',weighingDate:'08/09/2026',monthKey:'09/2026',
    externalSlipNo:'',vesselId:'v833',vesselCodeSnapshot:'833',vesselNameSnapshot:'833',status:'completed',lastSequenceNo:2,
    fishHeadBasketCount:2,fishHeadWeightGrams:100000,fishMealBucketBasketCount:0,fishMealBucketWeightGrams:0,
    fishMealBagBasketCount:0,fishMealBagWeightGrams:0,fishMealTotalWeightGrams:0,totalWeightGrams:100000,
    processedReceiptId:null,processedReceiptCode:null,notes:'',revision:1,voidReason:null,...overrides,
  }
}

describe('fish-head settlement list',()=>{
  it('only lists explicit fish-head weighing, completed and processed sessions',()=>{
    const items=[session('completed'),session('weighing',{status:'weighing'}),session('processed',{status:'processed'}),
      session('voided',{status:'voided'}),session('meal',{productType:'fish_meal'}),session('legacy',{productType:undefined})]
    expect(fishHeadSettlementSessions(items).map(item=>item.id)).toEqual(['completed','processed','weighing'])
    expect(FISH_HEAD_SETTLEMENT_STATUS_NAMES).toEqual({weighing:'称重中',completed:'待结单',processed:'已结单',voided:'已作废'})
  })

  it('sorts canonical business dates first, supports legacy ISO and does not trust stale dateSortKey',()=>{
    const items=[session('old',{weighingDate:'07/09/2026',dateSortKey:20990101,updatedAt:new Date('2026-09-30T00:00:00Z')}),
      session('new',{weighingDate:'2026-09-09',updatedAt:new Date('2026-09-09T00:00:00Z')}),session('middle')]
    expect(fishHeadSettlementSessions(items).map(item=>item.id)).toEqual(['new','middle','old'])
  })

  it('preserves both same-vessel same-day sessions, ordered by their latest timestamp',()=>{
    const older=session('a',{updatedAt:Timestamp.fromDate(new Date('2026-09-08T03:00:00Z'))})
    const newer=session('b',{updatedAt:Timestamp.fromDate(new Date('2026-09-08T04:00:00Z'))})
    expect(fishHeadSettlementSessions([older,newer])).toEqual([newer,older])
  })

  it('keeps input order and every identity without collapsing duplicate vessel/date pairs',()=>{
    const first=session('b'),second=session('a')
    const items=[first,second]
    expect(fishHeadSettlementSessions(items)).toEqual([second,first])
    expect(items).toEqual([first,second])
  })

  it('falls back to createdAt when updatedAt is missing or invalid',()=>{
    const items=[session('missing',{createdAt:new Date('2026-09-08T01:00:00Z')}),
      session('invalid',{updatedAt:new Date('invalid'),createdAt:{toDate:()=>new Date('2026-09-08T02:00:00Z')}}),
      session('valid',{updatedAt:{toMillis:()=>new Date('2026-09-08T03:00:00Z').getTime()}})]
    expect(fishHeadSettlementSessions(items).map(item=>item.id)).toEqual(['valid','invalid','missing'])
  })

  it('orders Firestore serialized seconds and nanoseconds within the same second',()=>{
    const items=[session('earlier',{updatedAt:{seconds:1788836400,nanoseconds:200_000_000}}),
      session('later',{updatedAt:{seconds:1788836400,nanoseconds:900_000_000}})]
    expect(fishHeadSettlementSessions(items).map(item=>item.id)).toEqual(['later','earlier'])
  })

  it('uses id as a deterministic tie-break when audit timestamps are absent or equal',()=>{
    const value=Timestamp.fromMillis(1788836400000)
    expect(fishHeadSettlementSessions([session('z',{updatedAt:value}),session('a',{updatedAt:value})]).map(item=>item.id)).toEqual(['a','z'])
    expect(fishHeadSettlementSessions([session('z'),session('a')]).map(item=>item.id)).toEqual(['a','z'])
  })

  it.each([
    ['weighing','/weighing/session%20A%2FB'],
    ['completed','/fish-head-settlement/session%20A%2FB'],
    ['processed','/fish-head-settlement/session%20A%2FB'],
  ] as const)('routes %s to the selected existing session identity', (status,path)=>{
    expect(fishHeadSettlementPath({id:'session A/B',status})).toBe(path)
  })

  it.each([
    ['07/09/2026','星期一 Mon'],['08/09/2026','星期二 Tue'],['09/09/2026','星期三 Wed'],
    ['10/09/2026','星期四 Thu'],['11/09/2026','星期五 Fri'],['12/09/2026','星期六 Sat'],['13/09/2026','星期日 Sun'],
  ])('displays %s with the correct bilingual weekday independent of local offset',(date,weekday)=>{
    expect(fishHeadSettlementDate(date)).toBe(`${date} ${weekday}`)
  })

  it('normalizes legacy ISO and leap-day dates without a time-zone shift',()=>{
    expect(fishHeadSettlementDate('2026-09-08')).toBe('08/09/2026 星期二 Tue')
    expect(fishHeadSettlementDate('2028-02-29')).toBe('29/02/2028 星期二 Tue')
  })

  it.each([
    new Date('2026-09-07T16:30:00Z'),
    Timestamp.fromDate(new Date('2026-09-07T16:30:00Z')),
    {toDate:()=>new Date('2026-09-07T16:30:00Z')},
    {seconds:1788798600,nanoseconds:500_000_000},
  ])('formats supported timestamp shape in Malaysia time',updatedAt=>{
    expect(fishHeadSettlementUpdatedTime({updatedAt})).toBe('08/09/2026 00:30')
  })

  it.each([
    undefined,null,new Date('invalid'),{toMillis:()=>Infinity},{toDate:()=>new Date('invalid')},
    {seconds:NaN},{seconds:1788798600,nanoseconds:1_000_000_000},{toMillis:()=>{throw new Error('invalid timestamp')}},
  ])('handles unusable timestamps without throwing or inventing a time',updatedAt=>{
    expect(fishHeadSettlementUpdatedTime({updatedAt})).toBe('时间未记录')
    expect(fishHeadSettlementUpdatedTime({updatedAt,createdAt:new Date('2026-09-07T16:30:00Z')})).toBe('08/09/2026 00:30')
  })
})
