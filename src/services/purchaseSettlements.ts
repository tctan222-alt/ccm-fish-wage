import { doc,getDoc,setDoc,serverTimestamp } from 'firebase/firestore'
import { auth,db,firebaseConfigured } from '../firebase'
import { businessDateFromLegacy,monthKeyFromBusinessDate,monthSortKeyFromMonthKey,sortKeyFromBusinessDate } from '../lib/businessDate'
import { asSettlementSourceEntry,assertValidPurchaseSettlementDraft,draftIdForSettlement,type PurchaseSettlementDraft,type PurchaseSettlementLine } from '../lib/purchaseSettlement'
import { loadWeighingBundle,loadWeighingSessions,type WeighingBundle } from './weighing'
import type { WeighingProductType,WeighingSession } from '../lib/weighing'

const DRAFT_COLLECTION='purchaseSettlementDrafts'

export interface PurchaseSettlementSource {
  session:WeighingSession|null
  bundle:WeighingBundle|null
}

function requireUser(){
  if(!firebaseConfigured)throw new Error('Firebase 尚未设定。')
  if(!auth.currentUser)throw new Error('请先登录。')
  return auth.currentUser
}

function draftFrom(id:string,data:Record<string,unknown>):PurchaseSettlementDraft {
  return {
    productType:data.productType as WeighingProductType,businessDate:String(data.businessDate),dateSortKey:Number(data.dateSortKey),
    monthKey:String(data.monthKey),monthSortKey:Number(data.monthSortKey),vesselId:String(data.vesselId),
    vesselCodeSnapshot:String(data.vesselCodeSnapshot),receiptNo:String(data.receiptNo??''),status:'settlement_draft',
    lines:(Array.isArray(data.lines)?data.lines:[]) as PurchaseSettlementLine[],totalAmountCents:Number(data.totalAmountCents),
    sourceEntryIds:(Array.isArray(data.sourceEntryIds)?data.sourceEntryIds:[]).map(String),createdAt:data.createdAt,createdBy:data.createdBy?String(data.createdBy):undefined,
    updatedAt:data.updatedAt,updatedBy:data.updatedBy?String(data.updatedBy):undefined,revision:Number(data.revision),voided:false,
    ...('voided' in data?{voided:Boolean(data.voided) as false}:{}),
  }
}

export async function loadPurchaseSettlementSource(vesselId:string,businessDate:string,productType:WeighingProductType,
  sessionLoader=loadWeighingSessions,bundleLoader=loadWeighingBundle):Promise<PurchaseSettlementSource>{
  const canonical=businessDateFromLegacy(businessDate)
  const sessions=await sessionLoader()
  const session=sessions.find(item=>item.vesselId===vesselId&&item.productType===productType&&item.status!=='voided'
    &&businessDateFromLegacy(item.weighingDate)===canonical)??null
  return {session,bundle:session?await bundleLoader(session.id):null}
}

export async function loadPurchaseSettlementDraft(productType:WeighingProductType,dateSortKey:number,vesselId:string):Promise<PurchaseSettlementDraft|null>{
  requireUser()
  const snapshot=await getDoc(doc(db,DRAFT_COLLECTION,draftIdForSettlement(productType,dateSortKey,vesselId)))
  return snapshot.exists()?draftFrom(snapshot.id,snapshot.data()):null
}

export async function savePurchaseSettlementDraft(value:PurchaseSettlementDraft):Promise<PurchaseSettlementDraft>{
  assertValidPurchaseSettlementDraft(value)
  const user=requireUser()
  const date=businessDateFromLegacy(value.businessDate)
  const monthKey=monthKeyFromBusinessDate(date)
  const dateSortKey=sortKeyFromBusinessDate(date)
  const monthSortKey=monthSortKeyFromMonthKey(monthKey)
  const reference=doc(db,DRAFT_COLLECTION,draftIdForSettlement(value.productType,dateSortKey,value.vesselId))
  const existing=await getDoc(reference)
  const now=serverTimestamp()
  const next={...value,businessDate:date,dateSortKey,monthKey,monthSortKey,status:'settlement_draft' as const,
    totalAmountCents:value.lines.reduce((sum,line)=>sum+line.amountCents,0),sourceEntryIds:[...value.sourceEntryIds],
    createdBy:existing.exists()?String(existing.data().createdBy):user.uid,createdAt:existing.exists()?existing.data().createdAt:now,
    updatedBy:user.uid,updatedAt:now,revision:existing.exists()?Number(existing.data().revision)+1:value.revision||1,voided:false as const}
  await setDoc(reference,next)
  return {...value,...next,createdAt:next.createdAt,updatedAt:next.updatedAt}
}

export { asSettlementSourceEntry }
