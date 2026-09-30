import { describe, expect, it } from 'vitest'
import { buildFishHeadLiveValuation } from './fishHeadLiveValuation'
import { asSettlementSourceEntry, buildPurchaseSettlementLines } from './purchaseSettlement'
import type { WeighingEntry } from './weighing'

const entry = (overrides:Partial<WeighingEntry> = {}):WeighingEntry => ({
  id:'entry-1',clientEntryId:'entry-1',sessionId:'session-1',productType:'fish_head',
  fishSpeciesId:'jin_xian',fishSpeciesCodeSnapshot:'jin_xian',fishSpeciesNameSnapshot:'金线',
  fishMealQuality:null,displayNameSnapshot:'金线',entryMode:'individual',sequenceNo:1,
  weightGrams:160_500,remark:'',recordedAtClient:'2026-09-30T10:00:00+08:00',recordedAt:null,
  recordedBy:'u1',syncStatus:'synced',voided:false,voidReason:null,revision:1,...overrides,
})

const otherFish = (overrides:Partial<WeighingEntry> = {}):WeighingEntry => entry({
  id:'entry-2',clientEntryId:'entry-2',sequenceNo:2,fishSpeciesId:'lai_ge',
  fishSpeciesCodeSnapshot:'lai_ge',fishSpeciesNameSnapshot:'来戈',displayNameSnapshot:'来戈',
  weightGrams:10_000,...overrides,
})

