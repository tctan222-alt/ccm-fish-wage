import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { createIceWorkRecord, createIceWorkSettlement } from './lib/iceWork'

let environment: RulesTestEnvironment
const vessel = { vesselCode: '978', displayName: '978', defaultSupplierId: '', defaultSupplierNameSnapshot: '', active: true, order: 0, notes: '', createdBy: 'u1', createdAt: serverTimestamp(), updatedBy: 'u1', updatedAt: serverTimestamp(), inactiveBy: null, inactiveAt: null }

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: 'demo-ccm-rules', firestore: { rules: await readFile('firestore.rules', 'utf8') } }) })
afterAll(async () => { if (environment) await environment.cleanup() })

describe('Firestore Rules: vessels and ice-work audit', () => {
  it('allows authenticated vessel creation but rejects vessel-code tampering and deletion', async () => {
    const db = environment.authenticatedContext('u1').firestore(), ref = doc(db, 'vessels', 'v978')
    await assertSucceeds(setDoc(ref, vessel))
    await assertFails(updateDoc(ref, { vesselCode: '833', updatedBy: 'u1', updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(ref))
  })

  it('rejects unauthenticated reads', async () => { await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'vessels', 'v978'))) })

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

  it('rejects direct tampering with a confirmed ice-work amount', async () => {
    const db = environment.authenticatedContext('u1').firestore(), record = createIceWorkRecord({ id: 'ice-confirmed', workDate: '31/07/2026', vesselId: 'v978', vesselCodeSnapshot: '978', vesselNameSnapshot: '978', createdBy: 'u1', factoryIncomingWeightGrams: 1_000 }), ref = doc(db, 'iceWorkRecords', record.id)
    await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'iceWorkRecords', record.id), { ...record, status: 'confirmed', revision: 2, lastActionId: 'legacy-confirmed', updatedBy: 'u1', confirmedBy: 'u1', confirmedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(ref, { recordTotalCents: 999, revision: 3, updatedBy: 'u1', updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(ref))
  })

  it('rejects every client write to monthly settlements and their actions', async () => {
    const db = environment.authenticatedContext('u1').firestore(), settlement = createIceWorkSettlement({ vesselId: 'v978', vesselCodeSnapshot: '978', monthKey: '07/2026', createdBy: 'u1', records: [] })
    const settlementRef = doc(db, 'iceWorkMonthlySettlements', settlement.id), actionRef = doc(settlementRef, 'actions', 'settlement-create-1'), batch = writeBatch(db)
    const { id: _settlementId, ...storedSettlement } = settlement
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
