export type ReceiptStatus='draft'|'confirmed'|'voided'
export type PurchasePaymentStatus='unpaid'|'partial'|'paid'
export type PaymentMethod='cash'|'bank'|'other'
export const MAX_PURCHASE_LINE_WEIGHT_GRAMS=100_000_000
export const MAX_PURCHASE_UNIT_PRICE_CENTS_PER_KG=10_000_000
export const MAX_PURCHASE_RECEIPT_LINES=100
export const MAX_PURCHASE_DISTINCT_CATEGORIES=12
export const MAX_WEIGHING_RECEIPT_DISTINCT_CATEGORIES=18

export interface PurchaseCategory {
  id:string;categoryCode:string;displayName:string;active:boolean;order:number;notes:string
  createdBy?:string;createdAt?:unknown;updatedBy?:string;updatedAt?:unknown;inactiveBy?:string|null;inactiveAt?:unknown|null
}
export interface Vessel {
  id:string;vesselCode:string;displayName:string;defaultSupplierId:string;defaultSupplierNameSnapshot:string
  active:boolean;order?:number;notes:string;createdBy?:string;createdAt?:unknown;updatedBy?:string;updatedAt?:unknown;inactiveBy?:string|null;inactiveAt?:unknown|null
}
export interface PurchaseReceiptLine {
  id:string;lineNo:number;categoryId:string;categoryCodeSnapshot:string;categoryNameSnapshot:string
  basketCount:number;weightGrams:number;unitPriceCentsPerKg:number;amountCents:number;notes:string
  sourceWeighingSessionId?:string|null;productType?:'fish_head'|'fish_meal'|null
  fishSpeciesCode?:string|null;fishMealQuality?:'bucket'|'bag'|null
  createdAt?:unknown;updatedAt?:unknown
}
export interface PurchaseReceipt {
  id:string;receiptCode:string;receiptDate:string;monthKey:string;externalSlipNo:string
  supplierId:string;supplierCodeSnapshot:string;supplierNameSnapshot:string
  vesselId:string;vesselCodeSnapshot:string;vesselNameSnapshot:string;status:ReceiptStatus
  lineCount:number;totalBasketCount:number;totalWeightGrams:number;totalAmountCents:number
  paidCents:number;paymentStatus:PurchasePaymentStatus;notes:string;duplicateAcknowledged:boolean
  lines:PurchaseReceiptLine[];createdBy?:string;createdAt?:unknown;updatedBy?:string;updatedAt?:unknown
  lastActionId?:string
  sourceWeighingSessionId?:string|null
  confirmedBy?:string|null;confirmedAt?:unknown|null;voidedBy?:string|null;voidedAt?:unknown|null;voidReason?:string|null
  lineIds?:string[];draftVersion?:number
}
export interface PurchasePayment {
  id:string;paymentGroupId:string;receiptId:string;receiptCode:string;supplierId:string;supplierNameSnapshot:string
  amountCents:number;method:PaymentMethod;paymentDate:string;reference:string;note:string
  createdBy:string;createdAt?:unknown;voided:boolean;voidReason:string|null;voidedBy:string|null;voidedAt?:unknown|null
}
export interface PurchaseCategoryInput {categoryCode:string;displayName:string;order:number;notes:string}
export interface VesselInput {
  vesselCode:string;displayName:string;defaultSupplierId:string;defaultSupplierNameSnapshot:string;order?:number;notes:string
}
const defaultVesselData=['978','833','2072','9633','4818','2031','1785','5202'] as const
export const DEFAULT_VESSELS=defaultVesselData.map((vesselCode,order)=>({id:vesselCode,vesselCode,displayName:vesselCode,defaultSupplierId:'',defaultSupplierNameSnapshot:'',active:true,order,notes:''}))

const defaultCategoryData=[
  ['fish_head','鱼头'],['fish_meal','鱼仔'],['lai_ge','来戈'],['jin_xian','金线'],['mu_li','目力'],
  ['mixed_fish','杂鱼'],['ge_li','戈里'],['bai_yue','白月'],['dai_zai','代仔'],
] as const
export const DEFAULT_PURCHASE_CATEGORIES=defaultCategoryData.map(([categoryCode,displayName],order)=>({
  id:categoryCode,categoryCode,displayName,active:true,order,notes:'',
}))

