import { asSettlementSourceEntry, buildPurchaseSettlementLines, settlementLineIdentity } from './purchaseSettlement'
import { lineAmountCents } from './purchasing'
import type { FishHeadLivePriceDraft } from './fishHeadLivePriceDraft'
import type { FishSpeciesRecord, WeighingEntry } from './weighing'

export interface FishHeadLiveValuationRow {
  nameSnapshot:string
  basketCount:number
  totalWeightGrams:number
  defaultUnitPriceCentsPerKg:number|null
  /** Only present when the operator has locally edited the session price. */
  unitPriceCentsPerKg?:number|null
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

/** Instant local estimate; existing settlement/receipt prices are never rewritten here. */
export function buildFishHeadLiveValuation(entries:WeighingEntry[], vesselCode:string, masterSpecies:readonly FishSpeciesRecord[]=[], priceOverrides:FishHeadLivePriceDraft={}):FishHeadLiveValuation {
  const rows = buildPurchaseSettlementLines(entries.map(asSettlementSourceEntry), 'fish_head', vesselCode, masterSpecies).map(line => {
    const identity=settlementLineIdentity(line)
    const overridden=Object.prototype.hasOwnProperty.call(priceOverrides,identity)
    const price=overridden?priceOverrides[identity]:line.defaultUnitPriceCentsPerKg
    const amount=price===null?null:overridden?lineAmountCents(line.totalWeightGrams,price):line.amountCents
    return {
      nameSnapshot:line.nameSnapshot,
      basketCount:line.basketCount,
      totalWeightGrams:line.totalWeightGrams,
      defaultUnitPriceCentsPerKg:line.defaultUnitPriceCentsPerKg,
      ...(overridden?{unitPriceCentsPerKg:price}:{}),
      amountCents:amount,
      sourceEntryIds:line.sourceEntryIds,
    }
  })
  return {
    rows,
    basketCount:rows.reduce((sum, row) => sum + row.basketCount, 0),
    totalWeightGrams:rows.reduce((sum, row) => sum + row.totalWeightGrams, 0),
    knownAmountCents:rows.reduce((sum, row) => sum + (row.amountCents ?? 0), 0),
    missingPriceSpeciesCount:rows.filter(row => row.amountCents === null).length,
  }
}
