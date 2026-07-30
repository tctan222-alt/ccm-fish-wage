import {
  collection,doc,getDoc,getDocs,runTransaction,serverTimestamp,setDoc,writeBatch,
  type DocumentData,
} from 'firebase/firestore'
import { auth,db,firebaseConfigured } from '../firebase'
import {
  DEFAULT_FISH_SPECIES,
  applyEntryCreated,
  applyEntryReplacement,
  completeWeighingSession,
  defaultFishSpeciesToCreate,
  softVoidWeighingEntry,
  type FishSpeciesRecord,
  type WeighingEntry,
  type WeighingSession,
} from '../lib/weighing'
import { assertPurchaseReceiptLineLimits,calculateReceiptTotals,makeReceiptCode,type PurchaseReceiptLine } from '../lib/purchasing'
import type { BusinessPartner } from '../lib/masterData'
import type { PendingWeighingOperation } from './weighingOffline'

export interface WeighingBundle {
  session:WeighingSession
  entries:WeighingEntry[]
  actions?:WeighingAction[]
}

export interface WeighingAction {
  id:string
  type:'create'|'entry_create'|'entry_update'|'entry_void'|'complete'|'reopen'|'process'|'session_void'|'sync_conflict'
  entryId:string|null
  reason:string|null
  performedAt:unknown
  beforeSnapshot:unknown
  afterSnapshot:unknown
}

function requireUser(){
  if(!firebaseConfigured)throw new Error('Firebase 尚未设定。')
  const user=auth.currentUser
  if(!user)throw new Error('请先登录。')
  return user
}

function fishSpeciesFrom(id:string,data:DocumentData):FishSpeciesRecord {
  return {id,speciesCode:String(data.speciesCode),displayName:String(data.displayName),active:Boolean(data.active),
    order:Number(data.order),notes:String(data.notes??''),...data} as FishSpeciesRecord
}

function sessionFrom(id:string,data:DocumentData):WeighingSession {
  return {
    id,sessionCode:String(data.sessionCode),weighingDate:String(data.weighingDate),monthKey:String(data.monthKey),
    externalSlipNo:String(data.externalSlipNo??''),vesselId:String(data.vesselId),
    vesselCodeSnapshot:String(data.vesselCodeSnapshot),vesselNameSnapshot:String(data.vesselNameSnapshot),
    status:data.status as WeighingSession['status'],lastSequenceNo:Number(data.lastSequenceNo),
    fishHeadBasketCount:Number(data.fishHeadBasketCount),fishHeadWeightGrams:Number(data.fishHeadWeightGrams),
    fishMealBucketBasketCount:Number(data.fishMealBucketBasketCount),fishMealBucketWeightGrams:Number(data.fishMealBucketWeightGrams),
    fishMealBagBasketCount:Number(data.fishMealBagBasketCount),fishMealBagWeightGrams:Number(data.fishMealBagWeightGrams),
    fishMealTotalWeightGrams:Number(data.fishMealTotalWeightGrams),totalWeightGrams:Number(data.totalWeightGrams),
    processedReceiptId:data.processedReceiptId?String(data.processedReceiptId):null,
    processedReceiptCode:data.processedReceiptCode?String(data.processedReceiptCode):null,
    notes:String(data.notes??''),revision:Number(data.revision),voidReason:data.voidReason?String(data.voidReason):null,
    createdBy:String(data.createdBy??''),createdAt:data.createdAt,updatedBy:String(data.updatedBy??''),updatedAt:data.updatedAt,
    completedBy:data.completedBy?String(data.completedBy):null,completedAt:data.completedAt??null,
    processedBy:data.processedBy?String(data.processedBy):null,processedAt:data.processedAt??null,
    voidedBy:data.voidedBy?String(data.voidedBy):null,voidedAt:data.voidedAt??null,lastActionId:String(data.lastActionId??''),
  }
}

