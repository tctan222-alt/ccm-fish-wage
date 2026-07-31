import { assertBusinessDate, monthKeyFromBusinessDate, monthSortKeyFromMonthKey, sortKeyFromBusinessDate } from './businessDate'

export type IceWorkStatus = 'draft' | 'confirmed' | 'reopened' | 'voided'
export type IceWorkActionType = 'create' | 'update' | 'confirm' | 'reopen' | 'void'
export type IceWorkSettlementActionType = 'create' | 'confirm' | 'reopen' | 'recalculate' | 'void'

export const FACTORY_INCOMING_RATE_CENTS_PER_KG = 10
export const ICE_BOX_RATE_CENTS_PER_FULL_BOX = 3_000
export const ICE_BOX_RATE_CENTS_PER_HALF_UNIT = 1_500
export const DIESEL_RATE_CENTS_PER_LITER = 2
export const HAWKER_SALE_RATE_CENTS_PER_KG = 30
export const DIRECT_ICE_RATE_CENTS_PER_BAR = 1_350
export const PLASTIC_BAG_RATE_CENTS_EACH = 140
export const MONTHLY_HEADMAN_FEE_CENTS = 50_000
export const MONTHLY_CLERK_FEE_CENTS = 25_000

export interface IceWorkRecord {
  id: string; workDate: string; dateSortKey: number; monthKey: string; monthSortKey: number
  vesselId: string; vesselCodeSnapshot: string; vesselNameSnapshot: string
  factoryIncomingWeightGrams: number; factoryIncomingRateCentsPerKg: number; factoryIncomingAmountCents: number
  iceBoxHalfUnits: number; iceBoxRateCentsPerFullBox: number; iceBoxRateCentsPerHalfUnit: number; iceBoxAmountCents: number
  dieselVolumeMilliliters: number; dieselRateCentsPerLiter: number; dieselAmountCents: number
  hawkerSaleWeightGrams: number; hawkerSaleRateCentsPerKg: number; hawkerSaleAmountCents: number
  directIceBarCount: number; directIceRateCentsPerBar: number; directIceAmountCents: number
  plasticBagCount: number; plasticBagRateCentsEach: number; plasticBagAmountCents: number
  workFeeSubtotalCents: number; materialSubtotalCents: number; recordTotalCents: number; notes: string
  status: IceWorkStatus; revision: number; createdBy: string; createdAt?: unknown; updatedBy?: string; updatedAt?: unknown
  lastActionId?: string
  confirmedBy?: string | null; confirmedAt?: unknown | null; reopenedBy?: string | null; reopenedAt?: unknown | null; reopenReason?: string | null
  voided: boolean; voidReason: string | null; voidedBy: string | null; voidedAt?: unknown | null
}

export interface IceWorkMonthlySettlement {
  id: string; vesselId: string; vesselCodeSnapshot: string; monthKey: string; monthSortKey: number
  validRecordCount: number; factoryIncomingAmountCents: number; iceBoxAmountCents: number; dieselAmountCents: number; hawkerSaleAmountCents: number
  directIceAmountCents: number; plasticBagAmountCents: number; workFeeSubtotalCents: number; materialSubtotalCents: number; recordsTotalCents: number
  headmanFeeCents: number; clerkFeeCents: number; finalTotalCents: number; status: IceWorkStatus; revision: number
  sourceRecordsHash?: string; sourceRecordCount?: number; calculatedAt?: unknown; calculatedBy?: string
  createdBy: string; createdAt?: unknown; updatedBy?: string; updatedAt?: unknown; confirmedBy?: string | null; confirmedAt?: unknown | null
  lastActionId?: string
  reopenedBy?: string | null; reopenedAt?: unknown | null; reopenReason?: string | null; voidedBy?: string | null; voidedAt?: unknown | null; voidReason?: string | null
}

export interface IceWorkAction { type: IceWorkActionType; recordId: string; reason: string | null; performedBy: string; performedAt?: unknown; beforeSnapshot: unknown | null; afterSnapshot: unknown; revision: number; clientOperationId: string }
export interface IceWorkSettlementAction { type: IceWorkSettlementActionType; settlementId: string; reason: string | null; performedBy: string; performedAt?: unknown; beforeSnapshot: unknown | null; afterSnapshot: unknown; revision: number; clientOperationId: string }

