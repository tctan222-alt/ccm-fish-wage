import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, cloudFunctions, db, firebaseConfigured } from '../firebase'
import { businessDateFromLegacy, monthKeyFromBusinessDate, monthSortKeyFromMonthKey } from '../lib/businessDate'
import { confirmIceWorkRecord, createIceWorkAction, createIceWorkRecord, iceWorkSettlementId, reopenIceWorkRecord, softVoidIceWorkRecord, type IceWorkAction, type IceWorkMonthlySettlement, type IceWorkRecord } from '../lib/iceWork'

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

type SettlementOperation = { vesselId: string; monthSortKey: number; clientOperationId: string; expectedRevision?: number; reason?: string }
type SourceCheck = { sourceRecordCount: number; sourceRecordsHash: string; sourceChanged: boolean }
const monthKeyFromSort = (monthSortKey: number) => `${String(monthSortKey % 100).padStart(2, '0')}/${Math.floor(monthSortKey / 100)}`
async function callSettlement(name: 'rebuildIceWorkMonthlySettlement' | 'confirmIceWorkMonthlySettlement' | 'reopenIceWorkMonthlySettlement' | 'voidIceWorkMonthlySettlement', input: SettlementOperation) {
  requireUser()
  await httpsCallable<SettlementOperation, unknown>(cloudFunctions, name)(input)
  const settlement = await loadIceWorkSettlement(input.vesselId, monthKeyFromSort(input.monthSortKey))
  if (!settlement) throw new Error('服务器未返回月结结果，请重新载入。')
  return settlement
}
const settlementInput = (vesselId: string, monthKey: string, clientOperationId: string, expectedRevision?: number, reason?: string): SettlementOperation => ({ vesselId, monthSortKey: monthSortKeyFromMonthKey(monthKey), clientOperationId, expectedRevision, ...(reason ? { reason } : {}) })
export const createIceWorkMonthlySettlement = (vesselId: string, _vesselCodeSnapshot: string, monthKey: string, clientOperationId = operationId()) => callSettlement('rebuildIceWorkMonthlySettlement', settlementInput(vesselId, monthKey, clientOperationId))
export const rebuildIceWorkMonthlySettlement = (settlement: IceWorkMonthlySettlement, clientOperationId = operationId()) => callSettlement('rebuildIceWorkMonthlySettlement', settlementInput(settlement.vesselId, settlement.monthKey, clientOperationId, settlement.revision))
export const confirmIceWorkMonthlySettlement = (settlement: IceWorkMonthlySettlement, clientOperationId = operationId()) => callSettlement('confirmIceWorkMonthlySettlement', settlementInput(settlement.vesselId, settlement.monthKey, clientOperationId, settlement.revision))
export const reopenIceWorkMonthlySettlement = (settlement: IceWorkMonthlySettlement, reason: string, clientOperationId = operationId()) => callSettlement('reopenIceWorkMonthlySettlement', settlementInput(settlement.vesselId, settlement.monthKey, clientOperationId, settlement.revision, reason))
export const voidIceWorkMonthlySettlement = (settlement: IceWorkMonthlySettlement, reason: string, clientOperationId = operationId()) => callSettlement('voidIceWorkMonthlySettlement', settlementInput(settlement.vesselId, settlement.monthKey, clientOperationId, settlement.revision, reason))
export async function checkIceWorkMonthlySettlementSource(settlement: IceWorkMonthlySettlement, clientOperationId = operationId()): Promise<SourceCheck> {
  requireUser()
  const input = settlementInput(settlement.vesselId, settlement.monthKey, clientOperationId, settlement.revision)
  return (await httpsCallable<SettlementOperation, SourceCheck>(cloudFunctions, 'checkIceWorkMonthlySettlementSource')(input)).data
}
