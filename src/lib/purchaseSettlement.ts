import { lineAmountCents,MAX_PURCHASE_UNIT_PRICE_CENTS_PER_KG } from './purchasing'
import { fishHeadNoLoanVesselCodes,fishHeadNoLoanPremiumCents,getDefaultFishHeadPriceCents,getDefaultFishMealPriceCents } from '../features/purchases/pricing/defaultPurchasePrices'
import type { FishSpeciesRecord,FishMealQuality,WeighingEntry,WeighingEntryMode,WeighingProductType } from './weighing'
import { fishHeadMasterBasePriceCents } from './fishHeadMasterPrice'
import type { SettlementStatus } from './settlementLifecycle'

export interface SettlementSourceEntry {
  id:string
  productType:WeighingProductType
  fishSpeciesId:string|null
  fishSpeciesCodeSnapshot:string|null
  fishSpeciesNameSnapshot:string|null
  fishMealQuality:FishMealQuality|null
  displayNameSnapshot:string
  entryMode:WeighingEntryMode
  sequenceNo:number|null
  weightGrams:number
  voided:boolean
  recordedAtClient:string
}

export interface PurchaseSettlementLine {
  lineType:'fish_head'|'fish_meal'
  nameSnapshot:string
  totalWeightGrams:number
  basketCount:number
  totalWeightEntryCount:number
  defaultUnitPriceCentsPerKg:number|null
  baseUnitPriceCentsPerKg?:number|null
  vesselPremiumCentsPerKg?:number
  unitPriceCentsPerKg:number|null
  priceWasEdited:boolean
  amountCents:number
  sourceEntryIds:string[]
  fishSpeciesId?:string
  fishSpeciesCodeSnapshot?:string
  fishSpeciesNameSnapshot?:string
  qualityCodeSnapshot?:FishMealQuality
  qualityNameSnapshot?:string
}

export interface PurchaseSettlementDraft {
  /** Firestore identity retained at runtime; never stored in the document or its audit. */
  draftId?:string
  productType:WeighingProductType
  businessDate:string
  dateSortKey:number
  monthKey:string
  monthSortKey:number
  vesselId:string
  vesselCodeSnapshot:string
  receiptNo:string
  status:SettlementStatus
  finalizedAt?:unknown
  finalizedBy?:string
  lines:PurchaseSettlementLine[]
  totalAmountCents:number
  sourceEntryIds:string[]
  createdAt?:unknown
  createdBy?:string
  updatedAt?:unknown
  updatedBy?:string
  revision:number
  voided:false
  sourceSessionId?:string
  sourceSessionRevision?:number
}

/** Recalculate current weights while retaining the saved price snapshots. */
export function settlementLineIdentity(line:PurchaseSettlementLine):string {
  return line.lineType==='fish_head'?`head:${line.fishSpeciesCodeSnapshot??line.fishSpeciesId??line.nameSnapshot}`:`meal:${line.qualityCodeSnapshot}`
}

export function reconcileSettlementLines(current:PurchaseSettlementLine[],saved:PurchaseSettlementLine[]):PurchaseSettlementLine[]{
  return current.map(line=>{
    const previous=saved.find(item=>settlementLineIdentity(item)===settlementLineIdentity(line))
    if(!previous)return line
    const next={...line,defaultUnitPriceCentsPerKg:previous.defaultUnitPriceCentsPerKg,
      unitPriceCentsPerKg:previous.unitPriceCentsPerKg,priceWasEdited:previous.priceWasEdited}
    if(previous.baseUnitPriceCentsPerKg===undefined)delete next.baseUnitPriceCentsPerKg
    else next.baseUnitPriceCentsPerKg=previous.baseUnitPriceCentsPerKg
    if(previous.vesselPremiumCentsPerKg===undefined)delete next.vesselPremiumCentsPerKg
    else next.vesselPremiumCentsPerKg=previous.vesselPremiumCentsPerKg
    return {...next,amountCents:calculateSettlementLineAmount(next)}
  })
}

export function parseSettlementPrice(value:string):number|null {
  const clean=value.trim()
  if(clean==='')return null
  if(!/^(?:\d+|\d+\.\d{1,2}|\.\d{1,2})$/.test(clean))throw new Error('单价必须是最多两位小数的非负金额。')
  const normalized=clean.startsWith('.')?`0${clean}`:clean
  const [whole,fraction='']=normalized.split('.')
  const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'))
  if(!Number.isSafeInteger(cents)||cents<0)throw new Error('单价格式不正确。')
  return cents
}

