import { asSettlementSourceEntry, buildPurchaseSettlementLines } from './purchaseSettlement'
import type { WeighingEntry } from './weighing'

export interface FishHeadLiveValuationRow {
  nameSnapshot:string
  basketCount:number
  totalWeightGrams:number
  defaultUnitPriceCentsPerKg:number|null
  amountCents:number|null
  sourceEntryIds:string[]
}

export interface FishHeadLiveValuation {
  rows:FishHeadLiveValuationRow[]
  basketCount:number
  totalWeightGrams:number
  knownAmountCents:number
  missingPriceSpeciesCount:number
}

/** Read-only preview: settlement owns grouping, default prices and half-up amounts. */
export function buildFishHeadLiveValuation(entries:WeighingEntry[], vesselCode:string):FishHeadLiveValuation {
  const rows = buildPurchaseSettlementLines(entries.map(asSettlementSourceEntry), 'fish_head', vesselCode).map(line => ({
    nameSnapshot:line.nameSnapshot,
    basketCount:line.basketCount,
    totalWeightGrams:line.totalWeightGrams,
    defaultUnitPriceCentsPerKg:line.defaultUnitPriceCentsPerKg,
    amountCents:line.defaultUnitPriceCentsPerKg === null ? null : line.amountCents,
    sourceEntryIds:line.sourceEntryIds,
  }))
  return {
    rows,
    basketCount:rows.reduce((sum, row) => sum + row.basketCount, 0),
    totalWeightGrams:rows.reduce((sum, row) => sum + row.totalWeightGrams, 0),
    knownAmountCents:rows.reduce((sum, row) => sum + (row.amountCents ?? 0), 0),
    missingPriceSpeciesCount:rows.filter(row => row.defaultUnitPriceCentsPerKg === null).length,
  }
}
