export type WeighingProductType = 'fish_head' | 'fish_meal'
export type FishMealQuality = 'bucket' | 'bag'
export type WeighingEntryMode = 'individual' | 'total'
export type WeighingSessionStatus = 'weighing' | 'completed' | 'processed' | 'voided'
export type WeighingSyncStatus = 'syncing' | 'synced' | 'failed'

export interface FishSpecies {
  id:string
  name:string
}

export interface FishSpeciesRecord {
  id:string
  speciesCode:string
  displayName:string
  active:boolean
  order:number
  notes:string
  createdBy?:string
  createdAt?:unknown
  updatedBy?:string
  updatedAt?:unknown
  inactiveBy?:string|null
  inactiveAt?:unknown|null
}

export interface WeighingSession {
  id:string
  sessionCode:string
  weighingDate:string
  monthKey:string
  externalSlipNo:string
  vesselId:string
  vesselCodeSnapshot:string
  vesselNameSnapshot:string
  status:WeighingSessionStatus
  lastSequenceNo:number
  fishHeadBasketCount:number
  fishHeadWeightGrams:number
  fishMealBucketBasketCount:number
  fishMealBucketWeightGrams:number
  fishMealBagBasketCount:number
  fishMealBagWeightGrams:number
  fishMealTotalWeightGrams:number
  totalWeightGrams:number
  processedReceiptId:string|null
  processedReceiptCode:string|null
  notes:string
  revision:number
  voidReason:string|null
  createdBy?:string
  createdAt?:unknown
  updatedBy?:string
  updatedAt?:unknown
  completedBy?:string|null
  completedAt?:unknown|null
  processedBy?:string|null
  processedAt?:unknown|null
  voidedBy?:string|null
  voidedAt?:unknown|null
  lastActionId?:string
}

export interface WeighingEntry {
  id:string
  clientEntryId:string
  sessionId:string
  productType:WeighingProductType
  fishSpeciesId:string|null
  fishSpeciesCodeSnapshot:string|null
  fishSpeciesNameSnapshot:string|null
  fishMealQuality:FishMealQuality|null
  displayNameSnapshot:string
  entryMode:WeighingEntryMode
  sequenceNo:number|null
  weightGrams:number
  remark:string
  recordedAtClient:string
  recordedAt:unknown
  recordedBy:string
  syncStatus:WeighingSyncStatus
  voided:boolean
  voidReason:string|null
  voidedBy?:string|null
  voidedAt?:unknown|null
  revision:number
  updatedBy?:string|null
  updatedAt?:unknown|null
  lastActionId?:string
}

export interface BuildWeighingEntryInput {
  id:string
  clientEntryId?:string
  sessionId:string
  productType:WeighingProductType
  fishSpeciesId:string|null
  fishSpecies?:Pick<FishSpeciesRecord,'id'|'speciesCode'|'displayName'>|null
  fishMealQuality:FishMealQuality|null
  entryMode:WeighingEntryMode
  sequenceNo:number|null
  weightGrams:number
  remark:string
  recordedAtClient?:string
  recordedAt:unknown
  recordedBy:string
}

export const FISH_HEAD_SPECIES:FishSpecies[] = [
  { id:'jin_xian', name:'金线' },
  { id:'lai_ge', name:'来戈' },
  { id:'ge_li', name:'戈里' },
  { id:'hong_mu_lin', name:'红目林' },
  { id:'wu_mu_lin', name:'乌目林' },
  { id:'mu_li', name:'目力' },
  { id:'bai_zhu_zhan', name:'白竹占' },
  { id:'po_jia', name:'破加' },
  { id:'ma_yu', name:'麻鱼' },
  { id:'you_ma', name:'幼麻' },
  { id:'ding_wen', name:'丁温' },
  { id:'cheng_yu', name:'成鱼' },
  { id:'mixed_fish', name:'杂鱼' },
  { id:'zhu_li', name:'朱力' },
  { id:'ying_wei', name:'硬尾' },
  { id:'da_mu', name:'大目' },
]

export const DEFAULT_FISH_SPECIES:FishSpeciesRecord[]=FISH_HEAD_SPECIES.map((item,order)=>({
  id:item.id,
  speciesCode:item.id,
  displayName:item.name,
  active:true,
  order:order+1,
  notes:'',
}))

export function activeFishSpecies(items:FishSpeciesRecord[]){
  return items.filter(item=>item.active).sort((a,b)=>a.order-b.order||a.displayName.localeCompare(b.displayName,'zh-Hans'))
}

