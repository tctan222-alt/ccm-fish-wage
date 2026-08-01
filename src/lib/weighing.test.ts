import { describe, expect, it } from 'vitest'
import {
  FISH_HEAD_SPECIES,
  buildWeighingEntry,
  completeWeighingSession,
  buildReceiptLinesFromWeighing,
  formatMalaysiaDate,
  kgInputToGrams,
  summarizeWeighingEntries,
  type WeighingEntry,
  type WeighingSession,
  summarizePricedWeighingEntries,
} from './weighing'

describe('现场称重产品选择', () => {
  it('按现场指定顺序提供 16 个中文鱼头鱼名', () => {
    expect(FISH_HEAD_SPECIES.map(item => item.name)).toEqual([
      '金线', '来戈', '戈里', '红目林',
      '乌目林', '目力', '白竹占', '破加',
      '麻鱼', '幼麻', '丁温', '成鱼',
      '杂鱼', '朱力', '硬尾', '大目',
    ])
  })
})

describe('现场称重记录规则', () => {
  it('鱼头购入逐篮保留整数分单价与 half-up 金额快照', () => {
    const priced = buildWeighingEntry({
      id:'priced-1',sessionId:'session-1',productType:'fish_head',fishSpeciesId:'jin_xian',fishMealQuality:null,
      entryMode:'individual',sequenceNo:1,weightGrams:1_250,remark:'',recordedAt:'2026-07-31T10:00:00+08:00',recordedBy:'admin',
      unitPriceCentsPerKg:123,
    })
    expect(priced).toMatchObject({ unitPriceCentsPerKg:123, amountCents:154 })
  })

  it('同一鱼名不同价格分别汇总，且保留每篮实际价格', () => {
    const entries=[
      entry({id:'price-a',weightGrams:10_000,unitPriceCentsPerKg:100,amountCents:1_000}),
      entry({id:'price-b',sequenceNo:2,weightGrams:5_000,unitPriceCentsPerKg:150,amountCents:750}),
      entry({id:'price-c',sequenceNo:3,weightGrams:4_000,unitPriceCentsPerKg:100,amountCents:400}),
    ]
    expect(summarizePricedWeighingEntries(entries)).toEqual([
      expect.objectContaining({displayName:'金线',unitPriceCentsPerKg:100,basketCount:2,totalWeightGrams:14_000,totalAmountCents:1_400}),
      expect.objectContaining({displayName:'金线',unitPriceCentsPerKg:150,basketCount:1,totalWeightGrams:5_000,totalAmountCents:750}),
    ])
  })
  it('把最多三位小数的公斤输入准确保存为整数克', () => {
    expect(kgInputToGrams('12.345', 'individual')).toBe(12_345)
    expect(kgInputToGrams('.5', 'individual')).toBe(500)
    expect(kgInputToGrams('80,125', 'individual')).toBe(80_125)
    expect(() => kgInputToGrams('12.3456', 'individual')).toThrow('最多三位小数')
    expect(() => kgInputToGrams('300.001', 'individual')).toThrow('每篮重量')
  })

  it('逐篮鱼头记录保存鱼名快照、顺序和同步状态', () => {
    expect(buildWeighingEntry({
      id:'entry-1',
      clientEntryId:'entry-1',
      sessionId:'session-1',
      productType:'fish_head',
      fishSpeciesId:'jin_xian',
      fishMealQuality:null,
      entryMode:'individual',
      sequenceNo:7,
      weightGrams:12_500,
      remark:'',
      recordedAtClient:'2026-07-30T10:30:00+08:00',
      recordedAt:'2026-07-30T10:30:00+08:00',
      recordedBy:'admin',
    })).toEqual({
      id:'entry-1',
      clientEntryId:'entry-1',
      sessionId:'session-1',
      productType:'fish_head',
      fishSpeciesId:'jin_xian',
      fishSpeciesCodeSnapshot:'jin_xian',
      fishSpeciesNameSnapshot:'金线',
      fishMealQuality:null,
      displayNameSnapshot:'金线',
      entryMode:'individual',
      sequenceNo:7,
      weightGrams:12_500,
      remark:'',
      recordedAtClient:'2026-07-30T10:30:00+08:00',
      recordedAt:'2026-07-30T10:30:00+08:00',
      recordedBy:'admin',
      syncStatus:'synced',
      voided:false,
      voidReason:null,
      revision:1,
    })
  })

  it('鱼仔总重记录保留品质和备注，但不伪造篮数或顺序号', () => {
    const total = buildWeighingEntry({
      id:'entry-total',
      sessionId:'session-1',
      productType:'fish_meal',
      fishSpeciesId:null,
      fishMealQuality:'bag',
      entryMode:'total',
      sequenceNo:null,
      weightGrams:480_000,
      remark:'总共48包',
      recordedAt:'2026-07-30T11:00:00+08:00',
      recordedBy:'admin',
    })
    expect(total).toMatchObject({
      fishSpeciesId:null,
      fishSpeciesNameSnapshot:null,
      fishMealQuality:'bag',
      displayNameSnapshot:'包鱼仔',
      entryMode:'total',
      sequenceNo:null,
      weightGrams:480_000,
      remark:'总共48包',
    })
    expect(summarizeWeighingEntries([total])).toEqual({
      basketCount:0,
      recordCount:1,
      totalWeightGrams:480_000,
    })
  })

  it('汇总时忽略作废记录，并只把逐篮记录计入篮数', () => {
    const entries = [
      entry({ id:'one', entryMode:'individual', sequenceNo:1, weightGrams:10_000 }),
      entry({ id:'two', entryMode:'total', sequenceNo:null, weightGrams:50_000 }),
      entry({ id:'voided', entryMode:'individual', sequenceNo:2, weightGrams:99_000, voided:true }),
    ]
    expect(summarizeWeighingEntries(entries)).toEqual({
      basketCount:1,
      recordCount:2,
      totalWeightGrams:60_000,
    })
  })

  it('完成称重后锁定手机普通输入', () => {
    expect(completeWeighingSession(session())).toMatchObject({
      status:'completed',
      revision:2,
    })
    expect(() => completeWeighingSession(session({ status:'completed' }))).toThrow('只有称重中的现场单')
  })

  it('日期统一显示为 DD/MM/YYYY', () => {
    expect(formatMalaysiaDate('2026-07-30')).toBe('30/07/2026')
  })

  it('生成采购单时按鱼种及鱼仔品质汇总，不复制每篮为采购 line',()=>{
    const lines=buildReceiptLinesFromWeighing('session-1',[
      entry({id:'jin-1',sequenceNo:1,weightGrams:10_000}),
      entry({id:'jin-2',sequenceNo:2,weightGrams:12_500}),
      entry({id:'bag-1',productType:'fish_meal',fishSpeciesId:null,fishSpeciesCodeSnapshot:null,
        fishSpeciesNameSnapshot:null,fishMealQuality:'bag',displayNameSnapshot:'包鱼仔',sequenceNo:3,weightGrams:20_000}),
      entry({id:'bag-total',productType:'fish_meal',fishSpeciesId:null,fishSpeciesCodeSnapshot:null,
        fishSpeciesNameSnapshot:null,fishMealQuality:'bag',displayNameSnapshot:'包鱼仔',entryMode:'total',
        sequenceNo:null,weightGrams:50_000,remark:'总共5包'}),
    ],{species_jin_xian:250,meal_bag:120})
    expect(lines).toHaveLength(2)
    expect(lines).toEqual([
      expect.objectContaining({categoryCodeSnapshot:'jin_xian',basketCount:2,weightGrams:22_500,
        unitPriceCentsPerKg:250,amountCents:5625,sourceWeighingSessionId:'session-1',productType:'fish_head'}),
      expect.objectContaining({categoryCodeSnapshot:'fish_meal_bag',basketCount:1,weightGrams:70_000,
        unitPriceCentsPerKg:120,amountCents:8400,fishMealQuality:'bag'}),
    ])
  })

  it('keeps baskets of the same fish in separate receipt lines when their saved prices differ',()=>{
    const lines=buildReceiptLinesFromWeighing('session-1',[
      entry({id:'jin-low',weightGrams:10_000,unitPriceCentsPerKg:250,amountCents:2500}),
      entry({id:'jin-high',sequenceNo:2,weightGrams:10_000,unitPriceCentsPerKg:300,amountCents:3000}),
    ],{})
    expect(lines).toHaveLength(2)
    expect(lines.map(item=>({basketCount:item.basketCount,unitPriceCentsPerKg:item.unitPriceCentsPerKg,amountCents:item.amountCents}))).toEqual([
      {basketCount:1,unitPriceCentsPerKg:250,amountCents:2500},
      {basketCount:1,unitPriceCentsPerKg:300,amountCents:3000},
    ])
  })

  it('keeps basket-level rounding in the audit record while the formal line rounds its grouped weight',()=>{
    const lines=buildReceiptLinesFromWeighing('session-1',[
      entry({id:'round-one',weightGrams:333,unitPriceCentsPerKg:100,amountCents:33}),
      entry({id:'round-two',sequenceNo:2,weightGrams:333,unitPriceCentsPerKg:100,amountCents:33}),
    ],{})
    expect(lines).toEqual([expect.objectContaining({weightGrams:666,unitPriceCentsPerKg:100,amountCents:67})])
  })
})

