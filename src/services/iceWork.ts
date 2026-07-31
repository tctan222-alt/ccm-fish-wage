import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore'
import { auth, db, firebaseConfigured } from '../firebase'
import { businessDateFromLegacy, monthKeyFromBusinessDate } from '../lib/businessDate'
import { confirmIceWorkRecord, confirmIceWorkSettlement, createIceWorkAction, createIceWorkRecord, createIceWorkSettlement, createIceWorkSettlementAction, iceWorkSettlementId, reopenIceWorkRecord, reopenIceWorkSettlement, softVoidIceWorkRecord, type IceWorkAction, type IceWorkMonthlySettlement, type IceWorkRecord, voidIceWorkSettlement } from '../lib/iceWork'

function requireUser() { if (!firebaseConfigured) throw new Error('Firebase 尚未设定。'); if (!auth.currentUser) throw new Error('请先登录。'); return auth.currentUser }
const operationId = (): string => globalThis.crypto?.randomUUID?.() ?? `operation-${Date.now()}-${Math.random().toString(36).slice(2)}`
const recordFrom = (id: string, data: Record<string, unknown>): IceWorkRecord => {
  if ('recordTotalCents' in data) return { ...data, id } as IceWorkRecord
  const workDate = businessDateFromLegacy(String(data.workDate ?? ''))
  return createIceWorkRecord({ id, workDate, vesselId: String(data.vesselId ?? ''), vesselCodeSnapshot: String(data.vesselCodeSnapshot ?? ''), vesselNameSnapshot: String(data.vesselCodeSnapshot ?? ''), createdBy: String(data.createdBy ?? ''), notes: String(data.notes ?? '') })
}

export async function loadIceWorkRecords(vesselId: string, monthKey: string) {
  const snapshot = await getDocs(query(collection(db, 'iceWorkRecords'), where('vesselId', '==', vesselId), where('monthKey', '==', monthKey)))
  return snapshot.docs.map(item => recordFrom(item.id, item.data())).sort((a, b) => b.dateSortKey - a.dateSortKey || b.id.localeCompare(a.id))
}
export async function loadIceWorkSettlement(vesselId: string, monthKey: string) { const item = await getDoc(doc(db, 'iceWorkMonthlySettlements', iceWorkSettlementId(vesselId, monthKey))); return item.exists() ? { ...item.data(), id: item.id } as IceWorkMonthlySettlement : null }

async function saveRecordAndAction(record: IceWorkRecord, type: IceWorkAction['type'], beforeSnapshot: unknown = null, reason: string | null = null, clientOperationId: string = operationId()) {
  const user = requireUser(), recordRef = doc(db, 'iceWorkRecords', record.id), actionRef = doc(recordRef, 'actions', clientOperationId)
  const auditedRecord = { ...record, lastActionId: clientOperationId }, { id, ...stored } = auditedRecord
  await runTransaction(db, async transaction => {
    const [existing, existingAction] = await Promise.all([transaction.get(recordRef), transaction.get(actionRef)])
    if (existingAction.exists()) return
    if (type === 'create' && existing.exists()) throw new Error('冰工记录已存在。')
    if (type !== 'create' && (!existing.exists() || Number(existing.data().revision) !== record.revision - 1)) throw new Error('冰工记录已被其他操作更新，请重新载入。')
    transaction.set(recordRef, { ...stored, updatedBy: user.uid, updatedAt: serverTimestamp(), ...(type === 'create' ? { createdBy: record.createdBy || user.uid, createdAt: serverTimestamp() } : {}), ...(type === 'confirm' ? { confirmedBy: user.uid, confirmedAt: serverTimestamp() } : {}), ...(type === 'reopen' ? { reopenedBy: user.uid, reopenedAt: serverTimestamp() } : {}), ...(type === 'void' ? { voidedBy: user.uid, voidedAt: serverTimestamp() } : {}) }, { merge: type !== 'create' })
    transaction.set(actionRef, { ...createIceWorkAction(type, auditedRecord, user.uid, beforeSnapshot, clientOperationId, reason), performedAt: serverTimestamp() })
  })
  return { ...auditedRecord, createdBy: record.createdBy || user.uid, updatedBy: user.uid }
}
export async function saveIceWorkRecord(record: IceWorkRecord, clientOperationId?: string) { return saveRecordAndAction(record, 'create', null, null, clientOperationId) }
export async function confirmIceWorkRecordInStore(record: IceWorkRecord, clientOperationId?: string) { const user = requireUser(); return saveRecordAndAction(confirmIceWorkRecord(record, user.uid), 'confirm', record, null, clientOperationId) }
export async function reopenIceWorkRecordInStore(record: IceWorkRecord, reason: string, clientOperationId?: string) { const user = requireUser(); return saveRecordAndAction(reopenIceWorkRecord(record, reason, user.uid), 'reopen', record, reason, clientOperationId) }
export async function voidIceWorkRecord(record: IceWorkRecord, reason: string, clientOperationId?: string) { const user = requireUser(); return saveRecordAndAction(softVoidIceWorkRecord(record, reason, user.uid), 'void', record, reason, clientOperationId) }

