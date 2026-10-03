import { collection,doc,getDoc,getDocs,query,where,runTransaction,serverTimestamp } from 'firebase/firestore'
import { auth,db,firebaseConfigured } from '../firebase'
import { businessDateFromLegacy,monthKeyFromBusinessDate,monthSortKeyFromMonthKey,sortKeyFromBusinessDate } from '../lib/businessDate'
import { asSettlementSourceEntry,assertValidPurchaseSettlementDraft,draftIdForSettlement,draftIdForSourceSession,type PurchaseSettlementDraft,type PurchaseSettlementLine } from '../lib/purchaseSettlement'
import { loadWeighingBundle,loadWeighingSessions,type WeighingBundle } from './weighing'
import { canModifyWeighing,type WeighingProductType,type WeighingSession } from '../lib/weighing'

const DRAFT_COLLECTION='purchaseSettlementDrafts'
const SOURCE_COLLECTION='purchaseSettlementSources'

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
    draftId:id,
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

function duplicateDrafts(ids:string[]):never {
  throw new Error(`同一来源称重单存在多个结单草稿，请核查 IDs：${[...new Set(ids)].sort().join(', ')}。`)
}

function validateSourceDraft(draft:PurchaseSettlementDraft,sessionId:string,productType:WeighingProductType){
  if(draft.productType!==productType)throw new Error(`结单类型与来源称重单不一致（${draft.draftId}）。`)
  if(draft.sourceSessionId&&draft.sourceSessionId!==sessionId)throw new Error(`结单关联了另一张称重单，请核查来源（${draft.draftId}）。`)
  if(draft.voided)throw new Error(`结单已作废，不能建立重复草稿（${draft.draftId}）。`)
}

async function boundDrafts(sourceSessionId:string,productType:WeighingProductType){
  const snapshot=await getDocs(query(collection(db,DRAFT_COLLECTION),where('sourceSessionId','==',sourceSessionId)))
  const active=snapshot.docs.filter(item=>item.data().voided!==true).map(item=>draftFrom(item.id,item.data()))
  if(active.length>1)duplicateDrafts(active.map(item=>item.draftId!))
  active.forEach(item=>validateSourceDraft(item,sourceSessionId,productType))
  return active
}

function legacyDraftIds(bundle:WeighingBundle,productType:WeighingProductType){
  const ids=new Set([draftIdForSettlement(productType,sortKeyFromBusinessDate(businessDateFromLegacy(bundle.session.weighingDate)),bundle.session.vesselId)])
  bundle.entries.filter(item=>item.sessionId===bundle.session.id&&item.productType===productType).forEach(entry=>{
    const date=entry.businessDate??entry.weighingDate
    if(date&&entry.vesselId)ids.add(draftIdForSettlement(productType,sortKeyFromBusinessDate(businessDateFromLegacy(date)),entry.vesselId))
  })
  bundle.actions?.filter(action=>action.type==='session_update').forEach(action=>{
    for(const snapshot of [action.beforeSnapshot,action.afterSnapshot]){
      if(snapshot&&typeof snapshot==='object'&&'weighingDate' in snapshot&&typeof snapshot.weighingDate==='string'
        &&'vesselId' in snapshot&&typeof snapshot.vesselId==='string'){
        ids.add(draftIdForSettlement(productType,sortKeyFromBusinessDate(businessDateFromLegacy(snapshot.weighingDate)),snapshot.vesselId))
      }
    }
  })
  return [...ids]
}

function trustedTimestampMillis(value:unknown):number|null {
  const millis=value instanceof Date?value.getTime():value&&typeof value==='object'&&'toMillis' in value&&typeof value.toMillis==='function'?value.toMillis():NaN
  return typeof millis==='number'&&Number.isFinite(millis)?millis:null
}

function originalEntryPredatesDraft(recordedAt:unknown,createdAt:unknown){
  const recorded=trustedTimestampMillis(recordedAt),created=trustedTimestampMillis(createdAt)
  return recorded!==null&&created!==null&&recorded<=created
}

function proveLegacyDraft(draft:PurchaseSettlementDraft,bundle:WeighingBundle,productType:WeighingProductType){
  const entries=new Map(bundle.entries.filter(item=>item.sessionId===bundle.session.id&&item.productType===productType).map(item=>[item.id,item]))
  if(!draft.sourceEntryIds.length||draft.sourceEntryIds.some(id=>!entries.has(id)||!originalEntryPredatesDraft(entries.get(id)!.recordedAt,draft.createdAt)))throw new Error(`无法证明旧结单属于当前称重单，请核查来源（${draft.draftId}）。`)
}

