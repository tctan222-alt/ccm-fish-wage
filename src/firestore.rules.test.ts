import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch, type DocumentReference } from 'firebase/firestore'
import { createIceWorkRecord, createIceWorkSettlement } from './lib/iceWork'
import { makeRetailLine, MAX_RETAIL_LINES, prepareRetailSale } from './lib/retailSales'
import retailSeed from './data/retailFishSeed.json'

let environment: RulesTestEnvironment
const vessel = { vesselCode: '978', displayName: '978', defaultSupplierId: '', defaultSupplierNameSnapshot: '', active: true, order: 0, notes: '', createdBy: 'u1', createdAt: serverTimestamp(), updatedBy: 'u1', updatedAt: serverTimestamp(), inactiveBy: null, inactiveAt: null }

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: 'demo-ccm-rules', firestore: { rules: await readFile('firestore.rules', 'utf8') } }) })
afterAll(async () => { if (environment) await environment.cleanup() })

describe('Firestore Rules: retail cash sales', () => {
  const line = makeRetailLine(retailSeed[0], '2', '6.15')
  function sale(lines = [line]) {
    return { ...prepareRetailSale({ businessDate: '06/09/2026', vendorName: '阿明', lines }), createdBy: 'u1', updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
  }
  async function writeSale(ref: DocumentReference, input: Omit<ReturnType<typeof sale>, 'createdAt'> & { createdAt: unknown }) {
    const { lines, ...header } = input
    const lineGroups = { first: lines.slice(0, 5), second: lines.slice(5, 10), third: lines.slice(10, 15), fourth: lines.slice(15) }
    for (const [key, items] of Object.entries(lineGroups)) await setDoc(doc(ref, 'groups', key), { lines: items, totalAmountCents: items.reduce<number>((sum, item) => sum + item.amountCents, 0), createdBy: 'u1', createdAt: serverTimestamp() })
    return setDoc(ref, { ...header, lineGroups })
  }
  it('allows initial fish, subsequent edits and no suggested price, without rewriting sale snapshots', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    for (const { id, ...fish } of retailSeed) await assertSucceeds(setDoc(doc(db, 'retailFish', id), { ...fish, createdBy: 'u1', updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
    const fishRef = doc(db, 'retailFish', retailSeed[0].id), saleRef = doc(db, 'retailSales', 'retail-snapshot')
    await assertSucceeds(writeSale(saleRef, sale()))
    await assertSucceeds(updateDoc(fishRef, { chineseName: '新鱼名', malayName: '', suggestedPriceCents: null, active: false, updatedBy: 'u1', updatedAt: serverTimestamp() }))
    expect((await getDoc(saleRef)).data()?.lineGroups.first[0]).toMatchObject({ chineseName: '甘丰', malayName: 'kembung', unitPriceCents: 615, amountCents: 1230 })
    await assertFails(deleteDoc(fishRef))
    await assertFails(updateDoc(fishRef, { createdBy: 'other', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(fishRef, { suggestedPriceCents: -1, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(fishRef, { suggestedPriceCents: 6.15, updatedAt: serverTimestamp() }))
  })
  it('rejects anonymous reads/writes and all mutations of saved sales', async () => {
    const db = environment.authenticatedContext('u1').firestore(), ref = doc(db, 'retailSales', 'retail-immutable')
    await assertSucceeds(writeSale(ref, sale()))
    await assertFails(updateDoc(ref, { vendorName: 'changed', updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(ref))
    await assertFails(updateDoc(doc(ref, 'groups', 'first'), { totalAmountCents: 1 }))
    await assertFails(deleteDoc(doc(ref, 'groups', 'first')))
    const anonymous = environment.unauthenticatedContext().firestore()
    for (const collection of ['retailFish', 'retailSales']) {
      await assertFails(getDoc(doc(anonymous, collection, 'any')))
      await assertFails(setDoc(doc(anonymous, collection, 'any'), sale()))
    }
  })
  it('checks every line up to the maximum and verifies the total', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const max = sale(Array.from({ length: MAX_RETAIL_LINES }, (_, index) => ({ ...line, chineseName: `鱼${index}` })))
    await assertSucceeds(writeSale(doc(db, 'retailSales', 'retail-max'), max))
    const lastTampered = max.lines.map((item, index) => index === MAX_RETAIL_LINES - 1 ? { ...item, amountCents: 1 } : item)
    await assertFails(writeSale(doc(db, 'retailSales', 'retail-last-tampered'), { ...max, lines: lastTampered }))
    await assertFails(writeSale(doc(db, 'retailSales', 'retail-total-tampered'), { ...max, totalAmountCents: 1 }))
    await assertFails(writeSale(doc(db, 'retailSales', 'retail-over-limit'), { ...max, lines: [...max.lines, line], totalAmountCents: max.totalAmountCents + line.amountCents }))
  })
  it('accepts tenths of a kg and independently enforces rounding to integer cents', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const cases = [['12.5', '6', 7500], ['7.3', '8', 5840], ['0.1', '0.05', 1], ['0.1', '0.04', 0], ['300', '10000', 300000000]] as const
    for (const [index, [kg, price, expected]] of cases.entries()) {
      const decimalLine = makeRetailLine(retailSeed[0], kg, price)
      expect(decimalLine.amountCents).toBe(expected)
      const ref = doc(db, 'retailSales', `retail-decimal-${index}`)
      await assertSucceeds(writeSale(ref, sale([decimalLine])))
      expect((await getDoc(ref)).data()?.totalAmountCents).toBe(expected)
      await assertFails(writeSale(doc(db, 'retailSales', `retail-rounding-tampered-${index}`), {
        ...sale([decimalLine]), lines: [{ ...decimalLine, amountCents: expected + 1 }], totalAmountCents: expected + 1,
      }))
    }
    await assertFails(setDoc(doc(db, 'retailSales', 'retail-legacy-write', 'groups', 'first'), {
      lines: [{ fishId: line.fishId, chineseName: line.chineseName, malayName: line.malayName, weightKg: 2, unitPriceCents: 615, amountCents: 1230 }],
      totalAmountCents: 1230, createdBy: 'u1', createdAt: serverTimestamp(),
    }))
  })
  it('can finalize pre-upgrade immutable integer groups without rewriting them', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const ref = doc(db, 'retailSales', 'retail-legacy-pending')
    const legacyLine = { fishId: line.fishId, chineseName: line.chineseName, malayName: line.malayName, weightKg: 2, unitPriceCents: 615, amountCents: 1230 }
    await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'retailSales', ref.id, 'groups', 'first'), {
      lines: [legacyLine], totalAmountCents: 1230, createdBy: 'u1', createdAt: serverTimestamp(),
    }))
    for (const key of ['second', 'third', 'fourth']) await assertSucceeds(setDoc(doc(ref, 'groups', key), { lines: [], totalAmountCents: 0, createdBy: 'u1', createdAt: serverTimestamp() }))
    const header = { businessDate: '06/09/2026', dateSortKey: 20260906, vendorName: '阿明', totalAmountCents: 1230,
      createdBy: 'u1', updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      lineGroups: { first: [legacyLine], second: [], third: [], fourth: [] } }
    await assertFails(setDoc(doc(environment.authenticatedContext('other').firestore(), 'retailSales', ref.id), { ...header, createdBy: 'other', updatedBy: 'other' }))
    await assertFails(setDoc(ref, { ...header, lineGroups: { ...header.lineGroups, first: [line] } }))
    await assertSucceeds(setDoc(ref, header))
    expect((await getDoc(doc(ref, 'groups', 'first'))).data()?.lines).toEqual([legacyLine])
  })
  it('rejects invalid dates, kg, prices, empty sales and forged audit fields', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const invalid = [
      { businessDate: '29/02/2026', dateSortKey: 20260229 }, { dateSortKey: 20260907 }, { vendorName: '' }, { lines: [], totalAmountCents: 0 },
      ...[0, -1, 3001, 22.5].map(weightDeciKg => ({ lines: [{ ...line, weightDeciKg, amountCents: Math.floor((weightDeciKg * line.unitPriceCents + 5) / 10) }], totalAmountCents: Math.floor((weightDeciKg * line.unitPriceCents + 5) / 10) })),
      ...[0, -1, 1.5, 1000001].map(unitPriceCents => ({ lines: [{ ...line, unitPriceCents, amountCents: Math.floor((line.weightDeciKg * unitPriceCents + 5) / 10) }], totalAmountCents: Math.floor((line.weightDeciKg * unitPriceCents + 5) / 10) })),
      { lines: [{ ...line, weightKg: 2 }] },
      { createdBy: 'other' }, { updatedBy: 'other' }, { createdAt: new Date('2020-01-01') }, { inventoryDeducted: true },
    ]
    for (let index = 0; index < invalid.length; index++) await assertFails(writeSale(doc(db, 'retailSales', `retail-invalid-${index}`), { ...sale(), ...invalid[index] }))
    await assertFails(setDoc(doc(db, 'retailSales', 'retail-missing-groups'), { ...sale(), lineGroups: { first: [line], second: [] } }))
  })
})

describe('Firestore Rules: vessels and ice-work audit', () => {
  it('allows authenticated vessel creation but rejects vessel-code tampering and deletion', async () => {
    const db = environment.authenticatedContext('u1').firestore(), ref = doc(db, 'vessels', 'v978')
    await assertSucceeds(setDoc(ref, vessel))
    await assertFails(updateDoc(ref, { vesselCode: '833', updatedBy: 'u1', updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(ref))
  })

  it('rejects unauthenticated reads', async () => { await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'vessels', 'v978'))) })

  it('allows explicit worker departments and rejects unknown worker department values', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const worker = { name: '切鱼头工人', active: true, order: 0, workerCode: 'WK-00000001', phone: '', department: 'fish_head', workerDepartment: 'fish_head_cutting', employmentStartDate: '', employmentEndDate: '', notes: '', createdBy: 'u1', createdAt: serverTimestamp(), updatedBy: 'u1', updatedAt: serverTimestamp(), inactiveBy: null, inactiveAt: null }
    await assertSucceeds(setDoc(doc(db, 'workers', 'cutting-worker'), worker))
    await assertFails(setDoc(doc(db, 'workers', 'invalid-worker'), { ...worker, workerDepartment: 'vessel' }))
  })

  it('requires the complete wage business-date fields for new wage records', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const wage = { dateKey: '2026-07-31', businessDate: '31/07/2026', dateSortKey: 20260731, monthKey: '07/2026', monthSortKey: 202607, workerId: 'cutting-worker', workerName: '切鱼头工人', weightKg: 80, rateRm: '0.12', wageRm: '9.60', createdBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), deleted: false }
    await assertSucceeds(setDoc(doc(db, 'fishHeadWageEntries', 'dated-wage'), wage))
    const missingBusinessDate = Object.fromEntries(Object.entries(wage).filter(([key]) => key !== 'businessDate'))
    await assertFails(setDoc(doc(db, 'fishHeadWageEntries', 'missing-date-wage'), missingBusinessDate))
    await assertFails(setDoc(doc(db, 'fishHeadWageEntries', 'wrong-sort-wage'), { ...wage, dateSortKey: 20260801 }))
    await assertFails(setDoc(doc(db, 'fishHeadWageEntries', 'impossible-date-wage'), { ...wage, dateKey: '2026-02-29', businessDate: '29/02/2026', dateSortKey: 20260229, monthKey: '02/2026', monthSortKey: 202602 }))
    const legacyWage = { dateKey: '2026-07-30', workerId: 'cutting-worker', workerName: '旧工人', weightKg: 80, rateRm: '0.12', wageRm: '9.60', createdBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), deleted: false }
    const legacyRef = doc(db, 'fishHeadWageEntries', 'legacy-wage')
    await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'fishHeadWageEntries', 'legacy-wage'), legacyWage))
    await assertSucceeds(updateDoc(legacyRef, { deleted: true, updatedAt: serverTimestamp() }))
  })

  it('allows repeatable settlement drafts but rejects deletion and confirmation status', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const draftRef = doc(db, 'purchaseSettlementDrafts', 'fish_head_20260803_v978')
    const line = { lineType: 'fish_head', nameSnapshot: '金线', totalWeightGrams: 160500, basketCount: 1, totalWeightEntryCount: 1,
      defaultUnitPriceCentsPerKg: 210, unitPriceCentsPerKg: 210, priceWasEdited: false, amountCents: 33705, sourceEntryIds: ['entry-1'],
      fishSpeciesId: 'jin_xian', fishSpeciesCodeSnapshot: 'jin_xian', fishSpeciesNameSnapshot: '金线' }
    const draft = { productType: 'fish_head', businessDate: '03/08/2026', dateSortKey: 20260803, monthKey: '08/2026', monthSortKey: 202608,
      vesselId: 'v978', vesselCodeSnapshot: '978', receiptNo: '', status: 'settlement_draft', lines: [line], totalAmountCents: 33705,
      sourceEntryIds: ['entry-1'], createdAt: serverTimestamp(), createdBy: 'u1', updatedAt: serverTimestamp(), updatedBy: 'u1', revision: 1, voided: false }
    await assertSucceeds(setDoc(draftRef, draft))
    await assertSucceeds(updateDoc(draftRef, { receiptNo: 'FH-001', totalAmountCents: 33705, revision: 2, updatedBy: 'u1', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(draftRef, { vesselId: 'v833', monthKey: '08/2026', monthSortKey: 202608, revision: 3, updatedBy: 'u1', updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(draftRef))
    await assertFails(setDoc(doc(db, 'purchaseSettlementDrafts', 'invalid-settlement'), { ...draft, status: 'settlement_confirmed' }))
    await assertFails(setDoc(doc(db, 'purchaseSettlementDrafts', 'voided-settlement'), { ...draft, voided: true }))
  })

  it('allows an atomic draft record and immutable create action, but rejects action changes', async () => {
    const db = environment.authenticatedContext('u1').firestore(), record = createIceWorkRecord({ id: 'ice-1', workDate: '31/07/2026', vesselId: 'v978', vesselCodeSnapshot: '978', vesselNameSnapshot: '978', createdBy: 'u1', factoryIncomingWeightGrams: 1_000 })
    const recordRef = doc(db, 'iceWorkRecords', record.id), actionRef = doc(recordRef, 'actions', 'create-ice-1'), batch = writeBatch(db)
    batch.set(recordRef, { ...record, lastActionId: 'create-ice-1', updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    batch.set(actionRef, { type: 'create', recordId: record.id, reason: null, performedBy: 'u1', performedAt: serverTimestamp(), beforeSnapshot: null, afterSnapshot: { ...record, lastActionId: 'create-ice-1' }, revision: 1, clientOperationId: 'create-ice-1' })
    await assertSucceeds(batch.commit())
    await assertFails(updateDoc(actionRef, { reason: 'changed' }))
    await assertFails(deleteDoc(actionRef))

    const confirmActionRef = doc(recordRef, 'actions', 'confirm-ice-1'), confirmBatch = writeBatch(db)
    confirmBatch.update(recordRef, { status: 'confirmed', revision: 2, lastActionId: 'confirm-ice-1', confirmedBy: 'u1', confirmedAt: serverTimestamp(), updatedBy: 'u1', updatedAt: serverTimestamp() })
    confirmBatch.set(confirmActionRef, { type: 'confirm', recordId: record.id, reason: null, performedBy: 'u1', performedAt: serverTimestamp(), beforeSnapshot: { ...record, lastActionId: 'create-ice-1' }, afterSnapshot: { ...record, status: 'confirmed', revision: 2, lastActionId: 'confirm-ice-1' }, revision: 2, clientOperationId: 'confirm-ice-1' })
    await assertSucceeds(confirmBatch.commit())
  })

  it('rejects a record creation that is not paired with its audit action', async () => {
    const db = environment.authenticatedContext('u1').firestore(), record = createIceWorkRecord({ id: 'ice-without-action', workDate: '31/07/2026', vesselId: 'v978', vesselCodeSnapshot: '978', vesselNameSnapshot: '978', createdBy: 'u1' })
    await assertFails(setDoc(doc(db, 'iceWorkRecords', record.id), { ...record, lastActionId: 'missing-action', updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  })

  it('rejects an ice-work record whose month key disagrees with its work date', async () => {
    const db = environment.authenticatedContext('u1').firestore(), record = { ...createIceWorkRecord({ id: 'ice-wrong-month', workDate: '31/07/2026', vesselId: 'v978', vesselCodeSnapshot: '978', vesselNameSnapshot: '978', createdBy: 'u1' }), monthKey: '06/2026', monthSortKey: 202606, lastActionId: 'create-wrong-month', updatedBy: 'u1' }
    const recordRef = doc(db, 'iceWorkRecords', record.id), actionRef = doc(recordRef, 'actions', record.lastActionId), batch = writeBatch(db)
    batch.set(recordRef, { ...record, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    batch.set(actionRef, { type: 'create', recordId: record.id, reason: null, performedBy: 'u1', performedAt: serverTimestamp(), beforeSnapshot: null, afterSnapshot: record, revision: 1, clientOperationId: record.lastActionId })
    await assertFails(batch.commit())
  })

  it('rejects direct tampering with a confirmed ice-work amount', async () => {
    const db = environment.authenticatedContext('u1').firestore(), record = createIceWorkRecord({ id: 'ice-confirmed', workDate: '31/07/2026', vesselId: 'v978', vesselCodeSnapshot: '978', vesselNameSnapshot: '978', createdBy: 'u1', factoryIncomingWeightGrams: 1_000 }), ref = doc(db, 'iceWorkRecords', record.id)
    await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'iceWorkRecords', record.id), { ...record, status: 'confirmed', revision: 2, lastActionId: 'legacy-confirmed', updatedBy: 'u1', confirmedBy: 'u1', confirmedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(ref, { recordTotalCents: 999, revision: 3, updatedBy: 'u1', updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(ref))
  })

  it('rejects changing financial values while confirming an ice-work record', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const original = createIceWorkRecord({ id: 'ice-confirm-tamper', workDate: '31/07/2026', vesselId: 'v978', vesselCodeSnapshot: '978', vesselNameSnapshot: '978', createdBy: 'u1', factoryIncomingWeightGrams: 1_000 })
    const changed = createIceWorkRecord({ ...original, id: original.id, factoryIncomingWeightGrams: 2_000 })
    const recordRef = doc(db, 'iceWorkRecords', original.id), actionRef = doc(recordRef, 'actions', 'confirm-tamper')
    await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'iceWorkRecords', original.id), { ...original, lastActionId: 'create-tamper', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
    const batch = writeBatch(db)
    batch.update(recordRef, { ...changed, status: 'confirmed', revision: 2, lastActionId: 'confirm-tamper', confirmedBy: 'u1', confirmedAt: serverTimestamp(), updatedBy: 'u1', updatedAt: serverTimestamp() })
    batch.set(actionRef, { type: 'confirm', recordId: original.id, reason: null, performedBy: 'u1', performedAt: serverTimestamp(), beforeSnapshot: { ...original, lastActionId: 'create-tamper' }, afterSnapshot: { ...changed, status: 'confirmed', revision: 2, lastActionId: 'confirm-tamper' }, revision: 2, clientOperationId: 'confirm-tamper' })
    await assertFails(batch.commit())
  })

  it('rejects every client write to monthly settlements and their actions', async () => {
    const db = environment.authenticatedContext('u1').firestore(), settlement = createIceWorkSettlement({ vesselId: 'v978', vesselCodeSnapshot: '978', monthKey: '07/2026', createdBy: 'u1', records: [] })
    const settlementRef = doc(db, 'iceWorkMonthlySettlements', settlement.id), actionRef = doc(settlementRef, 'actions', 'settlement-create-1'), batch = writeBatch(db)
    const storedSettlement = Object.fromEntries(Object.entries(settlement).filter(([key]) => key !== 'id'))
    batch.set(settlementRef, { ...storedSettlement, lastActionId: 'settlement-create-1', updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    batch.set(actionRef, { type: 'create', settlementId: settlement.id, reason: null, performedBy: 'u1', performedAt: serverTimestamp(), beforeSnapshot: null, afterSnapshot: { ...settlement, lastActionId: 'settlement-create-1' }, revision: 1, clientOperationId: 'settlement-create-1' })
    await assertFails(batch.commit())
    await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'iceWorkMonthlySettlements', settlement.id), { ...storedSettlement, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(settlementRef, { revision: 2 }))
    await assertFails(setDoc(actionRef, { type: 'rebuild', settlementId: settlement.id, clientOperationId: 'settlement-create-1', performedBy: 'u1' }))
    await assertFails(updateDoc(actionRef, { reason: 'changed' }))
    await assertFails(deleteDoc(actionRef))
    await assertFails(deleteDoc(settlementRef))
  })

  it('rejects a monthly settlement creation that is not paired with its audit action', async () => {
    const db = environment.authenticatedContext('u1').firestore(), settlement = createIceWorkSettlement({ vesselId: 'v978', vesselCodeSnapshot: '978', monthKey: '06/2026', createdBy: 'u1', records: [] })
    await assertFails(setDoc(doc(db, 'iceWorkMonthlySettlements', settlement.id), { ...settlement, lastActionId: 'missing-action', updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  })

  it('rejects an audited monthly settlement whose financial totals are inconsistent', async () => {
    const db = environment.authenticatedContext('u1').firestore(), settlement = { ...createIceWorkSettlement({ vesselId: 'v978', vesselCodeSnapshot: '978', monthKey: '05/2026', createdBy: 'u1', records: [] }), finalTotalCents: 1, lastActionId: 'invalid-settlement-create' }
    const settlementRef = doc(db, 'iceWorkMonthlySettlements', settlement.id), actionRef = doc(settlementRef, 'actions', settlement.lastActionId), batch = writeBatch(db)
    batch.set(settlementRef, { ...settlement, updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    batch.set(actionRef, { type: 'create', settlementId: settlement.id, reason: null, performedBy: 'u1', performedAt: serverTimestamp(), beforeSnapshot: null, afterSnapshot: settlement, revision: 1, clientOperationId: settlement.lastActionId })
    await assertFails(batch.commit())
  })
})
