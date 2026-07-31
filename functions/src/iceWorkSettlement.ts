import { createHash } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'

const app = getApps()[0] ?? initializeApp()
const db = getFirestore(app)
export const ICE_WORK_FUNCTION_REGION = 'asia-southeast1'
const rates = { factory: 10, iceBoxHalf: 1500, diesel: 2, hawker: 30, directIce: 1350, bag: 140, headman: 50_000, clerk: 25_000 } as const
type Operation = 'rebuild' | 'confirm' | 'reopen' | 'void'
type CallableInput = { vesselId: string; monthSortKey: number; clientOperationId: string; expectedRevision?: number; reason?: string }
type Summary = {
  validRecordCount: number; factoryIncomingAmountCents: number; iceBoxAmountCents: number; dieselAmountCents: number
  hawkerSaleAmountCents: number; directIceAmountCents: number; plasticBagAmountCents: number; workFeeSubtotalCents: number
  materialSubtotalCents: number; recordsTotalCents: number; headmanFeeCents: number; clerkFeeCents: number; finalTotalCents: number
  sourceRecordsHash: string; sourceRecordCount: number
}
type ErrorCode = ConstructorParameters<typeof HttpsError>[0]

const fail = (code: ErrorCode, message: string): never => { throw new HttpsError(code, message) }
const nonNegativeInteger = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('failed-precondition', `冰工记录的${field}无效。`)
  return value as number
}
export const halfUpPerThousand = (quantity: number, rate: number) => Math.floor((quantity * rate + 500) / 1000)
export const monthKeyFromMonthSortKey = (monthSortKey: number) => `${String(monthSortKey % 100).padStart(2, '0')}/${Math.floor(monthSortKey / 100)}`
const safeCents = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) fail('failed-precondition', `冰工记录的${field}超出安全整数范围。`)
  return value
}
const multipliedCents = (quantity: number, rate: number, field: string) => {
  if (quantity > Math.floor(Number.MAX_SAFE_INTEGER / rate)) fail('failed-precondition', `冰工记录的${field}超出安全整数范围。`)
  return safeCents(quantity * rate, field)
}
const roundedCents = (quantity: number, rate: number, field: string) => {
  if (quantity > Math.floor((Number.MAX_SAFE_INTEGER - 500) / rate)) fail('failed-precondition', `冰工记录的${field}超出安全整数范围。`)
  return safeCents(halfUpPerThousand(quantity, rate), field)
}
const sumCents = (field: string, ...values: number[]) => values.reduce((sum, value) => {
  if (sum > Number.MAX_SAFE_INTEGER - value) fail('failed-precondition', `冰工记录的${field}超出安全整数范围。`)
  return sum + value
}, 0)

export function validateIceWorkSettlementInput(input: unknown): CallableInput {
  if (!input || typeof input !== 'object') fail('invalid-argument', '请求格式无效。')
  const value = input as Partial<CallableInput>
  if (typeof value.vesselId !== 'string' || !value.vesselId.trim()) fail('invalid-argument', '船号不能为空。')
  if (typeof value.monthSortKey !== 'number' || !Number.isInteger(value.monthSortKey) || value.monthSortKey < 200001 || value.monthSortKey % 100 < 1 || value.monthSortKey % 100 > 12) fail('invalid-argument', '月份无效。')
  if (typeof value.clientOperationId !== 'string' || value.clientOperationId.length < 8 || value.clientOperationId.length > 120) fail('invalid-argument', '操作编号无效。')
  if (value.expectedRevision !== undefined && (typeof value.expectedRevision !== 'number' || !Number.isInteger(value.expectedRevision) || value.expectedRevision < 1)) fail('invalid-argument', '版本号无效。')
  if (value.reason !== undefined && (typeof value.reason !== 'string' || value.reason.trim().length > 500)) fail('invalid-argument', '原因格式无效。')
  return value as CallableInput
}

function requireSettlementAdministrator(request: CallableRequest<unknown>): string {
  const auth = request.auth
  if (!auth) throw new HttpsError('unauthenticated', '请先登录。')
  // No client-side role fallback: production access must be explicitly provisioned as this custom claim.
  if (auth.token.ccmAdmin !== true) fail('permission-denied', '当前用户没有冰工月结授权。')
  return auth.uid
}