function entryFrom(id:string,sessionId:string,data:DocumentData):WeighingEntry {
  return {
    id,clientEntryId:String(data.clientEntryId),sessionId,productType:data.productType as WeighingEntry['productType'],
    fishSpeciesId:data.fishSpeciesId?String(data.fishSpeciesId):null,
    fishSpeciesCodeSnapshot:data.fishSpeciesCodeSnapshot?String(data.fishSpeciesCodeSnapshot):null,
    fishSpeciesNameSnapshot:data.fishSpeciesNameSnapshot?String(data.fishSpeciesNameSnapshot):null,
    fishMealQuality:data.fishMealQuality as WeighingEntry['fishMealQuality'],
    displayNameSnapshot:String(data.displayNameSnapshot),entryMode:data.entryMode as WeighingEntry['entryMode'],
    sequenceNo:data.sequenceNo===null?null:Number(data.sequenceNo),weightGrams:Number(data.weightGrams),remark:String(data.remark??''),
    recordedAtClient:String(data.recordedAtClient),recordedAt:data.recordedAt,recordedBy:String(data.recordedBy),
    syncStatus:'synced',voided:Boolean(data.voided),voidReason:data.voidReason?String(data.voidReason):null,
    voidedBy:data.voidedBy?String(data.voidedBy):null,voidedAt:data.voidedAt??null,revision:Number(data.revision),
    updatedBy:data.updatedBy?String(data.updatedBy):null,updatedAt:data.updatedAt??null,lastActionId:String(data.lastActionId??''),
  }
}

function storedEntry(entry:WeighingEntry,userId:string,timestamp:unknown,lastActionId:string,isCreate:boolean){
  return {
    clientEntryId:entry.clientEntryId,sessionId:entry.sessionId,productType:entry.productType,fishSpeciesId:entry.fishSpeciesId,
    fishSpeciesCodeSnapshot:entry.fishSpeciesCodeSnapshot,fishSpeciesNameSnapshot:entry.fishSpeciesNameSnapshot,
    fishMealQuality:entry.fishMealQuality,displayNameSnapshot:entry.displayNameSnapshot,entryMode:entry.entryMode,
    sequenceNo:entry.sequenceNo,weightGrams:entry.weightGrams,remark:entry.remark,voided:entry.voided,
    voidReason:entry.voidReason,voidedBy:entry.voided?userId:null,voidedAt:entry.voided?timestamp:null,
    revision:entry.revision,recordedAtClient:entry.recordedAtClient,recordedAt:isCreate?timestamp:entry.recordedAt,
    recordedBy:entry.recordedBy,updatedAt:timestamp,updatedBy:userId,lastActionId,
  }
}

function storedSession(session:WeighingSession,userId:string,timestamp:unknown,lastActionId:string,isCreate:boolean){
  return {
    sessionCode:session.sessionCode,weighingDate:session.weighingDate,monthKey:session.monthKey,
    externalSlipNo:session.externalSlipNo,vesselId:session.vesselId,vesselCodeSnapshot:session.vesselCodeSnapshot,
    vesselNameSnapshot:session.vesselNameSnapshot,status:session.status,lastSequenceNo:session.lastSequenceNo,
    fishHeadBasketCount:session.fishHeadBasketCount,fishHeadWeightGrams:session.fishHeadWeightGrams,
    fishMealBucketBasketCount:session.fishMealBucketBasketCount,fishMealBucketWeightGrams:session.fishMealBucketWeightGrams,
    fishMealBagBasketCount:session.fishMealBagBasketCount,fishMealBagWeightGrams:session.fishMealBagWeightGrams,
    fishMealTotalWeightGrams:session.fishMealTotalWeightGrams,totalWeightGrams:session.totalWeightGrams,
    processedReceiptId:session.processedReceiptId,processedReceiptCode:session.processedReceiptCode,notes:session.notes,
    revision:session.revision,createdBy:isCreate?userId:session.createdBy,createdAt:isCreate?timestamp:session.createdAt,
    updatedBy:userId,updatedAt:timestamp,completedBy:session.completedBy??null,completedAt:session.completedAt??null,
    processedBy:session.processedBy??null,processedAt:session.processedAt??null,voidedBy:session.voidedBy??null,
    voidedAt:session.voidedAt??null,voidReason:session.voidReason,lastActionId,
  }
}

export async function loadFishSpecies(){
  const snapshot=await getDocs(collection(db,'fishSpecies'))
  return snapshot.docs.map(item=>fishSpeciesFrom(item.id,item.data())).sort((a,b)=>a.order-b.order)
}

