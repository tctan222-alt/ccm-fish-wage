import { describe, expect, it } from 'vitest'
import { iceWorkRecordFromStored } from './iceWork'

describe('legacy ice-work records', () => {
  it('preserves historical quantities, status and audit fields without guessing a new calculation', () => {
    const record = iceWorkRecordFromStored('legacy-1', {
      workDate: '2026-07-31', monthKey: '2026-07', vesselId: 'v978', vesselCodeSnapshot: '978',
      factoryWoodTubQuantity: 18, iceBoxQuantity: 4, hawkerSaleQuantity: 6, oilWorkQuantity: 3,
      oilWorkRateCents: 2, oilWorkAmountCents: 6, headmanFeeCents: 50_000, clerkFeeCents: 25_000,
      notes: '历史资料', status: 'confirmed', voided: false, voidReason: null, createdBy: 'u1', updatedBy: 'u2', monthEndSettlement: true,
    })

    expect(record).toMatchObject({
      id: 'legacy-1', legacy: true, workDate: '31/07/2026', monthKey: '07/2026', status: 'confirmed',
      legacyValues: { factoryWoodTubQuantity: 18, iceBoxQuantity: 4, hawkerSaleQuantity: 6, oilWorkQuantity: 3, oilWorkAmountCents: 6, headmanFeeCents: 50_000, clerkFeeCents: 25_000, monthEndSettlement: true },
    })
  })
})