type RecordInput = Pick<IceWorkRecord, 'id' | 'workDate' | 'vesselId' | 'vesselCodeSnapshot' | 'createdBy'> & Partial<Pick<IceWorkRecord,
  'vesselNameSnapshot' | 'factoryIncomingWeightGrams' | 'iceBoxHalfUnits' | 'dieselVolumeMilliliters' | 'hawkerSaleWeightGrams' | 'directIceBarCount' | 'plasticBagCount' | 'notes'>>

function nonNegativeInteger(value: number | undefined, label: string): number {
  const numeric = value ?? 0
  if (!Number.isInteger(numeric) || numeric < 0) throw new Error(`${label}必须是非负整数。`)
  return numeric
}

export function halfUpPerThousand(quantity: number, rateCents: number): number {
  return Math.floor((quantity * rateCents + 500) / 1_000)
}

export function parseKgToGrams(value: string): number {
  const clean = value.trim()
  if (clean === '') return 0
  if (!/^\d+(?:\.\d{1,3})?$/.test(clean)) throw new Error('重量最多只能输入三位小数。')
  const [whole, fraction = ''] = clean.split('.')
  return Number(whole) * 1_000 + Number(fraction.padEnd(3, '0'))
}

export function parseLitersToMilliliters(value: string): number { return parseKgToGrams(value) }

export function parseIceBoxHalfUnits(value: string): number {
  const clean = value.trim()
  if (clean === '') return 0
  if (!/^\d+(?:\.5)?$/.test(clean)) throw new Error('冰箱子数量只能输入整箱或半箱。')
  return clean.includes('.') ? Number(clean.slice(0, -2)) * 2 + 1 : Number(clean) * 2
}

export function iceWorkSettlementId(vesselId: string, monthKey: string): string {
  return `${vesselId}_${monthSortKeyFromMonthKey(monthKey)}`
}

export function createIceWorkRecord(input: RecordInput): IceWorkRecord {
  const workDate = assertBusinessDate(input.workDate) && input.workDate
  const factoryIncomingWeightGrams = nonNegativeInteger(input.factoryIncomingWeightGrams, '木斑什进厂重量')
  const iceBoxHalfUnits = nonNegativeInteger(input.iceBoxHalfUnits, '冰箱子数量')
  const dieselVolumeMilliliters = nonNegativeInteger(input.dieselVolumeMilliliters, '柴油数量')
  const hawkerSaleWeightGrams = nonNegativeInteger(input.hawkerSaleWeightGrams, '小贩重量')
  const directIceBarCount = nonNegativeInteger(input.directIceBarCount, '直接买冰数量')
  const plasticBagCount = nonNegativeInteger(input.plasticBagCount, '塑料袋数量')
  const factoryIncomingAmountCents = halfUpPerThousand(factoryIncomingWeightGrams, FACTORY_INCOMING_RATE_CENTS_PER_KG)
  const iceBoxAmountCents = iceBoxHalfUnits * ICE_BOX_RATE_CENTS_PER_HALF_UNIT
  const dieselAmountCents = halfUpPerThousand(dieselVolumeMilliliters, DIESEL_RATE_CENTS_PER_LITER)
  const hawkerSaleAmountCents = halfUpPerThousand(hawkerSaleWeightGrams, HAWKER_SALE_RATE_CENTS_PER_KG)
  const directIceAmountCents = directIceBarCount * DIRECT_ICE_RATE_CENTS_PER_BAR
  const plasticBagAmountCents = plasticBagCount * PLASTIC_BAG_RATE_CENTS_EACH
  const workFeeSubtotalCents = factoryIncomingAmountCents + iceBoxAmountCents + dieselAmountCents + hawkerSaleAmountCents
  const materialSubtotalCents = directIceAmountCents + plasticBagAmountCents
  return {
    id: input.id, workDate, dateSortKey: sortKeyFromBusinessDate(workDate), monthKey: monthKeyFromBusinessDate(workDate), monthSortKey: monthSortKeyFromMonthKey(monthKeyFromBusinessDate(workDate)),
    vesselId: input.vesselId, vesselCodeSnapshot: input.vesselCodeSnapshot, vesselNameSnapshot: input.vesselNameSnapshot ?? input.vesselCodeSnapshot,
    factoryIncomingWeightGrams, factoryIncomingRateCentsPerKg: FACTORY_INCOMING_RATE_CENTS_PER_KG, factoryIncomingAmountCents,
    iceBoxHalfUnits, iceBoxRateCentsPerFullBox: ICE_BOX_RATE_CENTS_PER_FULL_BOX, iceBoxRateCentsPerHalfUnit: ICE_BOX_RATE_CENTS_PER_HALF_UNIT, iceBoxAmountCents,
    dieselVolumeMilliliters, dieselRateCentsPerLiter: DIESEL_RATE_CENTS_PER_LITER, dieselAmountCents,
    hawkerSaleWeightGrams, hawkerSaleRateCentsPerKg: HAWKER_SALE_RATE_CENTS_PER_KG, hawkerSaleAmountCents,
    directIceBarCount, directIceRateCentsPerBar: DIRECT_ICE_RATE_CENTS_PER_BAR, directIceAmountCents,
    plasticBagCount, plasticBagRateCentsEach: PLASTIC_BAG_RATE_CENTS_EACH, plasticBagAmountCents,
    workFeeSubtotalCents, materialSubtotalCents, recordTotalCents: workFeeSubtotalCents + materialSubtotalCents, notes: input.notes?.trim() ?? '',
    status: 'draft', revision: 1, createdBy: input.createdBy, confirmedBy: null, confirmedAt: null, reopenedBy: null, reopenedAt: null, reopenReason: null,
    voided: false, voidReason: null, voidedBy: null, voidedAt: null,
  }
}

