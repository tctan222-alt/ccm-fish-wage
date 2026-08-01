import { describe, expect, it } from 'vitest'
import { createIceWorkRecord, createIceWorkSettlement, summarizeIceWorkMonth } from './iceWork'

describe('冰工记录规则', () => {
  it('使用新业务日期和确认的柴油单价', () => {
    const record=createIceWorkRecord({id:'ice-1',workDate:'31/07/2026',vesselId:'v978',vesselCodeSnapshot:'978',createdBy:'admin'})
    expect(record).toMatchObject({monthKey:'07/2026',dieselVolumeMilliliters:0,dieselRateCentsPerLiter:2,dieselAmountCents:0,workFeeSubtotalCents:0,materialSubtotalCents:0})
  })
  it('月尾船头费和书记费只属于一张独立月结', () => {
    const regular={...createIceWorkRecord({id:'ice-a',workDate:'30/07/2026',vesselId:'v978',vesselCodeSnapshot:'978',createdBy:'admin'}),status:'confirmed' as const}
    expect(summarizeIceWorkMonth([regular]).recordsTotalCents).toBe(0)
    expect(createIceWorkSettlement({vesselId:'v978',vesselCodeSnapshot:'978',monthKey:'07/2026',createdBy:'admin',records:[regular]})).toMatchObject({headmanFeeCents:50_000,clerkFeeCents:25_000})
  })
})