export function defaultFishSpeciesToCreate(items:FishSpeciesRecord[]){
  const existing=new Set(items.map(item=>item.speciesCode))
  return DEFAULT_FISH_SPECIES.filter(item=>!existing.has(item.speciesCode))
}

export const FISH_MEAL_QUALITIES:{id:FishMealQuality;name:string}[] = [
  { id:'bucket', name:'桶鱼仔' },
  { id:'bag', name:'包鱼仔' },
]

export const MAX_INDIVIDUAL_WEIGHT_GRAMS = 300_000
export const MAX_TOTAL_WEIGHT_GRAMS = 100_000_000

export function kgInputToGrams(input:string, mode:WeighingEntryMode) {
  const clean=input.trim()
  if(!/^\d{1,6}(?:\.\d{1,3})?$/.test(clean)){
    throw new Error('请输入有效公斤重量，最多三位小数。')
  }
  const [whole,fraction='']=clean.split('.')
  const grams=Number(whole)*1000+Number(fraction.padEnd(3,'0'))
  if(grams<=0)throw new Error('重量必须大于 0 kg。')
  if(mode==='individual'&&grams>MAX_INDIVIDUAL_WEIGHT_GRAMS){
    throw new Error('每篮重量必须介于 0.001 至 300 kg。')
  }
  if(mode==='total'&&grams>MAX_TOTAL_WEIGHT_GRAMS){
    throw new Error('总重量不得超过 100,000 kg。')
  }
  return grams
}

export function buildWeighingEntry(input:BuildWeighingEntryInput):WeighingEntry {
  if(!Number.isInteger(input.weightGrams)||input.weightGrams<=0)throw new Error('重量必须保存为正整数克。')
  if(input.entryMode==='individual'){
    if(!Number.isInteger(input.sequenceNo)||Number(input.sequenceNo)<1)throw new Error('逐篮记录必须有有效顺序号。')
    if(input.weightGrams>MAX_INDIVIDUAL_WEIGHT_GRAMS)throw new Error('每篮重量不得超过 300 kg。')
  }else if(input.sequenceNo!==null){
    throw new Error('总重记录不得使用篮号。')
  }

  const defaultSpecies=input.productType==='fish_head'
    ?FISH_HEAD_SPECIES.find(item=>item.id===input.fishSpeciesId)
    :undefined
  const species=input.productType==='fish_head'
    ?input.fishSpecies??(defaultSpecies?{id:defaultSpecies.id,speciesCode:defaultSpecies.id,displayName:defaultSpecies.name}:undefined)
    :undefined
  const quality=input.productType==='fish_meal'
    ?FISH_MEAL_QUALITIES.find(item=>item.id===input.fishMealQuality)
    :undefined
  if(input.productType==='fish_head'&&!species)throw new Error('请选择鱼名。')
  if(input.productType==='fish_meal'&&!quality)throw new Error('请选择桶鱼仔或包鱼仔。')

  return {
    id:input.id,
    clientEntryId:input.clientEntryId??input.id,
    sessionId:input.sessionId,
    productType:input.productType,
    fishSpeciesId:species?.id??null,
    fishSpeciesCodeSnapshot:species?.speciesCode??null,
    fishSpeciesNameSnapshot:species?.displayName??null,
    fishMealQuality:quality?.id??null,
    displayNameSnapshot:species?.displayName??quality?.name??'',
    entryMode:input.entryMode,
    sequenceNo:input.entryMode==='individual'?input.sequenceNo:null,
    weightGrams:input.weightGrams,
    remark:input.remark.trim(),
    recordedAtClient:input.recordedAtClient??String(input.recordedAt),
    recordedAt:input.recordedAt,
    recordedBy:input.recordedBy,
    syncStatus:'synced',
    voided:false,
    voidReason:null,
    revision:1,
  }
}

export function summarizeWeighingEntries(entries:WeighingEntry[]) {
  return entries.filter(item=>!item.voided).reduce((total,item)=>({
    basketCount:total.basketCount+(item.entryMode==='individual'?1:0),
    recordCount:total.recordCount+1,
    totalWeightGrams:total.totalWeightGrams+item.weightGrams,
  }),{basketCount:0,recordCount:0,totalWeightGrams:0})
}

export function completeWeighingSession(session:WeighingSession):WeighingSession {
  if(session.status!=='weighing')throw new Error('只有称重中的现场单可以完成。')
  if(session.totalWeightGrams<1)throw new Error('至少保存一笔重量后才能完成称重。')
  return {...session,status:'completed',revision:session.revision+1}
}

