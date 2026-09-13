import { doc,getDoc,runTransaction,serverTimestamp } from 'firebase/firestore'
import { auth,db,firebaseConfigured } from '../firebase'
import { businessDateFromLegacy,monthKeyFromBusinessDate,monthSortKeyFromMonthKey,sortKeyFromBusinessDate } from '../lib/businessDate'
import { asSettlementSourceEntry,assertValidPurchaseSettlementDraft,draftIdForSettlement,type PurchaseSettlementDraft,type PurchaseSettlementLine } from '../lib/purchaseSettlement'
import { loadWeighingBundle,loadWeighingSessions,type WeighingBundle } from './weighing'
import { canModifyWeighing,type WeighingProductType,type WeighingSession } from '../lib/weighing'

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
    ...(typeof data.sourceSessionId==='string'?{sourceSessionId:data.sourceSessionId,sourceSessionRevision:Number(data.sourceSessionRevision)}:{}),
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
  if(!value.sourceSessionId)throw new Error('缺少来源称重单，请重新载入。')
  return runTransaction(db,async transaction=>{
    const [existing,source]=await Promise.all([transaction.get(reference),transaction.get(doc(db,'weighingSessions',value.sourceSessionId!))])
    if(!source.exists())throw new Error('找不到来源称重单。')
    const session=source.data() as WeighingSession
    if(!canModifyWeighing(session))throw new Error('已超过首次完成称重后的 7 天修改期，或本单已锁定。')
    if(session.vesselId!==value.vesselId||session.vesselCodeSnapshot!==value.vesselCodeSnapshot||session.productType!==value.productType||businessDateFromLegacy(session.weighingDate)!==date
      ||session.revision!==value.sourceSessionRevision)throw new Error('称重资料已变更，请重新载入后检查结单。')
    if(existing.exists()&&Number(existing.data().revision)!==value.revision)throw new Error('结单已在其他装置修改，请重新载入。')
    if(existing.exists()&&existing.data().sourceSessionId&&existing.data().sourceSessionId!==value.sourceSessionId)throw new Error('结单来源不一致。')
    const now=serverTimestamp()
    const next={...value,businessDate:date,dateSortKey,monthKey,monthSortKey,status:'settlement_draft' as const,
      totalAmountCents:value.lines.reduce((sum,line)=>sum+line.amountCents,0),sourceEntryIds:[...value.sourceEntryIds],
      createdBy:existing.exists()?String(existing.data().createdBy):user.uid,createdAt:existing.exists()?existing.data().createdAt:now,
      updatedBy:user.uid,updatedAt:now,revision:existing.exists()?Number(existing.data().revision)+1:1,voided:false as const}
    transaction.set(reference,next)
    transaction.set(doc(reference,'actions',String(next.revision)),{beforeSnapshot:existing.exists()?existing.data():null,
      afterSnapshot:next,performedBy:user.uid,performedAt:now})
    return next
  })
}

export { asSettlementSourceEntry }