export const activePurchaseCategories=(categories:PurchaseCategory[])=>categories.filter(item=>item.active).sort((a,b)=>a.order-b.order||a.displayName.localeCompare(b.displayName))
export const activeVessels=(vessels:Vessel[])=>vessels.filter(item=>item.active).sort((a,b)=>(a.order??Number.MAX_SAFE_INTEGER)-(b.order??Number.MAX_SAFE_INTEGER)||a.vesselCode.localeCompare(b.vesselCode))
export function buildDefaultVesselCreates(existing:Vessel[]){
  const codes=new Set(existing.map(item=>item.vesselCode.trim().toLowerCase()))
  return DEFAULT_VESSELS.filter(item=>!codes.has(item.vesselCode.toLowerCase()))
}
export function buildDefaultVesselOrderRepairs(existing:Vessel[]){
  return existing.flatMap(item=>{
    const defaultVessel=DEFAULT_VESSELS.find(defaultItem=>defaultItem.vesselCode===item.vesselCode)
    return defaultVessel&&item.order===Number.MAX_SAFE_INTEGER?[{id:item.id,order:defaultVessel.order}]:[]
  })
}
export function buildDefaultCategoryCreates(existing:PurchaseCategory[]){
  const codes=new Set(existing.map(item=>item.categoryCode))
  return DEFAULT_PURCHASE_CATEGORIES.filter(item=>!codes.has(item.categoryCode))
}

