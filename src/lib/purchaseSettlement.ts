import { lineAmountCents } from './purchasing'
import { getDefaultFishHeadPriceCents,getDefaultFishMealPriceCents } from '../features/purchases/pricing/defaultPurchasePrices'
import type { FishMealQuality,WeighingEntry,WeighingEntryMode,WeighingProductType } from './weighing'

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
  productType:WeighingProductType
  businessDate:string
  dateSortKey:number
  monthKey:string
  monthSortKey:number
  vesselId:string
  vesselCodeSnapshot:string
  receiptNo:string
  status:'settlement_draft'
  lines:PurchaseSettlementLine[]
  totalAmountCents:number
  sourceEntryIds:string[]
  createdAt?:unknown
  createdBy?:string
  updatedAt?:unknown
  updatedBy?:string
  revision:number
  voided:false
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

export function buildPurchaseSettlementLines(entries:SettlementSourceEntry[],productType:WeighingProductType,vesselCode:string):PurchaseSettlementLine[] {
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
    const defaultPrice=isHead
      ?getDefaultFishHeadPriceCents(name,vesselCode)
      :getDefaultFishMealPriceCents(first.fishMealQuality??'bucket',vesselCode)
    const line:PurchaseSettlementLine={
      lineType:productType,nameSnapshot:name,totalWeightGrams:group.entries.reduce((sum,item)=>sum+item.weightGrams,0),
      basketCount:group.entries.reduce((sum,item)=>sum+(item.entryMode==='individual'?1:0),0),
      totalWeightEntryCount:group.entries.length,defaultUnitPriceCentsPerKg:defaultPrice,
      unitPriceCentsPerKg:defaultPrice,priceWasEdited:false,amountCents:0,sourceEntryIds:group.entries.map(item=>item.id),
      ...(isHead?{fishSpeciesId:first.fishSpeciesId??undefined,fishSpeciesCodeSnapshot:first.fishSpeciesCodeSnapshot??undefined,
        fishSpeciesNameSnapshot:first.fishSpeciesNameSnapshot??undefined}:{qualityCodeSnapshot:first.fishMealQuality??undefined,qualityNameSnapshot:name}),
    }
    return {...line,amountCents:calculateSettlementLineAmount(line)}
  })
}

export function updateSettlementLinePrice(line:PurchaseSettlementLine,input:string):PurchaseSettlementLine {
  const price=parseSettlementPrice(input)
  return {...line,unitPriceCentsPerKg:price,priceWasEdited:true,amountCents:price===null?0:lineAmountCents(line.totalWeightGrams,price)}
}

export function totalSettlementAmountCents(lines:PurchaseSettlementLine[]){return lines.reduce((sum,line)=>sum+line.amountCents,0)}

export function assertValidPurchaseSettlementDraft(draft:PurchaseSettlementDraft):void {
  if(draft.status!=='settlement_draft'||draft.voided!==false||!Array.isArray(draft.lines))throw new Error('结单草稿格式不正确。')
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

export function makeSettlementDraft(input:Pick<PurchaseSettlementDraft,'productType'|'businessDate'|'dateSortKey'|'monthKey'|'monthSortKey'|'vesselId'|'vesselCodeSnapshot'|'receiptNo'|'lines'|'sourceEntryIds'> & {createdBy?:string;revision?:number}):PurchaseSettlementDraft {
  return {...input,status:'settlement_draft',totalAmountCents:totalSettlementAmountCents(input.lines),revision:input.revision??1,voided:false}
}

export function asSettlementSourceEntry(entry:WeighingEntry):SettlementSourceEntry {
  return {id:entry.id,productType:entry.productType,fishSpeciesId:entry.fishSpeciesId,fishSpeciesCodeSnapshot:entry.fishSpeciesCodeSnapshot,
    fishSpeciesNameSnapshot:entry.fishSpeciesNameSnapshot,fishMealQuality:entry.fishMealQuality,displayNameSnapshot:entry.displayNameSnapshot,
    entryMode:entry.entryMode,sequenceNo:entry.sequenceNo,weightGrams:entry.weightGrams,voided:entry.voided,recordedAtClient:entry.recordedAtClient}
}