function session(overrides:Partial<WeighingSession>={}):WeighingSession {
  return {
    id:'session-1',
    sessionCode:'978-20260730-01',
    weighingDate:'2026-07-30',
    monthKey:'2026-07',
    externalSlipNo:'',
    vesselId:'vessel-978',
    vesselCodeSnapshot:'978',
    vesselNameSnapshot:'978',
    status:'weighing',
    lastSequenceNo:1,
    fishHeadBasketCount:1,
    fishHeadWeightGrams:10_000,
    fishMealBucketBasketCount:0,
    fishMealBucketWeightGrams:0,
    fishMealBagBasketCount:0,
    fishMealBagWeightGrams:0,
    fishMealTotalWeightGrams:0,
    totalWeightGrams:10_000,
    processedReceiptId:null,
    processedReceiptCode:null,
    notes:'',
    revision:1,
    voidReason:null,
    ...overrides,
  }
}

function entry(overrides:Partial<WeighingEntry>={}):WeighingEntry {
  return {
    id:'entry-1',
    clientEntryId:'entry-1',
    sessionId:'session-1',
    productType:'fish_head',
    fishSpeciesId:'jin_xian',
    fishSpeciesCodeSnapshot:'jin_xian',
    fishSpeciesNameSnapshot:'金线',
    fishMealQuality:null,
    displayNameSnapshot:'金线',
    entryMode:'individual',
    sequenceNo:1,
    weightGrams:10_000,
    remark:'',
    recordedAtClient:'2026-07-30T10:30:00+08:00',
    recordedAt:'2026-07-30T10:30:00+08:00',
    recordedBy:'admin',
    syncStatus:'synced',
    voided:false,
    voidReason:null,
    revision:1,
    ...overrides,
  }
}