function confirmedTimestampMillis(value: unknown): number {
  if (!(value instanceof Timestamp)) throw new HttpsError('failed-precondition', '已确认冰工记录缺少确认时间。')
  return value.toMillis()
}

export function calculateIceWorkRecord(id: string, data: DocumentData, vesselId: string, monthSortKey: number) {
  if (data.vesselId !== vesselId || data.monthSortKey !== monthSortKey || data.monthKey !== monthKeyFromMonthSortKey(monthSortKey) || data.status !== 'confirmed' || data.voided === true) fail('failed-precondition', `冰工记录 ${id} 不符合月结条件。`)
  const factoryIncomingWeightGrams = nonNegativeInteger(data.factoryIncomingWeightGrams, '木斑什重量')
  const iceBoxHalfUnits = nonNegativeInteger(data.iceBoxHalfUnits, '冰箱数量')
  const dieselVolumeMilliliters = nonNegativeInteger(data.dieselVolumeMilliliters, '柴油数量')
  const hawkerSaleWeightGrams = nonNegativeInteger(data.hawkerSaleWeightGrams, '小贩重量')
  const directIceBarCount = nonNegativeInteger(data.directIceBarCount, '买冰数量')
  const plasticBagCount = nonNegativeInteger(data.plasticBagCount, '塑料袋数量')
  if (data.factoryIncomingRateCentsPerKg !== rates.factory || data.iceBoxRateCentsPerHalfUnit !== rates.iceBoxHalf || data.dieselRateCentsPerLiter !== rates.diesel || data.hawkerSaleRateCentsPerKg !== rates.hawker || data.directIceRateCentsPerBar !== rates.directIce || data.plasticBagRateCentsEach !== rates.bag) fail('failed-precondition', `冰工记录 ${id} 的单价无效。`)
  const factoryIncomingAmountCents = roundedCents(factoryIncomingWeightGrams, rates.factory, '木斑什金额')
  const iceBoxAmountCents = multipliedCents(iceBoxHalfUnits, rates.iceBoxHalf, '冰箱金额')
  const dieselAmountCents = roundedCents(dieselVolumeMilliliters, rates.diesel, '柴油金额')
  const hawkerSaleAmountCents = roundedCents(hawkerSaleWeightGrams, rates.hawker, '小贩金额')
  const directIceAmountCents = multipliedCents(directIceBarCount, rates.directIce, '买冰金额')
  const plasticBagAmountCents = multipliedCents(plasticBagCount, rates.bag, '塑料袋金额')
  const workFeeSubtotalCents = sumCents('工钱小计', factoryIncomingAmountCents, iceBoxAmountCents, dieselAmountCents, hawkerSaleAmountCents)
  const materialSubtotalCents = sumCents('材料小计', directIceAmountCents, plasticBagAmountCents)
  const recordTotalCents = sumCents('记录总额', workFeeSubtotalCents, materialSubtotalCents)
  if (data.factoryIncomingAmountCents !== factoryIncomingAmountCents || data.iceBoxAmountCents !== iceBoxAmountCents || data.dieselAmountCents !== dieselAmountCents || data.hawkerSaleAmountCents !== hawkerSaleAmountCents || data.directIceAmountCents !== directIceAmountCents || data.plasticBagAmountCents !== plasticBagAmountCents || data.workFeeSubtotalCents !== workFeeSubtotalCents || data.materialSubtotalCents !== materialSubtotalCents || data.recordTotalCents !== recordTotalCents || typeof data.revision !== 'number' || !Number.isInteger(data.revision) || data.revision < 1) fail('failed-precondition', `冰工记录 ${id} 的金额或版本不一致。`)
  return { factoryIncomingAmountCents, iceBoxAmountCents, dieselAmountCents, hawkerSaleAmountCents, directIceAmountCents, plasticBagAmountCents, workFeeSubtotalCents, materialSubtotalCents, recordTotalCents, hashPart: `${id}|${data.revision}|${recordTotalCents}|${confirmedTimestampMillis(data.confirmedAt)}` }
}