export async function initializeDefaultFishSpecies(existing:FishSpeciesRecord[]){
  const user=requireUser(),missing=defaultFishSpeciesToCreate(existing)
  if(!missing.length)return existing
  const batch=writeBatch(db),timestamp=serverTimestamp()
  missing.forEach(item=>batch.set(doc(db,'fishSpecies',item.id),{
    speciesCode:item.speciesCode,displayName:item.displayName,active:true,order:item.order,notes:'',
    createdBy:user.uid,createdAt:timestamp,updatedBy:user.uid,updatedAt:timestamp,inactiveBy:null,inactiveAt:null,
  }))
  await batch.commit()
  return [...existing,...missing].sort((a,b)=>a.order-b.order)
}

export async function saveFishSpecies(value:FishSpeciesRecord){
  const user=requireUser(),ref=doc(db,'fishSpecies',value.id),snapshot=await getDoc(ref),timestamp=serverTimestamp()
  if(!/^[a-z0-9_]{1,40}$/.test(value.speciesCode))throw new Error('鱼名代码格式不正确。')
  if(!value.displayName.trim())throw new Error('请输入中文鱼名。')
  if(snapshot.exists()&&snapshot.data().speciesCode!==value.speciesCode)throw new Error('鱼名代码建立后不可修改。')
  const original=snapshot.data()
  await writeBatch(db).set(ref,{
    speciesCode:value.speciesCode,displayName:value.displayName.trim(),active:value.active,order:value.order,notes:value.notes.trim(),
    createdBy:original?.createdBy??user.uid,createdAt:original?.createdAt??timestamp,updatedBy:user.uid,updatedAt:timestamp,
    inactiveBy:value.active?null:(original?.inactiveBy??user.uid),inactiveAt:value.active?null:(original?.inactiveAt??timestamp),
  }).commit()
  return value
}

export async function loadWeighingSessions(){
  const snapshot=await getDocs(collection(db,'weighingSessions'))
  return snapshot.docs.map(item=>sessionFrom(item.id,item.data())).sort((a,b)=>b.weighingDate.localeCompare(a.weighingDate)||b.sessionCode.localeCompare(a.sessionCode))
}

export async function loadWeighingBundle(sessionId:string):Promise<WeighingBundle>{
  const ref=doc(db,'weighingSessions',sessionId)
  const [sessionSnapshot,entrySnapshot,actionSnapshot]=await Promise.all([
    getDoc(ref),getDocs(collection(ref,'entries')),getDocs(collection(ref,'actions')),
  ])
  if(!sessionSnapshot.exists())throw new Error('找不到现场称重单。')
  return {session:sessionFrom(ref.id,sessionSnapshot.data()),
    entries:entrySnapshot.docs.map(item=>entryFrom(item.id,sessionId,item.data()))
      .sort((a,b)=>b.recordedAtClient.localeCompare(a.recordedAtClient)||b.id.localeCompare(a.id)),
    actions:actionSnapshot.docs.map(item=>({id:item.id,type:item.data().type,entryId:item.data().entryId??null,
      reason:item.data().reason??null,performedAt:item.data().performedAt,beforeSnapshot:item.data().beforeSnapshot,
      afterSnapshot:item.data().afterSnapshot} as WeighingAction))}
}

export async function findOpenWeighingSession(vesselId:string,weighingDate:string){
  const sessions=await loadWeighingSessions()
  const open=sessions.find(item=>item.vesselId===vesselId&&item.weighingDate===weighingDate&&item.status==='weighing')
  return open?loadWeighingBundle(open.id):null
}