export function formatMalaysiaDate(dateKey:string) {
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  return match?`${match[3]}/${match[2]}/${match[1]}`:dateKey
}

export function formatWeightKg(weightGrams:number) {
  return (weightGrams/1000).toFixed(3).replace(/\.?0+$/,'')
}

export interface WeighingGroup {
  key:string
  productType:WeighingProductType
  fishSpeciesCode:string|null
  fishMealQuality:FishMealQuality|null
  displayName:string
  basketCount:number
  weightGrams:number
  entries:WeighingEntry[]
}

export function groupWeighingEntries(entries:WeighingEntry[]):WeighingGroup[] {
  const groups=new Map<string,WeighingGroup>()
  entries.filter(item=>!item.voided).sort((a,b)=>(a.sequenceNo??Number.MAX_SAFE_INTEGER)-(b.sequenceNo??Number.MAX_SAFE_INTEGER))
    .forEach(entry=>{
      const key=entry.productType==='fish_head'?`species_${entry.fishSpeciesCodeSnapshot}`:`meal_${entry.fishMealQuality}`
      const group=groups.get(key)??{key,productType:entry.productType,fishSpeciesCode:entry.fishSpeciesCodeSnapshot,
        fishMealQuality:entry.fishMealQuality,displayName:entry.displayNameSnapshot,basketCount:0,weightGrams:0,entries:[]}
      group.basketCount+=entry.entryMode==='individual'?1:0
      group.weightGrams+=entry.weightGrams
      group.entries.push(entry)
      groups.set(key,group)
    })
  return [...groups.values()]
}

export function buildReceiptLinesFromWeighing(sessionId:string,entries:WeighingEntry[],prices:Record<string,number>):PurchaseReceiptLine[] {
  return groupWeighingEntries(entries).map((group,index)=>{
    const unitPriceCentsPerKg=prices[group.key]
    if(!Number.isInteger(unitPriceCentsPerKg)||unitPriceCentsPerKg<=0)throw new Error(`请输入${group.displayName}的有效单价。`)
    const categoryCodeSnapshot=group.productType==='fish_head'
      ?group.fishSpeciesCode!
      :`fish_meal_${group.fishMealQuality}`
    return {
      id:'',lineNo:index+1,categoryId:categoryCodeSnapshot,categoryCodeSnapshot,
      categoryNameSnapshot:group.displayName,basketCount:group.basketCount,weightGrams:group.weightGrams,
      unitPriceCentsPerKg,amountCents:lineAmountCents(group.weightGrams,unitPriceCentsPerKg),notes:'',
      sourceWeighingSessionId:sessionId,productType:group.productType,fishSpeciesCode:group.fishSpeciesCode,
      fishMealQuality:group.fishMealQuality,
    }
  })
}

export function newWeighingSession(input:{
  id:string
  vesselId:string
  vesselCodeSnapshot:string
  vesselNameSnapshot:string
  weighingDate:string
  externalSlipNo?:string
  sequence?:number
}):WeighingSession {
  const sequence=input.sequence??1
  return {
    id:input.id,
    sessionCode:`${input.vesselCodeSnapshot}-${input.weighingDate.replaceAll('-','')}-${String(sequence).padStart(2,'0')}`,
    weighingDate:input.weighingDate,
    monthKey:input.weighingDate.slice(0,7),
    externalSlipNo:(input.externalSlipNo??'').trim(),
    vesselId:input.vesselId,
    vesselCodeSnapshot:input.vesselCodeSnapshot,
    vesselNameSnapshot:input.vesselNameSnapshot,
    status:'weighing',
    lastSequenceNo:0,
    fishHeadBasketCount:0,
    fishHeadWeightGrams:0,
    fishMealBucketBasketCount:0,
    fishMealBucketWeightGrams:0,
    fishMealBagBasketCount:0,
    fishMealBagWeightGrams:0,
    fishMealTotalWeightGrams:0,
    totalWeightGrams:0,
    processedReceiptId:null,
    processedReceiptCode:null,
    notes:'',
    revision:1,
    voidReason:null,
  }
}

function entryAggregate(entry:WeighingEntry,multiplier=1) {
  const individual=entry.entryMode==='individual'
  return {
    fishHeadBasketCount:entry.productType==='fish_head'&&individual?multiplier:0,
    fishHeadWeightGrams:entry.productType==='fish_head'?entry.weightGrams*multiplier:0,
    fishMealBucketBasketCount:entry.fishMealQuality==='bucket'&&individual?multiplier:0,
    fishMealBucketWeightGrams:entry.fishMealQuality==='bucket'?entry.weightGrams*multiplier:0,
    fishMealBagBasketCount:entry.fishMealQuality==='bag'&&individual?multiplier:0,
    fishMealBagWeightGrams:entry.fishMealQuality==='bag'?entry.weightGrams*multiplier:0,
    fishMealTotalWeightGrams:entry.productType==='fish_meal'?entry.weightGrams*multiplier:0,
    totalWeightGrams:entry.weightGrams*multiplier,
  }
}

