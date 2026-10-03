import { Timestamp } from 'firebase/firestore'
import { describe,expect,it } from 'vitest'
import { FISH_HEAD_SETTLEMENT_STATUS_NAMES,fishHeadSettlementDate,fishHeadSettlementPath,fishHeadSettlementSessions,fishHeadSettlementUpdatedTime } from './fishHeadSettlementList'
import { defaultFishHeadSettlementFilter,filterFishHeadSettlementSessions,fishHeadSettlementRange,shiftFishHeadSettlementFilter,
  parseFishHeadSettlementFilter,fishHeadSettlementFilterParams,fishHeadSettlementVessels } from './fishHeadSettlementList'
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
  it('defaults to all pending dates so an old completed session remains discoverable',()=>{
    const filter=defaultFishHeadSettlementFilter('03/10/2026')
    const items=[session('old-pending',{weighingDate:'20/09/2026'}),session('today',{weighingDate:'03/10/2026'}),
      session('processed',{status:'processed'}),session('weighing',{status:'weighing'})]
    expect(filter).toEqual({status:'completed',mode:'all',anchor:'2026-10-03',start:'2026-10-03',end:'2026-10-03',vesselId:''})
    expect(filterFishHeadSettlementSessions(items,filter).map(item=>item.id)).toEqual(['today','old-pending'])
  })

  it('Today includes only the selected business day, not a stale dateSortKey',()=>{
    const filter={...defaultFishHeadSettlementFilter('03/10/2026'),mode:'today' as const}
    expect(fishHeadSettlementRange(filter)).toEqual({start:'2026-10-03',end:'2026-10-03',title:'今天 Today'})
    const items=[session('yesterday',{weighingDate:'02/10/2026',dateSortKey:20261003}),
      session('today',{weighingDate:'2026-10-03',dateSortKey:19990101}),session('tomorrow',{weighingDate:'04/10/2026'})]
    expect(filterFishHeadSettlementSessions(items,filter).map(item=>item.id)).toEqual(['today'])
    expect(fishHeadSettlementRange(defaultFishHeadSettlementFilter('03/10/2026'))).toBeNull()
  })

  it('uses Monday through Sunday inclusive, with previous and next weeks across a month boundary',()=>{
    const filter={...defaultFishHeadSettlementFilter('03/10/2026'),mode:'week' as const}
    expect(fishHeadSettlementRange(filter)).toEqual({start:'2026-09-28',end:'2026-10-04',title:'周范围 Week'})
    expect(fishHeadSettlementRange(shiftFishHeadSettlementFilter(filter,-1))).toEqual({start:'2026-09-21',end:'2026-09-27',title:'周范围 Week'})
    expect(fishHeadSettlementRange(shiftFishHeadSettlementFilter(filter,1))).toEqual({start:'2026-10-05',end:'2026-10-11',title:'周范围 Week'})
    const items=[session('before',{weighingDate:'27/09/2026'}),session('monday',{weighingDate:'28/09/2026'}),
      session('sunday',{weighingDate:'04/10/2026'}),session('after',{weighingDate:'05/10/2026'})]
    expect(filterFishHeadSettlementSessions(items,filter).map(item=>item.id)).toEqual(['sunday','monday'])
  })

  it('shows a whole month with previous and next navigation, including December to January',()=>{
    const filter={...defaultFishHeadSettlementFilter('31/12/2026'),mode:'month' as const}
    expect(fishHeadSettlementRange(filter)).toEqual({start:'2026-12-01',end:'2026-12-31',title:'2026年12月'})
    expect(fishHeadSettlementRange(shiftFishHeadSettlementFilter(filter,-1))).toEqual({start:'2026-11-01',end:'2026-11-30',title:'2026年11月'})
    expect(fishHeadSettlementRange(shiftFishHeadSettlementFilter(filter,1))).toEqual({start:'2027-01-01',end:'2027-01-31',title:'2027年1月'})
    const items=[session('before',{weighingDate:'30/11/2026'}),session('first',{weighingDate:'01/12/2026'}),
      session('last',{weighingDate:'31/12/2026'}),session('after',{weighingDate:'01/01/2027'})]
    expect(filterFishHeadSettlementSessions(items,filter).map(item=>item.id)).toEqual(['last','first'])
  })

  it('Custom Range includes both boundaries without converting invalid input into all dates',()=>{
    const filter={...defaultFishHeadSettlementFilter('03/10/2026'),mode:'custom' as const,start:'2026-09-20',end:'2026-10-03'}
    expect(fishHeadSettlementRange(filter)).toEqual({start:'2026-09-20',end:'2026-10-03',title:'自选日期 Custom Range'})
    const items=[session('before',{weighingDate:'19/09/2026'}),session('first',{weighingDate:'20/09/2026'}),
      session('last',{weighingDate:'03/10/2026'}),session('after',{weighingDate:'04/10/2026'})]
    expect(filterFishHeadSettlementSessions(items,filter).map(item=>item.id)).toEqual(['last','first'])
  })

  it.each([
    ['','2026-10-03','请选择开始日期和结束日期。'],
    ['2026-10-03','','请选择开始日期和结束日期。'],
    ['2026-10-04','2026-10-03','开始日期不能晚于结束日期。'],
    ['2026-02-30','2026-10-03','日期范围必须为有效日期。'],
    ['03/10/2026','2026-10-03','日期范围必须为有效日期。'],
  ])('rejects invalid custom range %s through %s instead of showing misleading results',(start,end,error)=>{
    const filter={...defaultFishHeadSettlementFilter('03/10/2026'),mode:'custom' as const,start,end}
    expect(()=>fishHeadSettlementRange(filter)).toThrow(error)
    expect(()=>filterFishHeadSettlementSessions([session('record')],filter)).toThrow(error)
  })

  it('restores a valid month + vessel + status filter from the URL after refresh',()=>{
    const parsed=parseFishHeadSettlementFilter(new URLSearchParams('status=processed&mode=month&month=2026-10&vessel=v833'),'03/10/2026')
    expect(parsed).toEqual({status:'processed',mode:'month',anchor:'2026-10-01',start:'2026-10-03',end:'2026-10-03',vesselId:'v833'})
    expect(parseFishHeadSettlementFilter(fishHeadSettlementFilterParams(parsed),'03/10/2026')).toEqual(parsed)
    expect(fishHeadSettlementRange(parsed)).toEqual({start:'2026-10-01',end:'2026-10-31',title:'2026年10月'})
  })

  it('Today refresh uses the current Malaysian business day instead of a stale URL anchor',()=>{
    const parsed=parseFishHeadSettlementFilter(new URLSearchParams('mode=today&anchor=2026-10-02'),'03/10/2026')
    expect(fishHeadSettlementRange(parsed)).toEqual({start:'2026-10-03',end:'2026-10-03',title:'今天 Today'})
  })

  it.each(['mode=custom','mode=custom&start=invalid&end=2026-10-03','mode=custom&start=2026-10-04&end=2026-10-03'])(
    'preserves invalid custom URL inputs so validation prevents a misleading result: %s',query=>{
      const parsed=parseFishHeadSettlementFilter(new URLSearchParams(query),'03/10/2026')
      expect(parsed.mode).toBe('custom')
      expect(()=>fishHeadSettlementRange(parsed)).toThrow()
    })

  it('retains historical vessel options from valid fish-head sessions using the newest snapshot',()=>{
    const items=[session('older-label',{weighingDate:'08/09/2026',vesselCodeSnapshot:'old 833'}),
      session('new-label',{weighingDate:'02/10/2026',vesselCodeSnapshot:'833'}),
      session('historic-inactive',{weighingDate:'01/01/2025',vesselId:'historic',vesselCodeSnapshot:'978'}),
      session('voided',{status:'voided',vesselId:'voided-vessel'}),
      session('meal',{productType:'fish_meal',vesselId:'meal-vessel'})]
    expect(fishHeadSettlementVessels(items)).toEqual([{id:'v833',label:'833'},{id:'historic',label:'978'}])
    expect(filterFishHeadSettlementSessions(items,{...defaultFishHeadSettlementFilter('03/10/2026'),vesselId:'historic'})
      .map(item=>item.id)).toEqual(['historic-inactive'])
  })

  it.each([
    ['29/02/2028','2028-02-01','2028-02-29','2028年2月'],
    ['28/02/2027','2027-02-01','2027-02-28','2027年2月'],
  ])('uses the real last February day for %s',(date,start,end,title)=>{
    const filter={...defaultFishHeadSettlementFilter(date),mode:'month' as const}
    expect(fishHeadSettlementRange(filter)).toEqual({start,end,title})
  })

  it.each([
    ['04/10/2026','2026-09-28','2026-10-04'],
    ['05/10/2026','2026-10-05','2026-10-11'],
  ])('keeps %s in its Monday-Sunday business week',(date,start,end)=>{
    expect(fishHeadSettlementRange({...defaultFishHeadSettlementFilter(date),mode:'week'}))
      .toEqual({start,end,title:'周范围 Week'})
  })

  it.each([
    ['completed',['completed']],['weighing',['weighing']],['processed',['processed']],
    ['all',['completed','processed','weighing']],
  ] as const)('filters %s while always hiding voided and other product types',(status,ids)=>{
    const items=[session('completed'),session('weighing',{status:'weighing'}),session('processed',{status:'processed'}),
      session('voided',{status:'voided'}),session('meal',{productType:'fish_meal'})]
    expect(filterFishHeadSettlementSessions(items,{...defaultFishHeadSettlementFilter('03/10/2026'),status})
      .map(item=>item.id)).toEqual(ids)
  })

  it('combines month, vessel identity and processed status without confusing equal vessel labels',()=>{
    const filter={...defaultFishHeadSettlementFilter('03/10/2026'),mode:'month' as const,status:'processed' as const,vesselId:'v833'}
    const items=[session('match',{weighingDate:'31/10/2026',status:'processed'}),
      session('outside',{weighingDate:'30/09/2026',status:'processed'}),
      session('pending',{weighingDate:'03/10/2026'}),
      session('other-vessel',{weighingDate:'03/10/2026',status:'processed',vesselId:'v978',vesselCodeSnapshot:'833'})]
    expect(filterFishHeadSettlementSessions(items,filter).map(item=>item.id)).toEqual(['match'])
  })

  it('combines Custom Range + vessel + pending and preserves every same-day session with deterministic ordering',()=>{
    const filter={...defaultFishHeadSettlementFilter('03/10/2026'),mode:'custom' as const,vesselId:'v978',start:'2026-09-20',end:'2026-10-03'}
    const items=[session('older',{weighingDate:'20/09/2026',vesselId:'v978'}),
      session('z',{weighingDate:'03/10/2026',vesselId:'v978'}),session('a',{weighingDate:'03/10/2026',vesselId:'v978'}),
      session('newest',{weighingDate:'03/10/2026',vesselId:'v978',updatedAt:Timestamp.fromMillis(1790992800000)}),
      session('other-vessel',{weighingDate:'03/10/2026'}),session('processed',{weighingDate:'03/10/2026',vesselId:'v978',status:'processed'}),
      session('outside',{weighingDate:'04/10/2026',vesselId:'v978'})]
    expect(filterFishHeadSettlementSessions(items,filter).map(item=>item.id)).toEqual(['newest','a','z','older'])
    expect(items.map(item=>item.id)).toEqual(['older','z','a','newest','other-vessel','processed','outside'])
  })

  it('validates unknown URL mode/status/anchor/month while preserving exact vessel identity',()=>{
    const defaults=defaultFishHeadSettlementFilter('03/10/2026')
    expect(parseFishHeadSettlementFilter(new URLSearchParams('status=voided&mode=bogus&anchor=2026-02-30'),'03/10/2026'))
      .toEqual(defaults)
    const parsed=parseFishHeadSettlementFilter(new URLSearchParams('mode=month&month=2026-13&anchor=not-a-date&vessel=historical-978'),'03/10/2026')
    expect(parsed).toEqual({...defaults,mode:'month',vesselId:'historical-978'})
    expect(fishHeadSettlementRange(parsed)).toEqual({start:'2026-10-01',end:'2026-10-31',title:'2026年10月'})
  })

  it.each([
    'status=all&mode=week&anchor=2026-09-29&vessel=historic',
    'status=weighing&mode=custom&start=2026-09-01&end=2026-10-03&vessel=historic',
  ])('preserves non-month filters through URL serialization: %s',query=>{
    const filter=parseFishHeadSettlementFilter(new URLSearchParams(query),'03/10/2026')
    expect(parseFishHeadSettlementFilter(fishHeadSettlementFilterParams(filter),'03/10/2026')).toEqual(filter)
  })

  it('uses a name or id when vessel code snapshots are absent, with deterministic newest same-day labels',()=>{
    const items=[session('old',{vesselCodeSnapshot:'old',updatedAt:Timestamp.fromMillis(1)}),
      session('new',{vesselCodeSnapshot:'833',updatedAt:Timestamp.fromMillis(2)}),
      session('named',{vesselId:'named',vesselCodeSnapshot:'',vesselNameSnapshot:'Legacy Vessel'}),
      session('id',{vesselId:'historic',vesselCodeSnapshot:'',vesselNameSnapshot:''}),session('blank',{vesselId:''})]
    expect(fishHeadSettlementVessels(items)).toEqual([
      {id:'v833',label:'833'},{id:'historic',label:'historic'},{id:'named',label:'Legacy Vessel'},
    ])
  })

  it('allows a single-day Custom Range and does not navigate non-week/non-month modes',()=>{
    const filter={...defaultFishHeadSettlementFilter('03/10/2026'),mode:'custom' as const}
    expect(fishHeadSettlementRange(filter)).toEqual({start:'2026-10-03',end:'2026-10-03',title:'自选日期 Custom Range'})
    expect(shiftFishHeadSettlementFilter(filter,1)).toEqual(filter)
  })

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