export async function syncWeighingOperation(operation:PendingWeighingOperation){
  const user=requireUser(),sessionRef=doc(db,'weighingSessions',operation.sessionId),timestamp=serverTimestamp()
  if(operation.type==='entry_create'){
    const payload=operation.payload as {session:WeighingSession;entry:WeighingEntry}
    const entryRef=doc(sessionRef,'entries',payload.entry.clientEntryId),actionId=operation.id
    return runTransaction(db,async transaction=>{
      const [sessionSnapshot,entrySnapshot]=await Promise.all([transaction.get(sessionRef),transaction.get(entryRef)])
      if(entrySnapshot.exists()){
        const currentSession=sessionSnapshot.exists()?sessionFrom(sessionRef.id,sessionSnapshot.data()):payload.session
        return {session:currentSession,entry:entryFrom(entryRef.id,sessionRef.id,entrySnapshot.data())}
      }
      const base=sessionSnapshot.exists()?sessionFrom(sessionRef.id,sessionSnapshot.data()):payload.session
      const next=applyEntryCreated(base,payload.entry)
      transaction.set(sessionRef,storedSession(next,user.uid,timestamp,actionId,!sessionSnapshot.exists()),{merge:false})
      transaction.set(entryRef,storedEntry(payload.entry,user.uid,timestamp,actionId,true))
      transaction.set(doc(sessionRef,'actions',actionId),{type:'entry_create',sessionId:sessionRef.id,entryId:entryRef.id,
        reason:null,performedBy:user.uid,performedAt:timestamp,beforeSnapshot:null,
        afterSnapshot:{revision:payload.entry.revision,weightGrams:payload.entry.weightGrams},clientOperationId:operation.id})
      if(!sessionSnapshot.exists()){
        transaction.set(doc(sessionRef,'actions',`create_${sessionRef.id}`),{type:'create',sessionId:sessionRef.id,entryId:null,
          reason:null,performedBy:user.uid,performedAt:timestamp,beforeSnapshot:null,
          afterSnapshot:{status:'weighing',revision:next.revision},clientOperationId:`create_${sessionRef.id}`})
      }
      return {session:{...next,lastActionId:actionId},entry:{...payload.entry,syncStatus:'synced',lastActionId:actionId}}
    })
  }
  if(operation.type==='entry_update'||operation.type==='entry_void'){
    const payload=operation.payload as {before:WeighingEntry;after:WeighingEntry}
    const entryRef=doc(sessionRef,'entries',payload.after.id),actionId=operation.id
    try{return await runTransaction(db,async transaction=>{
      const [sessionSnapshot,entrySnapshot]=await Promise.all([transaction.get(sessionRef),transaction.get(entryRef)])
      if(!sessionSnapshot.exists()||!entrySnapshot.exists())throw new Error('找不到需要同步的称重记录。')
      const currentSession=sessionFrom(sessionRef.id,sessionSnapshot.data()),currentEntry=entryFrom(entryRef.id,sessionRef.id,entrySnapshot.data())
      if(currentEntry.revision===payload.after.revision&&currentEntry.lastActionId===actionId)return {session:currentSession,entry:currentEntry}
      if(currentEntry.revision!==payload.before.revision)throw new WeighingRevisionConflictError()
      const result=operation.type==='entry_void'
        ?softVoidWeighingEntry(currentSession,currentEntry,payload.after.voidReason??'撤回记录')
        :{session:applyEntryReplacement(currentSession,currentEntry,payload.after),
          entry:{...payload.after,recordedAt:currentEntry.recordedAt,recordedBy:currentEntry.recordedBy}}
      transaction.set(entryRef,storedEntry(result.entry,user.uid,timestamp,actionId,false),{merge:false})
      transaction.set(sessionRef,storedSession(result.session,user.uid,timestamp,actionId,false),{merge:false})
      transaction.set(doc(sessionRef,'actions',actionId),{type:operation.type,sessionId:sessionRef.id,entryId:entryRef.id,
        reason:payload.after.voidReason??null,performedBy:user.uid,performedAt:timestamp,
        beforeSnapshot:{revision:currentEntry.revision,weightGrams:currentEntry.weightGrams,voided:currentEntry.voided},
        afterSnapshot:{revision:result.entry.revision,weightGrams:result.entry.weightGrams,voided:result.entry.voided},
        clientOperationId:operation.id})
      return {session:{...result.session,lastActionId:actionId},entry:{...result.entry,syncStatus:'synced',lastActionId:actionId}}
    })}catch(problem){
      if(problem instanceof WeighingRevisionConflictError){
        const conflictId=`sync_conflict_${operation.id}`
        await setDoc(doc(sessionRef,'actions',conflictId),{type:'sync_conflict',sessionId:sessionRef.id,entryId:payload.after.id,
          reason:'修订版本冲突',performedBy:user.uid,performedAt:serverTimestamp(),
          beforeSnapshot:{expectedRevision:payload.before.revision},afterSnapshot:{attemptedRevision:payload.after.revision},
          clientOperationId:operation.id}).catch(()=>undefined)
      }
      throw problem
    }
  }
  const actionId=operation.id
  return runTransaction(db,async transaction=>{
    const snapshot=await transaction.get(sessionRef)
    if(!snapshot.exists())throw new Error('找不到需要完成的现场称重单。')
    const current=sessionFrom(sessionRef.id,snapshot.data())
    if(current.status==='completed')return {session:current}
    const completed=completeWeighingSession(current)
    transaction.set(sessionRef,storedSession({...completed,completedBy:user.uid,completedAt:timestamp},user.uid,timestamp,actionId,false),{merge:false})
    transaction.set(doc(sessionRef,'actions',actionId),{type:'complete',sessionId:sessionRef.id,entryId:null,reason:null,
      performedBy:user.uid,performedAt:timestamp,beforeSnapshot:{status:'weighing',revision:current.revision},
      afterSnapshot:{status:'completed',revision:completed.revision},clientOperationId:operation.id})
    return {session:{...completed,completedBy:user.uid,completedAt:timestamp,lastActionId:actionId}}
  })
}