describe('fish-head live valuation', () => {
  it('starts with an empty preview and zero totals', () => {
    expect(buildFishHeadLiveValuation([], '833')).toEqual({
      rows:[],basketCount:0,totalWeightGrams:0,knownAmountCents:0,missingPriceSpeciesCount:0,
    })
  })

  it.each([
    ['833',205,32_903],
    ['978',210,33_705],
    ['5202',210,33_705],
    ['1785',205,32_903],
  ])('uses the default fish-head price for vessel %s with half-up cents', (vesselCode, price, amount) => {
    const result = buildFishHeadLiveValuation([entry()], vesselCode)
    expect(result.rows).toEqual([{
      nameSnapshot:'金线',basketCount:1,totalWeightGrams:160_500,
      defaultUnitPriceCentsPerKg:price,amountCents:amount,sourceEntryIds:['entry-1'],
    }])
    expect(result).toMatchObject({
      basketCount:1,totalWeightGrams:160_500,knownAmountCents:amount,missingPriceSpeciesCount:0,
    })
  })

  it('aggregates multiple baskets of the same fish before rounding once', () => {
    const result = buildFishHeadLiveValuation([
      entry({weightGrams:100}),entry({id:'entry-2',sequenceNo:2,weightGrams:100}),
    ], '833')
    expect(result.rows).toEqual([{
      nameSnapshot:'金线',basketCount:2,totalWeightGrams:200,
      defaultUnitPriceCentsPerKg:205,amountCents:41,sourceEntryIds:['entry-1','entry-2'],
    }])
    expect(result.knownAmountCents).toBe(41)
  })

  it('sums species totals without mixing their prices', () => {
    const result = buildFishHeadLiveValuation([entry({weightGrams:1_000}),otherFish()], '833')
    expect(result.rows.map(row => [row.nameSnapshot,row.defaultUnitPriceCentsPerKg,row.amountCents])).toEqual([
      ['金线',205,205],['来戈',245,2_450],
    ])
    expect(result).toMatchObject({basketCount:2,totalWeightGrams:11_000,knownAmountCents:2_655,missingPriceSpeciesCount:0})
  })

  it('keeps unpriced fish visible with null price and amount while summing only known amounts', () => {
    const unknown = otherFish({fishSpeciesId:'unknown',fishSpeciesCodeSnapshot:'unknown',
      fishSpeciesNameSnapshot:'未定价鱼',displayNameSnapshot:'未定价鱼'})
    const result = buildFishHeadLiveValuation([
      entry({weightGrams:1_000}),unknown,{...unknown,id:'entry-3',sequenceNo:3,weightGrams:5_000},
    ], '978')
    expect(result.rows[1]).toEqual({
      nameSnapshot:'未定价鱼',basketCount:2,totalWeightGrams:15_000,
      defaultUnitPriceCentsPerKg:null,amountCents:null,sourceEntryIds:['entry-2','entry-3'],
    })
    expect(result).toMatchObject({basketCount:3,totalWeightGrams:16_000,knownAmountCents:210,missingPriceSpeciesCount:1})
  })

  it('counts all missing-price species even when no row has a known amount', () => {
    const result = buildFishHeadLiveValuation([
      entry({fishSpeciesCodeSnapshot:'unknown-a',displayNameSnapshot:'未定价甲'}),
      otherFish({fishSpeciesCodeSnapshot:'unknown-b',displayNameSnapshot:'未定价乙'}),
    ], '833')
    expect(result.rows.every(row => row.amountCents === null && row.defaultUnitPriceCentsPerKg === null)).toBe(true)
    expect(result).toMatchObject({basketCount:2,totalWeightGrams:170_500,knownAmountCents:0,missingPriceSpeciesCount:2})
  })

  it('excludes voided baskets and fish-meal records from every total', () => {
    const result = buildFishHeadLiveValuation([
      entry({weightGrams:1_000}),otherFish({voided:true}),
      entry({id:'meal',productType:'fish_meal',fishSpeciesId:null,fishSpeciesCodeSnapshot:null,
        fishSpeciesNameSnapshot:null,fishMealQuality:'bag',displayNameSnapshot:'包鱼仔',weightGrams:300_000}),
    ], '833')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].sourceEntryIds).toEqual(['entry-1'])
    expect(result).toMatchObject({basketCount:1,totalWeightGrams:1_000,knownAmountCents:205,missingPriceSpeciesCount:0})
  })

  it('recalculates from current entries after a basket changes or is voided', () => {
    const before = [entry({weightGrams:1_000}),otherFish()]
    expect(buildFishHeadLiveValuation(before, '833').knownAmountCents).toBe(2_655)
    const after = [{...before[0],weightGrams:2_000},{...before[1],voided:true}]
    expect(buildFishHeadLiveValuation(after, '833')).toMatchObject({
      basketCount:1,totalWeightGrams:2_000,knownAmountCents:410,missingPriceSpeciesCount:0,
    })
  })

  it('ignores legacy basket prices and amounts without modifying source entries', () => {
    const source = [Object.freeze(entry({unitPriceCentsPerKg:999,amountCents:1,weightGrams:1_000}))]
    const original = structuredClone(source)
    const result = buildFishHeadLiveValuation(source, '833')
    expect(result.rows[0]).toMatchObject({defaultUnitPriceCentsPerKg:205,amountCents:205})
    expect(source).toEqual(original)
  })

  it.each(['833','978','5202','1785'])('matches settlement grouping, default price and amount for vessel %s', vesselCode => {
    const source = [
      entry({weightGrams:80_100}),otherFish(),entry({id:'entry-3',sequenceNo:3,weightGrams:80_400}),
      otherFish({id:'entry-4',sequenceNo:4,fishSpeciesCodeSnapshot:'unknown',displayNameSnapshot:'未定价鱼'}),
    ]
    const live = buildFishHeadLiveValuation(source, vesselCode)
    const settlement = buildPurchaseSettlementLines(source.map(asSettlementSourceEntry), 'fish_head', vesselCode)
    expect(live.rows).toHaveLength(settlement.length)
    settlement.forEach((line, index) => {
      expect(live.rows[index]).toEqual({
        nameSnapshot:line.nameSnapshot,basketCount:line.basketCount,totalWeightGrams:line.totalWeightGrams,
        defaultUnitPriceCentsPerKg:line.defaultUnitPriceCentsPerKg,
        amountCents:line.defaultUnitPriceCentsPerKg === null ? null : line.amountCents,
        sourceEntryIds:line.sourceEntryIds,
      })
    })
    expect(live.knownAmountCents).toBe(settlement.reduce((sum, line) => sum + line.amountCents, 0))
  })
})
