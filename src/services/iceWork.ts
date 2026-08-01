import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore'
import { auth, db, firebaseConfigured } from '../firebase'
import { businessDateFromLegacy } from '../lib/businessDate'
import { confirmIceWorkRecord, createIceWorkAction, createIceWorkRecord, iceWorkSettlementId, reopenIceWorkRecord, softVoidIceWorkRecord, type IceWorkAction, type IceWorkMonthlySettlement, type IceWorkRecord, type LegacyIceWorkValues } from '../lib/iceWork'

function requireUser() { if (!firebaseConfigured) throw new Error('Firebase 尚未设定。'); if (!auth.currentUser) throw new Error('请先登录。'); return auth.currentUser }
const operationId = (): string => globalThis.crypto?.randomUUID?.() ?? `operation-${Date.now()}-${Math.random().toString(36).slice(2)}`
const legacyNumber = (value: unknown): number | null => typeof value === 'number' ? value : null
const legacyStatus = (value: unknown): IceWorkRecord['status'] => value === 'confirmed' || value === 'reopened' || value === 'voided' ? value : 'draft'
export const iceWorkRecordFromStored = (id: string, data: Record<string, unknown>): IceWorkRecord => {
  if ('recordTotalCents' in data) return { ...data, id } as IceWorkRecord
  const workDate = businessDateFromLegacy(String(data.workDate ?? ''))
  const legacyValues: LegacyIceWorkValues = {
    factoryWoodTubQuantity: legacyNumber(data.factoryWoodTubQuantity), iceBoxQuantity: legacyNumber(data.iceBoxQuantity), hawkerSaleQuantity: legacyNumber(data.hawkerSaleQuantity),
    oilWorkQuantity: legacyNumber(data.oilWorkQuantity), oilWorkRateCents: legacyNumber(data.oilWorkRateCents), oilWorkAmountCents: legacyNumber(data.oilWorkAmountCents),
    headmanFeeCents: legacyNumber(data.headmanFeeCents), clerkFeeCents: legacyNumber(data.clerkFeeCents), monthEndSettlement: typeof data.monthEndSettlement === 'boolean' ? data.monthEndSettlement : null,
  }
  return {
    ...createIceWorkRecord({ id, workDate, vesselId: String(data.vesselId ?? ''), vesselCodeSnapshot: String(data.vesselCodeSnapshot ?? ''), vesselNameSnapshot: String(data.vesselCodeSnapshot ?? ''), createdBy: String(data.createdBy ?? ''), notes: String(data.notes ?? '') }),
    status: legacyStatus(data.status), revision: Number.isInteger(data.revision) ? Number(data.revision) : 1, updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
    updatedAt: data.updatedAt, voided: data.voided === true, voidReason: typeof data.voidReason === 'string' ? data.voidReason : null,
    voidedBy: typeof data.voidedBy === 'string' ? data.voidedBy : null, voidedAt: data.voidedAt, createdAt: data.createdAt,
    legacy: true, legacyValues,
  }
}

export async function loadIceWorkRecords(vesselId: string, monthKey: string) {
  const [month, year] = monthKey.split('/')
  const legacyMonthKey = year && month ? `${year}-${month}` : ''
  const snapshots = await Promise.all([
    getDocs(query(collection(db, 'iceWorkRecords'), where('vesselId', '==', vesselId), where('monthKey', '==', monthKey))),
    legacyMonthKey ? getDocs(query(collection(db, 'iceWorkRecords'), where('vesselId', '==', vesselId), where('monthKey', '==', legacyMonthKey))) : Promise.resolve(null),
  ])
  const documents = new Map<string, ReturnType<typeof iceWorkRecordFromStored>>()
  snapshots.flatMap(snapshot => snapshot?.docs ?? []).forEach(item => documents.set(item.id, iceWorkRecordFromStored(item.id, item.data())))
  return [...documents.values()].sort((a, b) => b.dateSortKey - a.dateSortKey || b.id.localeCompare(a.id))
}
export async function loadIceWorkSettlement(vesselId: string, monthKey: string) { const item = await getDoc(doc(db, 'iceWorkMonthlySettlements', iceWorkSettlementId(vesselId, monthKey))); return item.exists() ? { ...item.data(), id: item.id } as IceWorkMonthlySettlement : null }

async function saveRecordAndAction(record: IceWorkRecord, type: IceWorkAction['type'], beforeSnapshot: unknown = null, reason: string | null = null, clientOperationId: string = operationId()) {
  const user = requireUser(), recordRef = doc(db, 'iceWorkRecords', record.id), actionRef = doc(recordRef, 'actions', clientOperationId)
  const auditedRecord = { ...record, lastActionId: clientOperationId }
  const stored = Object.fromEntries(Object.entries(auditedRecord).filter(([key]) => key !== 'id'))
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