export function lineAmountCents(weightGrams:number,unitPriceCentsPerKg:number){
  if(!Number.isInteger(weightGrams)||weightGrams<=0||weightGrams>MAX_PURCHASE_LINE_WEIGHT_GRAMS)throw new Error('Weight must be 1 to 100,000,000 whole grams')
  if(!Number.isInteger(unitPriceCentsPerKg)||unitPriceCentsPerKg<=0||unitPriceCentsPerKg>MAX_PURCHASE_UNIT_PRICE_CENTS_PER_KG)throw new Error('Unit price must be 1 to 10,000,000 cents per kg')
  return Math.floor((weightGrams*unitPriceCentsPerKg+500)/1000)
}
export function calculateReceiptTotals(lines:PurchaseReceiptLine[]){
  return lines.reduce((total,line)=>({
    lineCount:total.lineCount+1,
    totalBasketCount:total.totalBasketCount+line.basketCount,
    totalWeightGrams:total.totalWeightGrams+line.weightGrams,
    totalAmountCents:total.totalAmountCents+lineAmountCents(line.weightGrams,line.unitPriceCentsPerKg),
  }),{lineCount:0,totalBasketCount:0,totalWeightGrams:0,totalAmountCents:0})
}
export function assertPurchaseReceiptLineLimits(lines:PurchaseReceiptLine[]){
  if(lines.length>MAX_PURCHASE_RECEIPT_LINES)throw new Error('A receipt supports up to 100 lines.')
  const distinctCount=new Set(lines.map(item=>item.categoryId)).size
  const sourceIds=new Set(lines.map(item=>item.sourceWeighingSessionId).filter((value):value is string=>Boolean(value)))
  const weighingReceipt=lines.length>0&&sourceIds.size===1&&lines.every(item=>item.sourceWeighingSessionId)
  const limit=weighingReceipt?MAX_WEIGHING_RECEIPT_DISTINCT_CATEGORIES:MAX_PURCHASE_DISTINCT_CATEGORIES
  if(distinctCount>limit){
    throw new Error(`A receipt supports up to ${limit} distinct categories.`)
  }
}
export const paymentStatus=(paid:number,total:number):PurchasePaymentStatus=>paid<=0?'unpaid':paid>=total?'paid':'partial'
export function confirmReceipt(receipt:PurchaseReceipt):PurchaseReceipt{
  if(receipt.status!=='draft')throw new Error('Only a Draft receipt can be confirmed')
  if(receipt.lines.length===0)throw new Error('Receipt needs at least one line')
  assertPurchaseReceiptLineLimits(receipt.lines)
  const lines=receipt.lines.map(line=>({...line,amountCents:lineAmountCents(line.weightGrams,line.unitPriceCentsPerKg)}))
  return {...receipt,...calculateReceiptTotals(lines),lines,status:'confirmed',paymentStatus:paymentStatus(receipt.paidCents,calculateReceiptTotals(lines).totalAmountCents)}
}
export function voidReceipt(receipt:PurchaseReceipt,reason:string):PurchaseReceipt{
  if(receipt.status!=='confirmed')throw new Error('Only a Confirmed receipt can be voided')
  if(receipt.paidCents>0)throw new Error('Void related payments before voiding this receipt')
  const clean=reason.trim();if(clean.length<3||clean.length>100)throw new Error('Void reason must be 3 to 100 characters')
  return {...receipt,status:'voided',voidReason:clean}
}
export function duplicateExternalSlip(slip:string,receipts:PurchaseReceipt[],excludeId=''){
  const key=slip.trim().toLocaleLowerCase();return key.length>0&&receipts.some(item=>item.id!==excludeId&&item.externalSlipNo.trim().toLocaleLowerCase()===key)
}
export function applyPurchasePayment(receipt:PurchaseReceipt,amount:number):PurchaseReceipt{
  if(receipt.status!=='confirmed')throw new Error('Only Confirmed receipts can be paid')
  if(!Number.isInteger(amount)||amount<=0)throw new Error('Payment must be positive integer cents')
  if(receipt.paidCents+amount>receipt.totalAmountCents)throw new Error('Payment exceeds receipt balance')
  const paidCents=receipt.paidCents+amount;return {...receipt,paidCents,paymentStatus:paymentStatus(paidCents,receipt.totalAmountCents)}
}
export function voidPurchasePayment(receipt:PurchaseReceipt,amount:number):PurchaseReceipt{
  const paidCents=receipt.paidCents-amount;if(paidCents<0)throw new Error('Payment total cannot go below zero')
  return {...receipt,paidCents,paymentStatus:paymentStatus(paidCents,receipt.totalAmountCents)}
}
export function assertPaymentCanVoid(payment:PurchasePayment){
  if(payment.voided)throw new Error('Payment was already voided')
}
export function normalizeCategoryInput(input:PurchaseCategoryInput):PurchaseCategoryInput{
  return {...input,categoryCode:input.categoryCode.trim(),displayName:input.displayName.trim(),notes:input.notes.trim()}
}
export function validateCategoryInput(input:PurchaseCategoryInput){
  const value=normalizeCategoryInput(input);const errors:string[]=[]
  if(!/^[a-z0-9_]{1,40}$/.test(value.categoryCode))errors.push('Category code must use 1 to 40 lowercase letters, numbers, or underscores.')
  if(value.displayName.length<1||value.displayName.length>80)errors.push('Category name must be 1 to 80 characters.')
  if(!Number.isInteger(value.order)||value.order<0)errors.push('Category order must be a non-negative whole number.')
  if(value.notes.length>500)errors.push('Notes must be 500 characters or fewer.')
  return errors
}
export function normalizeVesselInput(input:VesselInput):VesselInput{
  return {...input,vesselCode:input.vesselCode.trim(),displayName:input.displayName.trim(),order:input.order??0,notes:input.notes.trim()}
}
export function validateVesselInput(input:VesselInput){
  const value=normalizeVesselInput(input);const errors:string[]=[]
  if(value.vesselCode.length<1||value.vesselCode.length>30)errors.push('Vessel code must be 1 to 30 characters.')
  if(value.displayName.length<1||value.displayName.length>80)errors.push('Vessel name must be 1 to 80 characters.')
  if(!Number.isInteger(value.order)||Number(value.order)<0)errors.push('Vessel order must be a non-negative whole number.')
  if(value.notes.length>500)errors.push('Notes must be 500 characters or fewer.')
  return errors
}
export function duplicateVesselCode(code:string,vessels:Vessel[],excludeId=''){
  const key=code.trim().toLocaleLowerCase()
  return vessels.some(item=>item.id!==excludeId&&item.vesselCode.trim().toLocaleLowerCase()===key)
}
export function buildPaymentGroup(receipts:PurchaseReceipt[],paymentGroupId:string){
  if(!paymentGroupId.trim())throw new Error('Payment group ID is required')
  return receipts.map(receipt=>{
    if(receipt.status!=='confirmed')throw new Error('Only Confirmed receipts can be paid')
    const amountCents=receipt.totalAmountCents-receipt.paidCents
    if(amountCents<=0)throw new Error('Selected receipts must have an outstanding balance')
    return {receiptId:receipt.id,amountCents,paymentGroupId}
  })
}
export function supplierMonthlySummary(receipts:PurchaseReceipt[],monthKey:string,supplierId:string){
  const included=receipts.filter(item=>item.status==='confirmed'&&item.monthKey===monthKey&&item.supplierId===supplierId)
  return {
    receipts:included,receiptCount:included.length,totalWeightGrams:included.reduce((sum,item)=>sum+item.totalWeightGrams,0),
    grossCents:included.reduce((sum,item)=>sum+item.totalAmountCents,0),paidCents:included.reduce((sum,item)=>sum+item.paidCents,0),
    outstandingCents:included.reduce((sum,item)=>sum+item.totalAmountCents-item.paidCents,0),
  }
}
export const kgInputToGrams=(value:string)=>{
  if(!/^\d+(?:\.\d{1,3})?$/.test(value))throw new Error('Weight must use up to 3 decimal places')
  const [whole,fraction='']=value.split('.');const grams=Number(whole)*1000+Number(fraction.padEnd(3,'0'))
  if(grams<=0)throw new Error('Weight must be greater than zero');return grams
}
export const rmInputToCentsPerKg=(value:string)=>{
  if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw new Error('Price must use up to 2 decimal places')
  const [whole,fraction='']=value.split('.');const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'))
  if(cents<=0)throw new Error('Price must be greater than zero');return cents
}
export const makeReceiptCode=(id:string)=>`RC-${id.replace(/[^a-z0-9]/gi,'').slice(0,8).toUpperCase().padEnd(8,'0')}`