export async function reopenWeighingSession(sessionId:string,reason:string){
  const clean=reason.trim();if(clean.length<3||clean.length>100)throw new Error('重开原因必须为 3 至 100 个字符。')
  const user=requireUser(),sessionRef=doc(db,'weighingSessions',sessionId),actionRef=doc(collection(sessionRef,'actions')),timestamp=serverTimestamp()
  return runTransaction(db,async transaction=>{
    const snapshot=await transaction.get(sessionRef)
    if(!snapshot.exists())throw new Error('找不到现场称重单。')
    const current=sessionFrom(sessionId,snapshot.data())
    if(current.status==='processed')throw new Error('已处理的现场单不能重开。')
    if(current.status!=='completed')throw new Error('只有已完成的现场单可以重开。')
    const next={...current,status:'weighing' as const,revision:current.revision+1,completedBy:null,completedAt:null,lastActionId:actionRef.id}
    transaction.set(sessionRef,storedSession(next,user.uid,timestamp,actionRef.id,false),{merge:false})
    transaction.set(actionRef,{type:'reopen',sessionId,entryId:null,reason:clean,performedBy:user.uid,performedAt:timestamp,
      beforeSnapshot:{status:current.status,revision:current.revision},afterSnapshot:{status:next.status,revision:next.revision},
      clientOperationId:actionRef.id})
    return next
  })
}

export async function voidWeighingSession(sessionId:string,reason:string){
  const clean=reason.trim();if(clean.length<3||clean.length>100)throw new Error('作废原因必须为 3 至 100 个字符。')
  const user=requireUser(),sessionRef=doc(db,'weighingSessions',sessionId),actionRef=doc(collection(sessionRef,'actions')),timestamp=serverTimestamp()
  return runTransaction(db,async transaction=>{
    const snapshot=await transaction.get(sessionRef)
    if(!snapshot.exists())throw new Error('找不到现场称重单。')
    const current=sessionFrom(sessionId,snapshot.data())
    if(current.status==='processed')throw new Error('已处理的现场单不能作废。')
    if(current.status==='voided')throw new Error('现场单已经作废。')
    const next={...current,status:'voided' as const,revision:current.revision+1,voidReason:clean,
      voidedBy:user.uid,voidedAt:timestamp,lastActionId:actionRef.id}
    transaction.set(sessionRef,storedSession(next,user.uid,timestamp,actionRef.id,false),{merge:false})
    transaction.set(actionRef,{type:'session_void',sessionId,entryId:null,reason:clean,performedBy:user.uid,performedAt:timestamp,
      beforeSnapshot:{status:current.status,revision:current.revision},afterSnapshot:{status:next.status,revision:next.revision},
      clientOperationId:actionRef.id})
    return next
  })
}