export async function createIceWorkMonthlySettlement(vesselId: string, vesselCodeSnapshot: string, monthKey: string, clientOperationId = operationId()) {
  const user = requireUser(), settlementRef = doc(db, 'iceWorkMonthlySettlements', iceWorkSettlementId(vesselId, monthKey)), records = await loadIceWorkRecords(vesselId, monthKey)
  const candidate = { ...createIceWorkSettlement({ vesselId, vesselCodeSnapshot, monthKey, createdBy: user.uid, records }), lastActionId: clientOperationId }, actionRef = doc(settlementRef, 'actions', clientOperationId)
  await runTransaction(db, async transaction => {
    const [existing, existingAction] = await Promise.all([transaction.get(settlementRef), transaction.get(actionRef)])
    if (existingAction.exists()) return
    if (existing.exists() && existing.data().status !== 'voided') throw new Error('本船本月已有有效月结。')
    const { id, ...stored } = candidate
    transaction.set(settlementRef, { ...stored, createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: user.uid }, { merge: existing.exists() })
    transaction.set(actionRef, { ...createIceWorkSettlementAction('create', candidate, user.uid, existing.exists() ? existing.data() : null, clientOperationId), performedAt: serverTimestamp() })
  })
  return candidate
}
async function updateSettlement(settlement: IceWorkMonthlySettlement, type: 'confirm' | 'reopen' | 'void', reason: string | null = null, clientOperationId = operationId()) {
  const user = requireUser(), ref = doc(db, 'iceWorkMonthlySettlements', settlement.id)
  const next = { ...(type === 'confirm' ? confirmIceWorkSettlement(settlement, user.uid) : type === 'reopen' ? reopenIceWorkSettlement(settlement, reason ?? '', user.uid) : voidIceWorkSettlement(settlement, reason ?? '', user.uid)), lastActionId: clientOperationId }
  const actionRef = doc(ref, 'actions', clientOperationId), { id, ...stored } = next
  await runTransaction(db, async transaction => {
    const [existing, existingAction] = await Promise.all([transaction.get(ref), transaction.get(actionRef)])
    if (existingAction.exists()) return
    if (!existing.exists() || Number(existing.data().revision) !== settlement.revision) throw new Error('月结已被其他操作更新，请重新载入。')
    transaction.set(ref, { ...stored, updatedBy: user.uid, updatedAt: serverTimestamp(), ...(type === 'confirm' ? { confirmedBy: user.uid, confirmedAt: serverTimestamp() } : {}), ...(type === 'reopen' ? { reopenedBy: user.uid, reopenedAt: serverTimestamp() } : {}), ...(type === 'void' ? { voidedBy: user.uid, voidedAt: serverTimestamp() } : {}) }, { merge: true })
    transaction.set(actionRef, { ...createIceWorkSettlementAction(type, next, user.uid, settlement, clientOperationId, reason), performedAt: serverTimestamp() })
  })
  return next
}
export const confirmIceWorkMonthlySettlement = (settlement: IceWorkMonthlySettlement, clientOperationId?: string) => updateSettlement(settlement, 'confirm', null, clientOperationId)
export const reopenIceWorkMonthlySettlement = (settlement: IceWorkMonthlySettlement, reason: string, clientOperationId?: string) => updateSettlement(settlement, 'reopen', reason, clientOperationId)
export const voidIceWorkMonthlySettlement = (settlement: IceWorkMonthlySettlement, reason: string, clientOperationId?: string) => updateSettlement(settlement, 'void', reason, clientOperationId)