export function summarizeIceWorkRecords(records: Array<{ id: string; data: DocumentData }>, vesselId: string, monthSortKey: number): Summary {
  const totals = { validRecordCount: 0, factoryIncomingAmountCents: 0, iceBoxAmountCents: 0, dieselAmountCents: 0, hawkerSaleAmountCents: 0, directIceAmountCents: 0, plasticBagAmountCents: 0, workFeeSubtotalCents: 0, materialSubtotalCents: 0, recordsTotalCents: 0 }
  const hashParts: string[] = []
  for (const record of records) {
    const calculated = calculateIceWorkRecord(record.id, record.data, vesselId, monthSortKey)
    totals.validRecordCount += 1
    totals.factoryIncomingAmountCents = sumCents('月结木斑什金额', totals.factoryIncomingAmountCents, calculated.factoryIncomingAmountCents)
    totals.iceBoxAmountCents = sumCents('月结冰箱金额', totals.iceBoxAmountCents, calculated.iceBoxAmountCents)
    totals.dieselAmountCents = sumCents('月结柴油金额', totals.dieselAmountCents, calculated.dieselAmountCents)
    totals.hawkerSaleAmountCents = sumCents('月结小贩金额', totals.hawkerSaleAmountCents, calculated.hawkerSaleAmountCents)
    totals.directIceAmountCents = sumCents('月结买冰金额', totals.directIceAmountCents, calculated.directIceAmountCents)
    totals.plasticBagAmountCents = sumCents('月结塑料袋金额', totals.plasticBagAmountCents, calculated.plasticBagAmountCents)
    totals.workFeeSubtotalCents = sumCents('月结工钱小计', totals.workFeeSubtotalCents, calculated.workFeeSubtotalCents)
    totals.materialSubtotalCents = sumCents('月结材料小计', totals.materialSubtotalCents, calculated.materialSubtotalCents)
    totals.recordsTotalCents = sumCents('月结记录总额', totals.recordsTotalCents, calculated.recordTotalCents)
    hashParts.push(calculated.hashPart)
  }
  const sourceRecordsHash = createHash('sha256').update(hashParts.sort().join('\n')).digest('hex')
  return { ...totals, headmanFeeCents: rates.headman, clerkFeeCents: rates.clerk, finalTotalCents: sumCents('月结最终总额', totals.recordsTotalCents, rates.headman, rates.clerk), sourceRecordsHash, sourceRecordCount: totals.validRecordCount }
}

async function readTrustedSummary(tx: FirebaseFirestore.Transaction, vesselId: string, monthSortKey: number): Promise<Summary> {
  const query = db.collection('iceWorkRecords').where('vesselId', '==', vesselId).where('monthSortKey', '==', monthSortKey).where('status', '==', 'confirmed')
  const records = await tx.get(query)
  return summarizeIceWorkRecords(records.docs.filter(record => record.data().voided !== true).map(record => ({ id: record.id, data: record.data() })), vesselId, monthSortKey)
}

function resultFor(settlementId: string, data: DocumentData) {
  return { settlementId, status: String(data.status), revision: Number(data.revision), finalTotalCents: Number(data.finalTotalCents), sourceRecordCount: Number(data.sourceRecordCount), sourceRecordsHash: String(data.sourceRecordsHash) }
}