export async function processWeighingSessionToReceipt(input:{
  sessionId:string
  supplier:BusinessPartner
  lines:PurchaseReceiptLine[]
}){
  const user=requireUser(),sessionRef=doc(db,'weighingSessions',input.sessionId),receiptRef=doc(collection(db,'purchaseReceipts'))
  const purchaseActionRef=doc(collection(receiptRef,'actions')),processActionRef=doc(sessionRef,'actions',`process_${receiptRef.id}`)
  const lineRefs=input.lines.map(()=>doc(collection(receiptRef,'lines'))),timestamp=serverTimestamp()
  if(!input.supplier.active||!input.supplier.supplier)throw new Error('请选择有效 Supplier。')
  if(!input.lines.length)throw new Error('现场称重单没有可生成的汇总记录。')
  assertPurchaseReceiptLineLimits(input.lines)
  const result=await runTransaction(db,async transaction=>{
    const [sessionSnapshot,supplierSnapshot]=await Promise.all([
      transaction.get(sessionRef),transaction.get(doc(db,'businessPartners',input.supplier.id)),
    ])
    if(!sessionSnapshot.exists())throw new Error('找不到现场称重单。')
    const current=sessionFrom(input.sessionId,sessionSnapshot.data())
    if(current.status==='processed'&&current.processedReceiptId&&current.processedReceiptCode){
      return {receiptId:current.processedReceiptId,receiptCode:current.processedReceiptCode,alreadyProcessed:true}
    }
    if(current.status!=='completed')throw new Error('只有已完成的现场单可以生成采购单。')
    if(!supplierSnapshot.exists()||supplierSnapshot.data().active!==true||supplierSnapshot.data().supplier!==true){
      throw new Error('Supplier 已停用或不存在。')
    }
    const vesselSnap=await transaction.get(doc(db,'vessels',current.vesselId))
    if(!vesselSnap.exists()||vesselSnap.data().active!==true)throw new Error('船号已停用或不存在。')
    const supplierData=supplierSnapshot.data(),vesselData=vesselSnap.data()
    const receiptCode=makeReceiptCode(receiptRef.id),totals=calculateReceiptTotals(input.lines),lineIds=lineRefs.map(ref=>ref.id)
    transaction.set(receiptRef,{
      receiptCode,receiptDate:current.weighingDate,monthKey:current.monthKey,externalSlipNo:current.externalSlipNo,
      supplierId:input.supplier.id,supplierCodeSnapshot:String(supplierData.partnerCode),supplierNameSnapshot:String(supplierData.displayName),
      vesselId:current.vesselId,vesselCodeSnapshot:String(vesselData.vesselCode),vesselNameSnapshot:String(vesselData.displayName),
      status:'draft',...totals,paidCents:0,paymentStatus:'unpaid',notes:`来源：${current.sessionCode}`,
      duplicateAcknowledged:false,createdBy:user.uid,createdAt:timestamp,updatedBy:user.uid,updatedAt:timestamp,
      lastActionId:purchaseActionRef.id,confirmedBy:null,confirmedAt:null,voidedBy:null,voidedAt:null,voidReason:null,
      lineIds,draftVersion:1,sourceWeighingSessionId:current.id,
    })
    input.lines.forEach((line,index)=>transaction.set(lineRefs[index],{
      lineNo:index+1,categoryId:line.categoryId,categoryCodeSnapshot:line.categoryCodeSnapshot,
      categoryNameSnapshot:line.categoryNameSnapshot,basketCount:line.basketCount,weightGrams:line.weightGrams,
      unitPriceCentsPerKg:line.unitPriceCentsPerKg,amountCents:line.amountCents,notes:line.notes,
      sourceWeighingSessionId:current.id,productType:line.productType??null,fishSpeciesCode:line.fishSpeciesCode??null,
      fishMealQuality:line.fishMealQuality??null,createdAt:timestamp,updatedAt:timestamp,
    }))
    transaction.set(purchaseActionRef,{type:'create',receiptId:receiptRef.id,receiptCode,
      supplierId:input.supplier.id,vesselId:current.vesselId,performedBy:user.uid,performedAt:timestamp,
      afterSnapshot:{...totals,status:'draft',draftVersion:1}})
    const processed={...current,status:'processed' as const,processedReceiptId:receiptRef.id,processedReceiptCode:receiptCode,
      processedBy:user.uid,processedAt:timestamp,revision:current.revision+1,lastActionId:processActionRef.id}
    transaction.set(sessionRef,storedSession(processed,user.uid,timestamp,processActionRef.id,false),{merge:false})
    transaction.set(processActionRef,{type:'process',sessionId:current.id,entryId:null,reason:null,performedBy:user.uid,
      performedAt:timestamp,beforeSnapshot:{status:'completed',revision:current.revision},
      afterSnapshot:{status:'processed',revision:processed.revision,receiptId:receiptRef.id,receiptCode},
      clientOperationId:processActionRef.id})
    return {receiptId:receiptRef.id,receiptCode,alreadyProcessed:false}
  })
  return result
}

export { DEFAULT_FISH_SPECIES }

class WeighingRevisionConflictError extends Error {
  constructor(){super('记录已在其他装置修改，请重新载入后检查。')}
}