/** Resolves identity only; reading never binds or migrates a legacy document. */
export async function loadPurchaseSettlementDraftForSource(bundle:WeighingBundle,productType:WeighingProductType):Promise<PurchaseSettlementDraft|null>{
  requireUser()
  const sessionId=bundle.session.id,canonicalId=draftIdForSourceSession(productType,sessionId)
  if(bundle.session.productType&&bundle.session.productType!==productType)throw new Error('结单类型与来源称重单不一致。')
  const primary=await boundDrafts(sessionId,productType)
  if(primary.length)return primary[0]
  const guard=await getDoc(doc(db,SOURCE_COLLECTION,canonicalId))
  if(guard.exists()){
    const data=guard.data()
    if(data.productType!==productType||data.sourceSessionId!==sessionId||typeof data.draftId!=='string'||!data.draftId||data.draftId.includes('/'))throw new Error('结单来源绑定格式不正确，请核查。')
    const snapshot=await getDoc(doc(db,DRAFT_COLLECTION,data.draftId))
    if(!snapshot.exists())throw new Error(`来源绑定的结单不存在（${data.draftId}）。`)
    const draft=draftFrom(snapshot.id,snapshot.data())
    validateSourceDraft(draft,sessionId,productType)
    if(!draft.sourceSessionId)throw new Error(`来源绑定缺少对应的结单来源（${draft.draftId}）。`)
    return draft
  }
  const canonical=await getDoc(doc(db,DRAFT_COLLECTION,canonicalId))
  if(canonical.exists())throw new Error(`来源结单无法安全读取，请核查（${canonicalId}）。`)
  const snapshots=await Promise.all(legacyDraftIds(bundle,productType).map(id=>getDoc(doc(db,DRAFT_COLLECTION,id))))
  const legacy=snapshots.filter(item=>item.exists()).map(item=>draftFrom(item.id,item.data()))
  legacy.forEach(draft=>{
    validateSourceDraft(draft,sessionId,productType)
    if(!draft.sourceSessionId)proveLegacyDraft(draft,bundle,productType)
  })
  if(legacy.length>1)duplicateDrafts(legacy.map(item=>item.draftId!))
  return legacy[0]??null
}