async function mutateSettlement(request: CallableRequest<unknown>, operation: Operation) {
  const uid = requireSettlementAdministrator(request)
  const input = validateIceWorkSettlementInput(request.data)
  const settlementId = `${input.vesselId}_${input.monthSortKey}`
  const settlementRef = db.collection('iceWorkMonthlySettlements').doc(settlementId)
  const actionRef = settlementRef.collection('actions').doc(input.clientOperationId)
  return db.runTransaction(async tx => {
    const existingAction = await tx.get(actionRef)
    if (existingAction.exists) {
      const prior = existingAction.data()!
      if (prior.type !== operation || prior.settlementId !== settlementId || prior.clientOperationId !== input.clientOperationId || prior.performedBy !== uid || prior.expectedRevision !== (input.expectedRevision ?? null)) fail('aborted', '操作编号已用于另一项月结操作。')
      return prior.result
    }
    const vessel = await tx.get(db.collection('vessels').doc(input.vesselId))
    if (!vessel.exists) fail('not-found', '找不到船号。')
    const existing = await tx.get(settlementRef)
    const before = existing.exists ? existing.data()! : null
    if (input.expectedRevision !== undefined && before?.revision !== input.expectedRevision) fail('aborted', '月结已被其他操作更新，请重新载入。')
    if ((operation === 'reopen' || operation === 'void') && (!input.reason || input.reason.trim().length < 2)) fail('invalid-argument', '请填写至少两个字的原因。')
    if ((operation === 'confirm' || operation === 'reopen' || operation === 'void') && !before) fail('not-found', '找不到月结。')
    if (operation === 'rebuild' && before && !['draft', 'reopened'].includes(String(before.status))) fail('failed-precondition', '已确认或已作废月结不能直接重新计算。')
    if (operation === 'confirm' && !['draft', 'reopened'].includes(String(before!.status))) fail('failed-precondition', '只有草稿或已重新打开的月结可以确认。')
    if (operation === 'reopen' && before!.status !== 'confirmed') fail('failed-precondition', '只有已确认月结可以重新打开。')
    if (operation === 'void' && before!.status === 'voided') fail('failed-precondition', '该月结已经作废。')

    // Reopen and void preserve the confirmed financial snapshot; rebuild and confirm re-read it in this transaction.
    const summary = operation === 'reopen' || operation === 'void' ? null : await readTrustedSummary(tx, input.vesselId, input.monthSortKey)
    const revision = Number(before?.revision ?? 0) + 1
    const status = operation === 'confirm' ? 'confirmed' : operation === 'reopen' ? 'reopened' : operation === 'void' ? 'voided' : (before?.status === 'reopened' ? 'reopened' : 'draft')
    const next: DocumentData = {
      ...before,
      vesselId: input.vesselId,
      vesselCodeSnapshot: summary ? String(vessel.data()?.vesselCode ?? '') : String(before?.vesselCodeSnapshot ?? vessel.data()?.vesselCode ?? ''),
      monthKey: monthKeyFromMonthSortKey(input.monthSortKey),
      monthSortKey: input.monthSortKey,
      ...(summary ?? {}),
      status,
      revision,
      calculatedAt: summary ? FieldValue.serverTimestamp() : before?.calculatedAt,
      calculatedBy: summary ? uid : before?.calculatedBy,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid,
      lastActionId: input.clientOperationId,
      ...(before ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: uid }),
      ...(operation === 'confirm' ? { confirmedAt: FieldValue.serverTimestamp(), confirmedBy: uid } : {}),
      ...(operation === 'reopen' ? { reopenedAt: FieldValue.serverTimestamp(), reopenedBy: uid, reopenReason: input.reason!.trim() } : {}),
      ...(operation === 'void' ? { voidedAt: FieldValue.serverTimestamp(), voidedBy: uid, voidReason: input.reason!.trim() } : {}),
    }
    const result = resultFor(settlementId, next)
    tx.set(settlementRef, next)
    tx.set(actionRef, { type: operation, settlementId, clientOperationId: input.clientOperationId, expectedRevision: input.expectedRevision ?? null, performedBy: uid, performedAt: FieldValue.serverTimestamp(), reason: input.reason?.trim() ?? null, beforeSnapshot: before, afterSnapshot: result, revision, result })
    return result
  })
}

async function checkSource(request: CallableRequest<unknown>) {
  requireSettlementAdministrator(request)
  const input = validateIceWorkSettlementInput(request.data)
  const settlementId = `${input.vesselId}_${input.monthSortKey}`
  return db.runTransaction(async tx => {
    const settlement = await tx.get(db.collection('iceWorkMonthlySettlements').doc(settlementId))
    if (!settlement.exists) fail('not-found', '找不到月结。')
    const summary = await readTrustedSummary(tx, input.vesselId, input.monthSortKey)
    return { settlementId, sourceRecordCount: summary.sourceRecordCount, sourceRecordsHash: summary.sourceRecordsHash, sourceChanged: settlement.data()!.status === 'confirmed' && settlement.data()!.sourceRecordsHash !== summary.sourceRecordsHash }
  })
}

export const rebuildIceWorkMonthlySettlement = onCall({ region: ICE_WORK_FUNCTION_REGION }, request => mutateSettlement(request, 'rebuild'))
export const confirmIceWorkMonthlySettlement = onCall({ region: ICE_WORK_FUNCTION_REGION }, request => mutateSettlement(request, 'confirm'))
export const reopenIceWorkMonthlySettlement = onCall({ region: ICE_WORK_FUNCTION_REGION }, request => mutateSettlement(request, 'reopen'))
export const voidIceWorkMonthlySettlement = onCall({ region: ICE_WORK_FUNCTION_REGION }, request => mutateSettlement(request, 'void'))
export const checkIceWorkMonthlySettlementSource = onCall({ region: ICE_WORK_FUNCTION_REGION }, checkSource)