export function calculateSettlementLineAmount(line:Pick<PurchaseSettlementLine,'totalWeightGrams'|'unitPriceCentsPerKg'>):number {
  return line.unitPriceCentsPerKg===null?0:lineAmountCents(line.totalWeightGrams,line.unitPriceCentsPerKg)
}

function sourceOrder(entry:SettlementSourceEntry){return entry.sequenceNo??Number.MAX_SAFE_INTEGER}

export function buildPurchaseSettlementLines(entries:SettlementSourceEntry[],productType:WeighingProductType,vesselCode:string,masterSpecies:readonly FishSpeciesRecord[]=[]):PurchaseSettlementLine[] {
  const groups=new Map<string,{first:number;entries:SettlementSourceEntry[]}>()
  entries.filter(item=>!item.voided&&item.productType===productType).forEach(entry=>{
    const key=productType==='fish_head'?`fish_head:${entry.fishSpeciesCodeSnapshot??entry.displayNameSnapshot}`:`fish_meal:${entry.fishMealQuality}`
    const group=groups.get(key)??{first:sourceOrder(entry),entries:[]}
    group.entries.push(entry);group.first=Math.min(group.first,sourceOrder(entry));groups.set(key,group)
  })
  return [...groups.values()].sort((a,b)=>a.first-b.first).map(group=>{
    const first=group.entries[0]
    const isHead=productType==='fish_head'
    const name=first.displayNameSnapshot
    const master=masterSpecies.find(item=>item.id===first.fishSpeciesId)??masterSpecies.find(item=>item.speciesCode===first.fishSpeciesCodeSnapshot)
    const base=master?fishHeadMasterBasePriceCents(master):null
    const defaultPrice=isHead
      ?master?(base===null?null:base+fishHeadVesselPremiumCents(vesselCode)):getDefaultFishHeadPriceCents(name,vesselCode)
      :getDefaultFishMealPriceCents(first.fishMealQuality??'bucket',vesselCode)
    const line:PurchaseSettlementLine={
      lineType:productType,nameSnapshot:name,totalWeightGrams:group.entries.reduce((sum,item)=>sum+item.weightGrams,0),
      basketCount:group.entries.reduce((sum,item)=>sum+(item.entryMode==='individual'?1:0),0),
      totalWeightEntryCount:group.entries.length,defaultUnitPriceCentsPerKg:defaultPrice,
      ...(isHead?{baseUnitPriceCentsPerKg:master?base:defaultPrice===null?null:defaultPrice-fishHeadVesselPremiumCents(vesselCode),vesselPremiumCentsPerKg:fishHeadVesselPremiumCents(vesselCode)}:{}),
      unitPriceCentsPerKg:defaultPrice,priceWasEdited:false,amountCents:0,sourceEntryIds:group.entries.map(item=>item.id),
      ...(isHead?{fishSpeciesId:first.fishSpeciesId??undefined,fishSpeciesCodeSnapshot:first.fishSpeciesCodeSnapshot??undefined,
        fishSpeciesNameSnapshot:first.fishSpeciesNameSnapshot??undefined}:{qualityCodeSnapshot:first.fishMealQuality??undefined,qualityNameSnapshot:name}),
    }
    return {...line,amountCents:calculateSettlementLineAmount(line)}
  })
}

export function fishHeadVesselPremiumCents(vesselCode:string):number {
  return fishHeadNoLoanVesselCodes.includes(vesselCode.trim() as (typeof fishHeadNoLoanVesselCodes)[number])?fishHeadNoLoanPremiumCents:0
}

export function assertFishHeadSettlementPrices(draft:Pick<PurchaseSettlementDraft,'productType'|'lines'>):void {
  if(draft.productType!=='fish_head')return
  const missing=draft.lines.filter(line=>line.totalWeightGrams>0&&(line.unitPriceCentsPerKg===null||!Number.isSafeInteger(line.unitPriceCentsPerKg)||line.unitPriceCentsPerKg<=0)).map(line=>line.nameSnapshot)
  if(missing.length)throw new Error(`以下鱼种尚未填写价格：${missing.join('、')}。请填完后再完成结单。`)
}

