import { describe, expect, it } from 'vitest'
import { createIceWorkRecord, summarizeIceMonthEndFees } from './iceWork'

describe('冰工记录规则', () => {
  it('不根据未确认单位自动计算油工作金额', () => {
    const record=createIceWorkRecord({id:'ice-1',workDate:'2026-07-31',vesselId:'v978',vesselCodeSnapshot:'978',createdBy:'admin'})
    expect(record).toMatchObject({monthKey:'2026-07',oilWorkQuantity:0,oilWorkRateCents:null,oilWorkAmountCents:null,headmanFeeCents:0,clerkFeeCents:0,monthEndSettlement:false})
  })

  it('月尾船头费和书记费只计入标记的单一月尾结算记录', () => {
    const regular=createIceWorkRecord({id:'ice-a',workDate:'2026-07-30',vesselId:'v978',vesselCodeSnapshot:'978',createdBy:'admin'})
    const monthEnd=createIceWorkRecord({id:'ice-b',workDate:'2026-07-31',vesselId:'v978',vesselCodeSnapshot:'978',createdBy:'admin',monthEndSettlement:true})
    const duplicate=createIceWorkRecord({id:'ice-c',workDate:'2026-07-31',vesselId:'v978',vesselCodeSnapshot:'978',createdBy:'admin',monthEndSettlement:true})
    expect(summarizeIceMonthEndFees([regular,monthEnd,duplicate])).toEqual({headmanFeeCents:50_000,clerkFeeCents:25_000,recordId:'ice-b'})
  })
})
