import { assertValidPurchaseSettlementDraft,totalSettlementAmountCents,type PurchaseSettlementDraft,type PurchaseSettlementLine } from '../lib/purchaseSettlement'
import type { WeighingProductType } from '../lib/weighing'

export interface SettlementDraftIdentity {
  productType:WeighingProductType
  sourceSessionId:string
  sourceSessionRevision:number
  settlementRevision:number
  businessDate:string
  vesselId:string
  vesselCodeSnapshot:string
}
export interface SettlementLocalDraft extends SettlementDraftIdentity {
  version:1
  receiptNo:string
  priceInputs:Record<string,string>
  lines:PurchaseSettlementLine[]
  updatedAt:string
}
export interface SettlementLocalDraftStore {
  load:(product:WeighingProductType,source:string)=>SettlementLocalDraft|null
  save:(draft:SettlementLocalDraft)=>void
  remove:(product:WeighingProductType,source:string)=>void
  removeIfUnchanged:(product:WeighingProductType,source:string,submitted:SettlementLocalDraft|null)=>boolean
}
export function localDraftMatches(draft:SettlementDraftIdentity,current:SettlementDraftIdentity):boolean {
  return (['productType','sourceSessionId','sourceSessionRevision','settlementRevision','businessDate','vesselId','vesselCodeSnapshot'] as const).every(key=>draft[key]===current[key])
}
function valid(value:unknown):value is SettlementLocalDraft {
  if(!value||typeof value!=='object')return false
  const data=value as SettlementLocalDraft
  const header=data.version===1&&['fish_head','fish_meal'].includes(data.productType)
    &&['sourceSessionId','businessDate','vesselId','vesselCodeSnapshot','receiptNo','updatedAt'].every(key=>typeof data[key as keyof SettlementLocalDraft]==='string')
    &&Number.isInteger(data.sourceSessionRevision)&&data.sourceSessionRevision>=1&&Number.isInteger(data.settlementRevision)&&data.settlementRevision>=0
    &&Array.isArray(data.lines)&&data.priceInputs!==null&&typeof data.priceInputs==='object'&&!Array.isArray(data.priceInputs)
    &&Object.values(data.priceInputs).every(price=>typeof price==='string')
  if(!header)return false
  try{
    assertValidPurchaseSettlementDraft({productType:data.productType,status:'settlement_draft',voided:false,lines:data.lines,totalAmountCents:totalSettlementAmountCents(data.lines)} as PurchaseSettlementDraft)
    return true
  }catch{return false}
}
/** Browser-only working input, scoped to the signed-in user and stable source. */
export function createSettlementLocalDraftStore(userId:string,storage?:Pick<Storage,'getItem'|'setItem'|'removeItem'>):SettlementLocalDraftStore {
  const key=(product:WeighingProductType,source:string)=>`ccm:settlement-draft:v1:${encodeURIComponent(userId)}:${product}:${encodeURIComponent(source)}`
  return {
    load(product,source){
      try{
        const text=(storage??window.localStorage).getItem(key(product,source))
        if(text===null)return null
        const draft:unknown=JSON.parse(text)
        if(!valid(draft)||draft.productType!==product||draft.sourceSessionId!==source)throw new Error('invalid')
        return draft
      }catch{throw new Error('无法读取本机草稿，草稿未被删除；请检查浏览器储存权限或联系管理员。')}
    },
    save(draft){try{(storage??window.localStorage).setItem(key(draft.productType,draft.sourceSessionId),JSON.stringify(draft))}catch{throw new Error('本机草稿保存失败，请勿关闭页面；请检查浏览器储存空间或权限。')}},
    remove(product,source){try{(storage??window.localStorage).removeItem(key(product,source))}catch{throw new Error('本机草稿无法清除，请检查浏览器储存权限。')}},
    removeIfUnchanged(product,source,submitted){
      try{
        const target=storage??window.localStorage
        if(target.getItem(key(product,source))!==(submitted===null?null:JSON.stringify(submitted)))return false
        target.removeItem(key(product,source));return true
      }catch{throw new Error('本机草稿无法清除，请检查浏览器储存权限。')}
    },
  }
}
