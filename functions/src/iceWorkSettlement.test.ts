import { Timestamp } from 'firebase-admin/firestore'
import { describe, expect, it } from 'vitest'
import { calculateIceWorkRecord, halfUpPerThousand, monthKeyFromMonthSortKey, summarizeIceWorkRecords, validateIceWorkSettlementInput } from './iceWorkSettlement.js'

const validRecord = (overrides: Record<string, unknown> = {}) => ({
  vesselId: 'v978', monthKey: '07/2026', monthSortKey: 202607, status: 'confirmed', voided: false, revision: 2, confirmedAt: Timestamp.fromMillis(1_700_000_000_000),
  factoryIncomingWeightGrams: 1_050, factoryIncomingRateCentsPerKg: 10, factoryIncomingAmountCents: 11,
  iceBoxHalfUnits: 3, iceBoxRateCentsPerHalfUnit: 1_500, iceBoxAmountCents: 4_500,
  dieselVolumeMilliliters: 1_250, dieselRateCentsPerLiter: 2, dieselAmountCents: 3,
  hawkerSaleWeightGrams: 1_050, hawkerSaleRateCentsPerKg: 30, hawkerSaleAmountCents: 32,
  directIceBarCount: 2, directIceRateCentsPerBar: 1_350, directIceAmountCents: 2_700,
  plasticBagCount: 3, plasticBagRateCentsEach: 140, plasticBagAmountCents: 420,
  workFeeSubtotalCents: 4_546, materialSubtotalCents: 3_120, recordTotalCents: 7_666,
  ...overrides,
})

describe('trusted ice-work settlement calculation', () => {
  it('uses integer half-up rounding per thousand', () => { expect(halfUpPerThousand(1_050, 10)).toBe(11); expect(halfUpPerThousand(1_250, 2)).toBe(3) })
  it('formats a valid month sort key', () => { expect(monthKeyFromMonthSortKey(202607)).toBe('07/2026') })
  it('recalculates every stored amount from raw integer fields', () => { expect(calculateIceWorkRecord('r1', validRecord(), 'v978', 202607).recordTotalCents).toBe(7_666) })
  it.each([
    ['other vessel', { vesselId: 'v833' }], ['other month', { monthSortKey: 202608 }], ['wrong month text', { monthKey: '08/2026' }],
    ['draft', { status: 'draft' }], ['reopened', { status: 'reopened' }], ['voided', { voided: true }], ['negative factory quantity', { factoryIncomingWeightGrams: -1 }],
    ['factory rate changed', { factoryIncomingRateCentsPerKg: 11 }], ['ice amount changed', { iceBoxAmountCents: 4_501 }], ['diesel amount changed', { dieselAmountCents: 4 }],
    ['hawker amount changed', { hawkerSaleAmountCents: 33 }], ['direct ice changed', { directIceAmountCents: 2_701 }], ['bag amount changed', { plasticBagAmountCents: 421 }],
    ['work subtotal changed', { workFeeSubtotalCents: 4_547 }], ['material subtotal changed', { materialSubtotalCents: 3_121 }], ['record total changed', { recordTotalCents: 7_667 }],
    ['revision missing', { revision: null }], ['confirmed time missing', { confirmedAt: null }],
  ])('rejects %s', (_name, patch) => { expect(() => calculateIceWorkRecord('r1', validRecord(patch), 'v978', 202607)).toThrow() })
  it('uses a deterministic sorted source hash independent of query order', () => {
    const a = { id: 'a', data: validRecord() }, b = { id: 'b', data: validRecord({ revision: 3, confirmedAt: Timestamp.fromMillis(1_700_000_000_001) }) }
    expect(summarizeIceWorkRecords([a, b], 'v978', 202607).sourceRecordsHash).toBe(summarizeIceWorkRecords([b, a], 'v978', 202607).sourceRecordsHash)
  })
  it('adds RM500 and RM250 exactly once per settlement', () => { const summary = summarizeIceWorkRecords([{ id: 'a', data: validRecord() }, { id: 'b', data: validRecord() }], 'v978', 202607); expect(summary.finalTotalCents).toBe(7_666 * 2 + 75_000) })
  it('accepts a valid callable input', () => { expect(validateIceWorkSettlementInput({ vesselId: 'v978', monthSortKey: 202607, clientOperationId: '12345678' }).monthSortKey).toBe(202607) })
  it.each([{}, { vesselId: '', monthSortKey: 202607, clientOperationId: '12345678' }, { vesselId: 'v', monthSortKey: 202613, clientOperationId: '12345678' }, { vesselId: 'v', monthSortKey: 202607, clientOperationId: 'short' }, { vesselId: 'v', monthSortKey: 202607, clientOperationId: '12345678', expectedRevision: 0 }])('rejects invalid callable input %#', input => { expect(() => validateIceWorkSettlementInput(input)).toThrow() })
})