export function confirmIceWorkRecord(record: IceWorkRecord, userId: string): IceWorkRecord {
  if (record.status !== 'draft' && record.status !== 'reopened') throw new Error('只有草稿或重新打开的记录可以确认。')
  return { ...record, status: 'confirmed', revision: record.revision + 1, confirmedBy: userId }
}

export function reopenIceWorkRecord(record: IceWorkRecord, reason: string, userId: string): IceWorkRecord {
  const clean = reason.trim()
  if (record.status !== 'confirmed') throw new Error('只有已确认记录可以重新打开。')
  if (clean.length < 2) throw new Error('重新打开原因至少需要两个字。')
  return { ...record, status: 'reopened', revision: record.revision + 1, reopenedBy: userId, reopenReason: clean }
}

export function reviseIceWorkRecord(record: IceWorkRecord, changes: Partial<Pick<IceWorkRecord,
  'factoryIncomingWeightGrams' | 'iceBoxHalfUnits' | 'dieselVolumeMilliliters' | 'hawkerSaleWeightGrams' | 'directIceBarCount' | 'plasticBagCount' | 'notes'>>, userId: string): IceWorkRecord {
  if (record.status !== 'draft' && record.status !== 'reopened') throw new Error('已确认记录必须先重新打开才能修改。')
  const recalculated=createIceWorkRecord({...record,...changes,createdBy:record.createdBy})
  return {...recalculated,status:record.status,revision:record.revision+1,createdAt:record.createdAt,updatedBy:userId,confirmedBy:record.confirmedBy,confirmedAt:record.confirmedAt,reopenedBy:record.reopenedBy,reopenedAt:record.reopenedAt,reopenReason:record.reopenReason}
}

export function softVoidIceWorkRecord(record: IceWorkRecord, reason: string, userId: string): IceWorkRecord {
  const clean = reason.trim()
  if (record.status === 'voided' || record.voided) throw new Error('该冰工记录已作废。')
  if (clean.length < 2) throw new Error('作废原因至少需要两个字。')
  return { ...record, status: 'voided', revision: record.revision + 1, voided: true, voidReason: clean, voidedBy: userId }
}

export function summarizeIceWorkMonth(records: IceWorkRecord[]) {
  const included = records.filter(record => record.status === 'confirmed' && !record.voided)
  const total = <K extends keyof IceWorkRecord>(key: K) => included.reduce((sum, item) => sum + Number(item[key] ?? 0), 0)
  const factoryIncomingAmountCents = total('factoryIncomingAmountCents'), iceBoxAmountCents = total('iceBoxAmountCents')
  const dieselAmountCents = total('dieselAmountCents'), hawkerSaleAmountCents = total('hawkerSaleAmountCents')
  const directIceAmountCents = total('directIceAmountCents'), plasticBagAmountCents = total('plasticBagAmountCents')
  return { validRecordCount: included.length, factoryIncomingAmountCents, iceBoxAmountCents, dieselAmountCents, hawkerSaleAmountCents, directIceAmountCents, plasticBagAmountCents,
    workFeeSubtotalCents: factoryIncomingAmountCents + iceBoxAmountCents + dieselAmountCents + hawkerSaleAmountCents,
    materialSubtotalCents: directIceAmountCents + plasticBagAmountCents,
    recordsTotalCents: total('recordTotalCents') }
}