export function applyEntryCreated(session:WeighingSession,entry:WeighingEntry):WeighingSession {
  if(session.status!=='weighing')throw new Error('现场单已锁定，不能继续录入。')
  if(entry.voided)throw new Error('不能建立已作废的称重记录。')
  const delta=entryAggregate(entry)
  return {
    ...session,
    lastSequenceNo:entry.entryMode==='individual'?Math.max(session.lastSequenceNo,entry.sequenceNo??0):session.lastSequenceNo,
    fishHeadBasketCount:session.fishHeadBasketCount+delta.fishHeadBasketCount,
    fishHeadWeightGrams:session.fishHeadWeightGrams+delta.fishHeadWeightGrams,
    fishMealBucketBasketCount:session.fishMealBucketBasketCount+delta.fishMealBucketBasketCount,
    fishMealBucketWeightGrams:session.fishMealBucketWeightGrams+delta.fishMealBucketWeightGrams,
    fishMealBagBasketCount:session.fishMealBagBasketCount+delta.fishMealBagBasketCount,
    fishMealBagWeightGrams:session.fishMealBagWeightGrams+delta.fishMealBagWeightGrams,
    fishMealTotalWeightGrams:session.fishMealTotalWeightGrams+delta.fishMealTotalWeightGrams,
    totalWeightGrams:session.totalWeightGrams+delta.totalWeightGrams,
    revision:session.revision+1,
  }
}

export function applyEntryReplacement(session:WeighingSession,before:WeighingEntry,after:WeighingEntry):WeighingSession {
  const removed=entryAggregate(before,-1)
  return applyEntryCreated({
    ...session,
    fishHeadBasketCount:session.fishHeadBasketCount+removed.fishHeadBasketCount,
    fishHeadWeightGrams:session.fishHeadWeightGrams+removed.fishHeadWeightGrams,
    fishMealBucketBasketCount:session.fishMealBucketBasketCount+removed.fishMealBucketBasketCount,
    fishMealBucketWeightGrams:session.fishMealBucketWeightGrams+removed.fishMealBucketWeightGrams,
    fishMealBagBasketCount:session.fishMealBagBasketCount+removed.fishMealBagBasketCount,
    fishMealBagWeightGrams:session.fishMealBagWeightGrams+removed.fishMealBagWeightGrams,
    fishMealTotalWeightGrams:session.fishMealTotalWeightGrams+removed.fishMealTotalWeightGrams,
    totalWeightGrams:session.totalWeightGrams+removed.totalWeightGrams,
    revision:session.revision-1,
  },after)
}

export function softVoidWeighingEntry(session:WeighingSession,entry:WeighingEntry,reason:string) {
  const clean=reason.trim()
  if(session.status!=='weighing')throw new Error('只有称重中的现场单可以修改或作废记录。')
  if(entry.voided)throw new Error('这笔记录已经作废。')
  if(clean.length<3||clean.length>100)throw new Error('作废原因必须为 3 至 100 个字符。')
  const after={...entry,voided:true,voidReason:clean,revision:entry.revision+1}
  const delta=entryAggregate(entry,-1)
  return {
    entry:after,
    session:{
      ...session,
      fishHeadBasketCount:session.fishHeadBasketCount+delta.fishHeadBasketCount,
      fishHeadWeightGrams:session.fishHeadWeightGrams+delta.fishHeadWeightGrams,
      fishMealBucketBasketCount:session.fishMealBucketBasketCount+delta.fishMealBucketBasketCount,
      fishMealBucketWeightGrams:session.fishMealBucketWeightGrams+delta.fishMealBucketWeightGrams,
      fishMealBagBasketCount:session.fishMealBagBasketCount+delta.fishMealBagBasketCount,
      fishMealBagWeightGrams:session.fishMealBagWeightGrams+delta.fishMealBagWeightGrams,
      fishMealTotalWeightGrams:session.fishMealTotalWeightGrams+delta.fishMealTotalWeightGrams,
      totalWeightGrams:session.totalWeightGrams+delta.totalWeightGrams,
      revision:session.revision+1,
    },
  }
}
import { lineAmountCents,type PurchaseReceiptLine } from './purchasing'
