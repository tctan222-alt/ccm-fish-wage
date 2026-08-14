import { describe, expect, it } from 'vitest'
import {
  buildPurchaseSettlementLines,
  assertValidPurchaseSettlementDraft,
  calculateSettlementLineAmount,
  makeSettlementDraft,
  parseSettlementPrice,
  updateSettlementLinePrice,
  type SettlementSourceEntry,
} from './purchaseSettlement'
import { getDefaultFishHeadPriceCents, getDefaultFishMealPriceCents } from '../features/purchases/pricing/defaultPurchasePrices'

const entry=(overrides:Partial<SettlementSourceEntry>={}):SettlementSourceEntry=>({
  id:'entry-1',productType:'fish_head',fishSpeciesId:'jin_xian',fishSpeciesCodeSnapshot:'jin_xian',
  fishSpeciesNameSnapshot:'金线',fishMealQuality:null,displayNameSnapshot:'金线',entryMode:'individual',
  sequenceNo:1,weightGrams:160_500,voided:false,recordedAtClient:'2026-08-03T10:00:00+08:00',...overrides,
})

describe('purchase settlement pricing',()=>{
  it('uses fish-head base prices and only adds the no-loan premium when a base price exists',()=>{
    expect(getDefaultFishHeadPriceCents('金线','')).toBe(205)
    expect(getDefaultFishHeadPriceCents('金线','978')).toBe(210)
    expect(getDefaultFishHeadPriceCents('金线','5202')).toBe(210)
    expect(getDefaultFishHeadPriceCents('金线','833')).toBe(205)
    expect(getDefaultFishHeadPriceCents('来戈','')).toBe(245)
    expect(getDefaultFishHeadPriceCents('来戈','978')).toBe(250)
    expect(getDefaultFishHeadPriceCents('红目林','833')).toBe(275)
    expect(getDefaultFishHeadPriceCents('乌目林','833')).toBe(160)
    expect(getDefaultFishHeadPriceCents('白竹占','833')).toBe(175)
    expect(getDefaultFishHeadPriceCents('未匹配鱼名','978')).toBeNull()
  })

  it('matches every slash alias and applies fish-meal vessel premiums',()=>{
    for(const alias of ['戈里','黄线仔','泥仔'])expect(getDefaultFishHeadPriceCents(alias,'833')).toBe(355)
    for(const alias of ['竹占','水占仔','白竹占','石头鱼','白皂','飞鱼','香鱼','米仔仔','娃娃鱼','红水占']){
      expect(getDefaultFishHeadPriceCents(alias,'833')).toBe(175)
    }
    expect(getDefaultFishMealPriceCents('bucket','')).toBe(75)
    expect(getDefaultFishMealPriceCents('bag','')).toBe(70)
    expect(getDefaultFishMealPriceCents('bucket','978')).toBe(78)
    expect(getDefaultFishMealPriceCents('bag','978')).toBe(73)
    expect(getDefaultFishMealPriceCents('bucket','1785')).toBe(78)
    expect(getDefaultFishMealPriceCents('bag','5202')).toBe(73)
    expect(getDefaultFishMealPriceCents('bag','1785')).toBe(73)
    expect(getDefaultFishMealPriceCents('bucket','833')).toBe(75)
    expect(getDefaultFishMealPriceCents('bag','2072')).toBe(70)
  })

  it('parses editable RM prices as integer cents and rejects invalid values',()=>{
    expect(parseSettlementPrice('1')).toBe(100)
    expect(parseSettlementPrice('1.2')).toBe(120)
    expect(parseSettlementPrice('1.20')).toBe(120)
    expect(parseSettlementPrice('0.80')).toBe(80)
    expect(parseSettlementPrice('.8')).toBe(80)
    expect(parseSettlementPrice('')).toBeNull()
    expect(()=>parseSettlementPrice('-1')).toThrow()
    expect(()=>parseSettlementPrice('1.2.3')).toThrow()
    expect(()=>parseSettlementPrice('1.234')).toThrow()
    expect(()=>parseSettlementPrice('abc')).toThrow()
    expect(()=>parseSettlementPrice('NaN')).toThrow()
    expect(()=>parseSettlementPrice('Infinity')).toThrow()
  })

  it('keeps fish-head and fish-meal source entries separate and counts total records without fake baskets',()=>{
    const lines=buildPurchaseSettlementLines([
      entry(),entry({id:'entry-2',sequenceNo:2,weightGrams:500}),
      entry({id:'meal-total',productType:'fish_meal',fishSpeciesId:null,fishSpeciesCodeSnapshot:null,fishSpeciesNameSnapshot:null,
        fishMealQuality:'bag',displayNameSnapshot:'包鱼仔',entryMode:'total',sequenceNo:null,weightGrams:300_000}),
      entry({id:'voided',voided:true}),
    ],'fish_head','978')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({nameSnapshot:'金线',totalWeightGrams:161_000,basketCount:2,totalWeightEntryCount:2,defaultUnitPriceCentsPerKg:210,unitPriceCentsPerKg:210,priceWasEdited:false})
    const mealLines=buildPurchaseSettlementLines([
      entry({id:'meal-total',productType:'fish_meal',fishSpeciesId:null,fishSpeciesCodeSnapshot:null,fishSpeciesNameSnapshot:null,
        fishMealQuality:'bag',displayNameSnapshot:'包鱼仔',entryMode:'total',sequenceNo:null,weightGrams:300_000}),
    ],'fish_meal','978')
    expect(mealLines[0]).toMatchObject({basketCount:0,totalWeightEntryCount:1,defaultUnitPriceCentsPerKg:73})
  })

  it('recalculates half-up amount in cents when a user edits the unit price',()=>{
    const line=buildPurchaseSettlementLines([entry()],'fish_head','833')[0]
    expect(calculateSettlementLineAmount(line)).toBe(32903)
    const edited=updateSettlementLinePrice(line,'1.20')
    expect(edited).toMatchObject({unitPriceCentsPerKg:120,priceWasEdited:true,amountCents:19260})
    expect(calculateSettlementLineAmount({...line,totalWeightGrams:1,unitPriceCentsPerKg:500})).toBe(1)
  })

  it('builds a stable draft without changing source entry facts',()=>{
    const lines=buildPurchaseSettlementLines([entry()],'fish_head','978')
    const draft=makeSettlementDraft({productType:'fish_head',businessDate:'03/08/2026',dateSortKey:20260803,monthKey:'08/2026',monthSortKey:202608,
      vesselId:'v978',vesselCodeSnapshot:'978',receiptNo:'',lines,sourceEntryIds:['entry-1'],createdBy:'u1'})
    expect(draft).toMatchObject({status:'settlement_draft',totalAmountCents:33705,revision:1,voided:false,receiptNo:''})
    expect(lines[0].sourceEntryIds).toEqual(['entry-1'])
    expect(()=>assertValidPurchaseSettlementDraft({...draft,totalAmountCents:1})).toThrow()
    expect(draft.totalAmountCents).toBe(draft.lines.reduce((sum,line)=>sum+line.amountCents,0))
  })
})
