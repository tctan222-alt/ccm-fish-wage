import { describe, expect, it } from 'vitest'
import { createIceWorkRecord, createIceWorkSettlement, parseIceBoxHalfUnits, parseWholeKilogramsToGrams, summarizeIceWorkMonth } from './iceWork'

describe('冰工计算和月结', () => {
  it('uses grams, milliliters, half units and cents to calculate a work record', () => {
    const record = createIceWorkRecord({
      id: 'ice-1', workDate: '31/07/2026', vesselId: 'v978', vesselCodeSnapshot: '978', vesselNameSnapshot: '978', createdBy: 'admin',
      factoryIncomingWeightGrams: 125_500, iceBoxHalfUnits: 3, dieselVolumeMilliliters: 125_500,
      hawkerSaleWeightGrams: 125_500, directIceBarCount: 2, plasticBagCount: 10,
    })
    expect(record).toMatchObject({
      monthKey: '07/2026', dateSortKey: 20260731, monthSortKey: 202607,
      factoryIncomingAmountCents: 1_255, iceBoxAmountCents: 4_500, dieselAmountCents: 251,
      hawkerSaleAmountCents: 3_765, directIceAmountCents: 2_700, plasticBagAmountCents: 1_400,
      workFeeSubtotalCents: 9_771, materialSubtotalCents: 4_100, recordTotalCents: 13_871,
      status: 'draft', revision: 1,
    })
  })

  it('only accepts full or half ice boxes and rounds diesel half-up', () => {
    expect(parseIceBoxHalfUnits('2.5')).toBe(5)
    expect(() => parseIceBoxHalfUnits('1.25')).toThrow('冰箱子数量')
    expect(createIceWorkRecord({ id: 'half', workDate: '01/07/2026', vesselId: 'v', vesselCodeSnapshot: '978', vesselNameSnapshot: '978', createdBy: 'admin', dieselVolumeMilliliters: 500 }).dieselAmountCents).toBe(1)
  })

  it('accepts only whole 1–300 kg values for new ice-work weight fields', () => {
    expect(parseWholeKilogramsToGrams('125')).toBe(125_000)
    expect(parseWholeKilogramsToGrams('')).toBe(0)
    expect(() => parseWholeKilogramsToGrams('125.5')).toThrow()
    expect(() => parseWholeKilogramsToGrams('301')).toThrow()
  })

  it('adds RM500 and RM250 exactly once per vessel monthly settlement', () => {
    const confirmed = { ...createIceWorkRecord({ id: 'a', workDate: '01/07/2026', vesselId: 'v978', vesselCodeSnapshot: '978', vesselNameSnapshot: '978', createdBy: 'admin', factoryIncomingWeightGrams: 1_000 }), status: 'confirmed' as const }
    const voided = { ...confirmed, id: 'b', status: 'voided' as const, voided: true }
    const summary = summarizeIceWorkMonth([confirmed, voided])
    expect(summary).toMatchObject({ validRecordCount: 1, workFeeSubtotalCents: 10, recordsTotalCents: 10 })
    expect(createIceWorkSettlement({ vesselId: 'v978', vesselCodeSnapshot: '978', monthKey: '07/2026', createdBy: 'admin', records: [confirmed, voided] })).toMatchObject({
      id: 'v978_202607', headmanFeeCents: 50_000, clerkFeeCents: 25_000, finalTotalCents: 75_010,
    })
  })
})