export function createIceWorkSettlement(input: Pick<IceWorkMonthlySettlement, 'vesselId' | 'vesselCodeSnapshot' | 'monthKey' | 'createdBy'> & { records: IceWorkRecord[] }): IceWorkMonthlySettlement {
  const totals = summarizeIceWorkMonth(input.records)
  const monthSortKey = monthSortKeyFromMonthKey(input.monthKey)
  return { id: iceWorkSettlementId(input.vesselId, input.monthKey), vesselId: input.vesselId, vesselCodeSnapshot: input.vesselCodeSnapshot, monthKey: input.monthKey, monthSortKey,
    ...totals, headmanFeeCents: MONTHLY_HEADMAN_FEE_CENTS, clerkFeeCents: MONTHLY_CLERK_FEE_CENTS,
    finalTotalCents: totals.recordsTotalCents + MONTHLY_HEADMAN_FEE_CENTS + MONTHLY_CLERK_FEE_CENTS, status: 'draft', revision: 1,
    createdBy: input.createdBy, confirmedBy: null, confirmedAt: null, reopenedBy: null, reopenedAt: null, reopenReason: null, voidedBy: null, voidedAt: null, voidReason: null }
}

export function createIceWorkAction(type: IceWorkActionType, record: IceWorkRecord, performedBy: string, beforeSnapshot: unknown | null, clientOperationId: string, reason: string | null = null): IceWorkAction {
  const operationId = clientOperationId.trim()
  if (!operationId) throw new Error('操作编号不能为空。')
  return { type, recordId: record.id, reason, performedBy, beforeSnapshot, afterSnapshot: record, revision: record.revision, clientOperationId: operationId }
}

export function createIceWorkSettlementAction(type: IceWorkSettlementActionType, settlement: IceWorkMonthlySettlement, performedBy: string, beforeSnapshot: unknown | null, clientOperationId: string, reason: string | null = null): IceWorkSettlementAction {
  const operationId = clientOperationId.trim()
  if (!operationId) throw new Error('操作编号不能为空。')
  return { type, settlementId: settlement.id, reason, performedBy, beforeSnapshot, afterSnapshot: settlement, revision: settlement.revision, clientOperationId: operationId }
}

export function confirmIceWorkSettlement(settlement: IceWorkMonthlySettlement, userId: string): IceWorkMonthlySettlement {
  if (settlement.status !== 'draft' && settlement.status !== 'reopened') throw new Error('只有草稿或重新打开的月结可以确认。')
  return {...settlement,status:'confirmed',revision:settlement.revision+1,confirmedBy:userId}
}
export function reopenIceWorkSettlement(settlement: IceWorkMonthlySettlement, reason: string, userId: string): IceWorkMonthlySettlement {
  const clean=reason.trim()
  if (settlement.status !== 'confirmed') throw new Error('只有已确认月结可以重新打开。')
  if (clean.length<2) throw new Error('重新打开原因至少需要两个字。')
  return {...settlement,status:'reopened',revision:settlement.revision+1,reopenedBy:userId,reopenReason:clean}
}
export function voidIceWorkSettlement(settlement: IceWorkMonthlySettlement, reason: string, userId: string): IceWorkMonthlySettlement {
  const clean=reason.trim()
  if (settlement.status === 'voided') throw new Error('该月结已作废。')
  if (clean.length<2) throw new Error('作废原因至少需要两个字。')
  return {...settlement,status:'voided',revision:settlement.revision+1,voidedBy:userId,voidReason:clean}
}

// Compatibility helper for older callers. Fixed fees now belong only to monthly settlements.
export function summarizeIceMonthEndFees(_records: IceWorkRecord[]) { return { headmanFeeCents: 0, clerkFeeCents: 0, recordId: null } }
export const iceWorkMonthClosingId = iceWorkSettlementId