export async function loadPurchaseSettlementSource(vesselId:string,businessDate:string,productType:WeighingProductType,
  sessionLoader=loadWeighingSessions,bundleLoader=loadWeighingBundle):Promise<PurchaseSettlementSource>{
  const canonical=businessDateFromLegacy(businessDate)
  const sessions=await sessionLoader()
  const matching=sessions.filter(item=>item.vesselId===vesselId&&item.productType===productType&&item.status!=='voided'
    &&businessDateFromLegacy(item.weighingDate)===canonical)
  if(matching.length>1)throw new Error(`同船同日有多张称重单，请从结单列表选择（${matching.map(item=>item.id).sort().join(', ')}）。`)
  const session=matching[0]??null
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
  if(!value.sourceSessionId)throw new Error('缺少来源称重单，请重新载入。')
  const sourceSessionId=value.sourceSessionId,canonicalId=draftIdForSourceSession(value.productType,sourceSessionId)
  const actualId=value.draftId??canonicalId
  if(!actualId||actualId.includes('/')||['.','..'].includes(actualId)||new TextEncoder().encode(actualId).length>1500)throw new Error('结单 document ID 不正确。')
  const primary=await boundDrafts(sourceSessionId,value.productType)
  if(primary.length&&(!value.draftId||primary[0].draftId!==actualId))throw new Error(`来源称重单已有结单（${primary[0].draftId}），请重新载入。`)
  if(!value.draftId){
    // Identity-only discovery prevents stale new clients from stranding saved legacy prices.
    // This does not introduce the separate stable source revision read protocol (Priority 6).
    const source=await getDoc(doc(db,'weighingSessions',sourceSessionId))
    if(!source.exists())throw new Error('找不到来源称重单。')
    const [entries,actions]=await Promise.all([getDocs(collection(db,'weighingSessions',sourceSessionId,'entries')),getDocs(collection(db,'weighingSessions',sourceSessionId,'actions'))])
    const bundle={session:{...source.data(),id:sourceSessionId} as WeighingSession,
      entries:entries.docs.map(item=>({...item.data(),id:item.id,sessionId:sourceSessionId})) as WeighingBundle['entries'],
      actions:actions.docs.map(item=>({...item.data(),id:item.id})) as WeighingBundle['actions']}
    const resolved=await loadPurchaseSettlementDraftForSource(bundle,value.productType)
    if(resolved)throw new Error(`来源称重单已有结单（${resolved.draftId}），请重新载入。`)
  }
  const date=businessDateFromLegacy(value.businessDate)
  const monthKey=monthKeyFromBusinessDate(date)
  const dateSortKey=sortKeyFromBusinessDate(date)
  const monthSortKey=monthSortKeyFromMonthKey(monthKey)
  const reference=doc(db,DRAFT_COLLECTION,actualId),guardReference=doc(db,SOURCE_COLLECTION,canonicalId)
  return runTransaction(db,async transaction=>{
    const [existing,source,guard]=await Promise.all([transaction.get(reference),transaction.get(doc(db,'weighingSessions',sourceSessionId)),transaction.get(guardReference)])
    if(!source.exists())throw new Error('找不到来源称重单。')
    const session=source.data() as WeighingSession
    if(!canModifyWeighing(session))throw new Error('已超过首次完成称重后的 7 天修改期，或本单已锁定。')
    if(session.vesselId!==value.vesselId||session.vesselCodeSnapshot!==value.vesselCodeSnapshot||session.productType!==value.productType||businessDateFromLegacy(session.weighingDate)!==date
      ||session.revision!==value.sourceSessionRevision)throw new Error('称重资料已变更，请重新载入后检查结单。')
    if(guard.exists()&&(guard.data().draftId!==actualId||guard.data().sourceSessionId!==sourceSessionId||guard.data().productType!==value.productType))throw new Error(`结单来源已绑定至 ${String(guard.data().draftId)}，请重新载入并核查。`)
    if(existing.exists()){
      validateSourceDraft(draftFrom(existing.id,existing.data()),sourceSessionId,value.productType)
      if(!value.draftId||Number(existing.data().revision)!==value.revision)throw new Error('结单已在其他装置修改，请重新载入。')
      if(!existing.data().sourceSessionId){
        if(actualId!==draftIdForSettlement(value.productType,Number(existing.data().dateSortKey),String(existing.data().vesselId)))throw new Error(`无法证明旧结单的 document ID（${actualId}）。`)
        const savedIds=existing.data().sourceEntryIds
        if(!Array.isArray(savedIds)||!savedIds.length||savedIds.some(id=>typeof id!=='string'||!id||id.includes('/')))throw new Error(`无法证明旧结单属于当前称重单（${actualId}）。`)
        const proof=await Promise.all(savedIds.map(id=>transaction.get(doc(db,'weighingSessions',sourceSessionId,'entries',id))))
        if(proof.some(item=>!item.exists()||item.data().sessionId!==sourceSessionId||item.data().productType!==value.productType
          ||!originalEntryPredatesDraft(item.data().recordedAt,existing.data().createdAt)))throw new Error(`无法证明旧结单属于当前称重单（${actualId}）。`)
      }
    }else if(value.draftId)throw new Error(`结单不存在（${actualId}），请重新载入。`)
    const now=serverTimestamp()
    const persisted={...value};delete persisted.draftId
    const next={...persisted,businessDate:date,dateSortKey,monthKey,monthSortKey,status:'settlement_draft' as const,
      totalAmountCents:value.lines.reduce((sum,line)=>sum+line.amountCents,0),sourceEntryIds:[...value.sourceEntryIds],
      createdBy:existing.exists()?String(existing.data().createdBy):user.uid,createdAt:existing.exists()?existing.data().createdAt:now,
      updatedBy:user.uid,updatedAt:now,revision:existing.exists()?Number(existing.data().revision)+1:1,voided:false as const}
    if(!guard.exists())transaction.set(guardReference,{productType:value.productType,sourceSessionId,draftId:actualId,createdBy:user.uid,createdAt:now})
    transaction.set(reference,next)
    transaction.set(doc(reference,'actions',String(next.revision)),{beforeSnapshot:existing.exists()?existing.data():null,
      afterSnapshot:next,performedBy:user.uid,performedAt:now})
    return {...next,draftId:actualId}
  }).catch(async(problem:unknown)=>{
    const code=problem&&typeof problem==='object'&&'code' in problem?String(problem.code):''
    if(code==='permission-denied'){
      if(!value.draftId){
        let competingId:string|undefined,lookupProblem:unknown
        try{
          const competing=await boundDrafts(sourceSessionId,value.productType)
          const guard=await getDoc(guardReference)
          if(guard.exists()){
            const data=guard.data()
            if(data.sourceSessionId!==sourceSessionId||data.productType!==value.productType||typeof data.draftId!=='string'||!data.draftId||data.draftId.includes('/'))throw new Error('结单来源绑定不一致。')
            const existing=await getDoc(doc(db,DRAFT_COLLECTION,data.draftId))
            if(!existing.exists())throw new Error(`来源绑定的结单不存在（${data.draftId}）。`)
            const draft=draftFrom(existing.id,existing.data())
            validateSourceDraft(draft,sourceSessionId,value.productType)
            if(draft.sourceSessionId!==sourceSessionId)throw new Error('结单来源绑定缺少对应来源。')
            if(competing.length&&competing[0].draftId!==data.draftId)duplicateDrafts([competing[0].draftId!,data.draftId])
            competingId=data.draftId
          }else competingId=competing[0]?.draftId
        }catch(lookupError){lookupProblem=lookupError}
        if(competingId)throw new Error(`其他装置已建立来源结单（${competingId}），请重新载入后修改（${code}）。`,{cause:problem})
        if(lookupProblem)throw new Error(`无法保存结单（${code}）；无法重新核查来源：${lookupProblem instanceof Error?lookupProblem.message:'读取失败'} 请重新载入或联系管理员。`,{cause:problem})
      }
      throw new Error(`没有权限保存结单，请重新登录或联系管理员（${code}）。`,{cause:problem})
    }
    if(code==='unavailable'||code==='deadline-exceeded')throw new Error(`网络连接暂时不可用，无法确认结单保存结果；请重新载入后重试（${code}）。`,{cause:problem})
    throw problem
  })
}

export { asSettlementSourceEntry }