export function updateSettlementLinePrice(line:PurchaseSettlementLine,input:string):PurchaseSettlementLine {
  const price=parseSettlementPrice(input)
  if(line.lineType==='fish_head'&&price!==null&&(price<=0||price>MAX_PURCHASE_UNIT_PRICE_CENTS_PER_KG))throw new Error('单价须大于 RM0，并且不超过 RM100,000.00/kg。')
  return {...line,unitPriceCentsPerKg:price,priceWasEdited:true,amountCents:price===null?0:lineAmountCents(line.totalWeightGrams,price)}
}

export function totalSettlementAmountCents(lines:PurchaseSettlementLine[]){return lines.reduce((sum,line)=>sum+line.amountCents,0)}

export function assertValidPurchaseSettlementDraft(draft:PurchaseSettlementDraft):void {
  if(!['settlement_draft','settlement_finalized'].includes(draft.status)||draft.voided!==false||!Array.isArray(draft.lines))throw new Error('结单格式不正确。')
  for(const line of draft.lines){
    if(line.lineType!==draft.productType||!line.nameSnapshot.trim()||!Number.isSafeInteger(line.totalWeightGrams)||line.totalWeightGrams<0
      ||!Number.isSafeInteger(line.basketCount)||line.basketCount<0||!Number.isSafeInteger(line.totalWeightEntryCount)||line.totalWeightEntryCount<0
      ||!Array.isArray(line.sourceEntryIds)||line.sourceEntryIds.length===0||line.sourceEntryIds.some(id=>typeof id!=='string'||!id)
      ||(line.defaultUnitPriceCentsPerKg!==null&&(!Number.isSafeInteger(line.defaultUnitPriceCentsPerKg)||line.defaultUnitPriceCentsPerKg<0))
      ||(line.unitPriceCentsPerKg!==null&&(!Number.isSafeInteger(line.unitPriceCentsPerKg)||line.unitPriceCentsPerKg<0))
      ||typeof line.priceWasEdited!=='boolean'||!Number.isSafeInteger(line.amountCents)||line.amountCents<0
      ||line.amountCents!==calculateSettlementLineAmount(line))throw new Error('结单草稿明细不正确。')
  }
  if(draft.totalAmountCents!==totalSettlementAmountCents(draft.lines))throw new Error('结单草稿总额不正确。')
}

export function formatSettlementMoney(cents:number){return `RM ${(cents/100).toFixed(2)}`}

export function draftIdForSettlement(productType:WeighingProductType,dateSortKey:number,vesselId:string){return `${productType}_${dateSortKey}_${vesselId}`}

export function draftIdForSourceSession(productType:WeighingProductType,sourceSessionId:string){
  const id=`${productType}_session_${sourceSessionId}`
  if(!sourceSessionId.trim()||sourceSessionId.includes('/')||['.','..'].includes(sourceSessionId)||/^__.*__$/.test(sourceSessionId)
    ||new TextEncoder().encode(id).length>1500)throw new Error('来源称重单 ID 不正确。')
  return id
}

export function makeSettlementDraft(input:Pick<PurchaseSettlementDraft,'productType'|'businessDate'|'dateSortKey'|'monthKey'|'monthSortKey'|'vesselId'|'vesselCodeSnapshot'|'receiptNo'|'lines'|'sourceEntryIds'> & {createdBy?:string;revision?:number}):PurchaseSettlementDraft {
  return {...input,status:'settlement_draft',totalAmountCents:totalSettlementAmountCents(input.lines),revision:input.revision??1,voided:false}
}

export function asSettlementSourceEntry(entry:WeighingEntry):SettlementSourceEntry {
  return {id:entry.id,productType:entry.productType,fishSpeciesId:entry.fishSpeciesId,fishSpeciesCodeSnapshot:entry.fishSpeciesCodeSnapshot,
    fishSpeciesNameSnapshot:entry.fishSpeciesNameSnapshot,fishMealQuality:entry.fishMealQuality,displayNameSnapshot:entry.displayNameSnapshot,
    entryMode:entry.entryMode,sequenceNo:entry.sequenceNo,weightGrams:entry.weightGrams,voided:entry.voided,recordedAtClient:entry.recordedAtClient}
}
