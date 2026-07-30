import {
  collection,doc,getDoc,getDocs,query,runTransaction,serverTimestamp,
  where,writeBatch,type DocumentData,type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { auth,db,firebaseConfigured } from '../firebase'
import {
  applyPurchasePayment,assertPaymentCanVoid,assertPurchaseReceiptLineLimits,calculateReceiptTotals,confirmReceipt,lineAmountCents,makeReceiptCode,
  voidPurchasePayment,voidReceipt,type PaymentMethod,type PurchasePayment,
  type PurchaseReceipt,type PurchaseReceiptLine,
} from '../lib/purchasing'

function uid(){
  if(!firebaseConfigured)throw new Error('Firebase is not configured')
  const user=auth.currentUser;if(!user)throw new Error('Authentication is required')
  return user.uid
}
function lineFrom(id:string,data:DocumentData):PurchaseReceiptLine{
  return {id,lineNo:Number(data.lineNo),categoryId:String(data.categoryId),categoryCodeSnapshot:String(data.categoryCodeSnapshot),
    categoryNameSnapshot:String(data.categoryNameSnapshot),basketCount:Number(data.basketCount),weightGrams:Number(data.weightGrams),
    unitPriceCentsPerKg:Number(data.unitPriceCentsPerKg),amountCents:Number(data.amountCents),notes:String(data.notes??''),
    sourceWeighingSessionId:data.sourceWeighingSessionId?String(data.sourceWeighingSessionId):null,
    productType:data.productType??null,fishSpeciesCode:data.fishSpeciesCode?String(data.fishSpeciesCode):null,
    fishMealQuality:data.fishMealQuality??null,
    createdAt:data.createdAt,updatedAt:data.updatedAt}
}
const line=(item:QueryDocumentSnapshot<DocumentData>)=>lineFrom(item.id,item.data())
function receipt(id:string,data:DocumentData,lines:PurchaseReceiptLine[]=[]):PurchaseReceipt{
  return {id,receiptCode:String(data.receiptCode),receiptDate:String(data.receiptDate),monthKey:String(data.monthKey),
    externalSlipNo:String(data.externalSlipNo??''),supplierId:String(data.supplierId),supplierCodeSnapshot:String(data.supplierCodeSnapshot),
    supplierNameSnapshot:String(data.supplierNameSnapshot),vesselId:String(data.vesselId),vesselCodeSnapshot:String(data.vesselCodeSnapshot),
    vesselNameSnapshot:String(data.vesselNameSnapshot),status:data.status,lineCount:Number(data.lineCount),totalBasketCount:Number(data.totalBasketCount),
    totalWeightGrams:Number(data.totalWeightGrams),totalAmountCents:Number(data.totalAmountCents),paidCents:Number(data.paidCents),
    paymentStatus:data.paymentStatus,notes:String(data.notes??''),duplicateAcknowledged:data.duplicateAcknowledged===true,lines,
    createdBy:data.createdBy,createdAt:data.createdAt,updatedBy:data.updatedBy,updatedAt:data.updatedAt,lastActionId:String(data.lastActionId??''),
    lineIds:Array.isArray(data.lineIds)?data.lineIds.map(String):[],draftVersion:Number(data.draftVersion??0),
    sourceWeighingSessionId:data.sourceWeighingSessionId?String(data.sourceWeighingSessionId):null,
    confirmedBy:data.confirmedBy??null,confirmedAt:data.confirmedAt??null,voidedBy:data.voidedBy??null,voidedAt:data.voidedAt??null,
    voidReason:data.voidReason??null}
}
function receiptData(value:PurchaseReceipt,userId:string,isCreate:boolean,lastActionId:string,lineIds:string[],draftVersion:number){
  const totals=calculateReceiptTotals(value.lines)
  return {receiptCode:value.receiptCode,receiptDate:value.receiptDate,monthKey:value.receiptDate.slice(0,7),
    externalSlipNo:value.externalSlipNo.trim(),supplierId:value.supplierId,supplierCodeSnapshot:value.supplierCodeSnapshot,
    supplierNameSnapshot:value.supplierNameSnapshot,vesselId:value.vesselId,vesselCodeSnapshot:value.vesselCodeSnapshot,
    vesselNameSnapshot:value.vesselNameSnapshot,status:'draft',...totals,paidCents:0,paymentStatus:'unpaid',notes:value.notes.trim(),
    duplicateAcknowledged:value.duplicateAcknowledged,updatedBy:userId,updatedAt:serverTimestamp(),lastActionId,lineIds,draftVersion,
    sourceWeighingSessionId:value.sourceWeighingSessionId??null,
    ...(isCreate?{createdBy:userId,createdAt:serverTimestamp(),confirmedBy:null,confirmedAt:null,voidedBy:null,voidedAt:null,voidReason:null}:{})}
}
function actionData(type:string,value:PurchaseReceipt,userId:string,extra:Record<string,unknown>={}){
  return {type,receiptId:value.id,receiptCode:value.receiptCode,supplierId:value.supplierId,vesselId:value.vesselId,
    performedBy:userId,performedAt:serverTimestamp(),...extra}
}
function lineData(value:PurchaseReceiptLine,isCreate:boolean){
  return {lineNo:value.lineNo,categoryId:value.categoryId,categoryCodeSnapshot:value.categoryCodeSnapshot,
    categoryNameSnapshot:value.categoryNameSnapshot,basketCount:value.basketCount,weightGrams:value.weightGrams,
    unitPriceCentsPerKg:value.unitPriceCentsPerKg,amountCents:lineAmountCents(value.weightGrams,value.unitPriceCentsPerKg),
    notes:value.notes.trim(),sourceWeighingSessionId:value.sourceWeighingSessionId??null,productType:value.productType??null,
    fishSpeciesCode:value.fishSpeciesCode??null,fishMealQuality:value.fishMealQuality??null,
    updatedAt:serverTimestamp(),...(isCreate?{createdAt:serverTimestamp()}:{})}
}

export async function loadPurchaseReceipts(){
  const snap=await getDocs(collection(db,'purchaseReceipts'))
  return snap.docs.map(item=>receipt(item.id,item.data())).sort((a,b)=>b.receiptDate.localeCompare(a.receiptDate)||b.receiptCode.localeCompare(a.receiptCode))
}
export async function loadPurchaseReceipt(id:string){
  const ref=doc(db,'purchaseReceipts',id);const item=await getDoc(ref)
  if(!item.exists())throw new Error('Receipt was not found.')
  const lines=await getDocs(collection(ref,'lines'))
  return receipt(item.id,item.data(),lines.docs.map(line).sort((a,b)=>a.lineNo-b.lineNo))
}
export async function loadPurchasePayments(receiptId?:string){
  const source=receiptId?query(collection(db,'purchasePayments'),where('receiptId','==',receiptId)):collection(db,'purchasePayments')
  const snap=await getDocs(source)
  return snap.docs.map(item=>({id:item.id,...item.data()} as PurchasePayment))
}
export async function saveDraftReceipt(value:PurchaseReceipt){
  assertPurchaseReceiptLineLimits(value.lines)
  const userId=uid();const isCreate=!value.id
  const receiptRef=isCreate?doc(collection(db,'purchaseReceipts')):doc(db,'purchaseReceipts',value.id)
  const next={...value,id:receiptRef.id,receiptCode:isCreate?makeReceiptCode(receiptRef.id):value.receiptCode,status:'draft' as const}
  const actionRef=doc(collection(receiptRef,'actions'))
  const prepared=next.lines.map((item,index)=>{
    const ref=item.id?doc(receiptRef,'lines',item.id):doc(collection(receiptRef,'lines'))
    return {ref,value:{...item,id:ref.id,lineNo:index+1}}
  })
  await runTransaction(db,async transaction=>{
    let previousIds:string[]=[];let draftVersion=1
    if(!isCreate){
      const snap=await transaction.get(receiptRef)
      if(!snap.exists()||snap.data().status!=='draft')throw new Error('Only Draft receipts can be edited.')
      const currentVersion=Number(snap.data().draftVersion??0)
      if(currentVersion!==Number(value.draftVersion??0))throw new Error('This Draft changed in another session. Reload before saving.')
      previousIds=Array.isArray(snap.data().lineIds)?snap.data().lineIds.map(String):[]
      draftVersion=currentVersion+1
    }
    const lineIds=prepared.map(item=>item.ref.id);const retained=new Set(lineIds)
    transaction.set(receiptRef,receiptData(next,userId,isCreate,actionRef.id,lineIds,draftVersion),{merge:!isCreate})
    prepared.forEach(item=>transaction.set(item.ref,lineData(item.value,!previousIds.includes(item.ref.id)),{merge:previousIds.includes(item.ref.id)}))
    previousIds.filter(id=>!retained.has(id)).forEach(id=>transaction.delete(doc(receiptRef,'lines',id)))
    transaction.set(actionRef,actionData(isCreate?'create':'update_draft',next,userId,{afterSnapshot:{...calculateReceiptTotals(next.lines),status:'draft',draftVersion}}))
  })
  return loadPurchaseReceipt(receiptRef.id)
}
export async function confirmPurchaseReceipt(value:PurchaseReceipt){
  const userId=uid()
  const receiptRef=doc(db,'purchaseReceipts',value.id);const actionRef=doc(collection(receiptRef,'actions'))
  await runTransaction(db,async transaction=>{
    const receiptSnap=await transaction.get(receiptRef)
    if(!receiptSnap.exists()||receiptSnap.data().status!=='draft')throw new Error('Only a Draft receipt can be confirmed.')
    const current=receipt(value.id,receiptSnap.data())
    if(current.draftVersion!==Number(value.draftVersion??0))throw new Error('This Draft changed in another session. Reload before confirming.')
    if(!current.lineIds?.length)throw new Error('Receipt needs at least one line.')
    const lineSnaps=await Promise.all(current.lineIds.map(id=>transaction.get(doc(receiptRef,'lines',id))))
    if(lineSnaps.some(item=>!item.exists()))throw new Error('A Draft line is missing. Reload before confirming.')
    const currentLines=lineSnaps.map(item=>lineFrom(item.id,item.data()!))
    assertPurchaseReceiptLineLimits(currentLines)
    const supplierRef=doc(db,'businessPartners',current.supplierId),vesselRef=doc(db,'vessels',current.vesselId)
    const categoryRefs=Array.from(new Set(currentLines.map(item=>item.categoryId))).map(id=>doc(db,'purchaseCategories',id))
    const [supplierSnap,vesselSnap,...categorySnaps]=await Promise.all([
      transaction.get(supplierRef),transaction.get(vesselRef),...categoryRefs.map(ref=>transaction.get(ref)),
    ])
    if(!supplierSnap.exists()||supplierSnap.data().active!==true||supplierSnap.data().supplier!==true)throw new Error('The selected Supplier is no longer active.')
    if(!vesselSnap.exists()||vesselSnap.data().active!==true)throw new Error('The selected Vessel is no longer active.')
    const categories=new Map(categorySnaps.map(item=>[item.id,item.data()]))
    if(categorySnaps.some(item=>!item.exists()||item.data().active!==true))throw new Error('A selected Category is no longer active.')
    const confirmedLines=currentLines.map(item=>{const master=categories.get(item.categoryId)!
      return {...item,categoryCodeSnapshot:String(master.categoryCode),categoryNameSnapshot:String(master.displayName),
        amountCents:lineAmountCents(item.weightGrams,item.unitPriceCentsPerKg)}})
    const next=confirmReceipt({...current,lines:confirmedLines})
    transaction.update(receiptRef,{supplierCodeSnapshot:String(supplierSnap.data().partnerCode),supplierNameSnapshot:String(supplierSnap.data().displayName),
      vesselCodeSnapshot:String(vesselSnap.data().vesselCode),vesselNameSnapshot:String(vesselSnap.data().displayName),
      status:'confirmed',lineCount:next.lineCount,totalBasketCount:next.totalBasketCount,totalWeightGrams:next.totalWeightGrams,
      totalAmountCents:next.totalAmountCents,paymentStatus:next.paymentStatus,confirmedBy:userId,confirmedAt:serverTimestamp(),
      updatedBy:userId,updatedAt:serverTimestamp(),lastActionId:actionRef.id})
    confirmedLines.forEach(item=>transaction.update(doc(receiptRef,'lines',item.id),{categoryCodeSnapshot:item.categoryCodeSnapshot,
      categoryNameSnapshot:item.categoryNameSnapshot,amountCents:item.amountCents,updatedAt:serverTimestamp()}))
    const actionReceipt={...next,supplierCodeSnapshot:String(supplierSnap.data().partnerCode),supplierNameSnapshot:String(supplierSnap.data().displayName),
      vesselCodeSnapshot:String(vesselSnap.data().vesselCode),vesselNameSnapshot:String(vesselSnap.data().displayName)}
    transaction.set(actionRef,actionData('confirm',actionReceipt,userId,{afterSnapshot:{status:'confirmed',lineCount:next.lineCount,
      totalBasketCount:next.totalBasketCount,totalWeightGrams:next.totalWeightGrams,totalAmountCents:next.totalAmountCents}}))
  })
  return loadPurchaseReceipt(value.id)
}
export async function voidPurchaseReceiptRecord(value:PurchaseReceipt,reason:string){
  const userId=uid();const next=voidReceipt(value,reason);const receiptRef=doc(db,'purchaseReceipts',value.id);const actionRef=doc(collection(receiptRef,'actions'))
  const batch=writeBatch(db);batch.update(receiptRef,{status:'voided',voidReason:next.voidReason,voidedBy:userId,voidedAt:serverTimestamp(),
    updatedBy:userId,updatedAt:serverTimestamp(),lastActionId:actionRef.id})
  batch.set(actionRef,actionData('void',next,userId,{reason:next.voidReason,beforeSnapshot:{status:'confirmed',paidCents:value.paidCents},afterSnapshot:{status:'voided'}}))
  await batch.commit();return loadPurchaseReceipt(value.id)
}
export interface PurchasePaymentInput {amountCents:number;method:PaymentMethod;paymentDate:string;reference:string;note:string;paymentGroupId?:string}
export async function createPurchasePayment(value:PurchaseReceipt,input:PurchasePaymentInput){
  const userId=uid();const paymentRef=doc(collection(db,'purchasePayments'));const group=input.paymentGroupId||paymentRef.id
  await runTransaction(db,async transaction=>{
    const receiptRef=doc(db,'purchaseReceipts',value.id);const snap=await transaction.get(receiptRef)
    if(!snap.exists())throw new Error('Receipt was not found.')
    const current=receipt(value.id,snap.data());const next=applyPurchasePayment(current,input.amountCents)
    transaction.set(paymentRef,{paymentGroupId:group,receiptId:current.id,receiptCode:current.receiptCode,supplierId:current.supplierId,
      supplierNameSnapshot:current.supplierNameSnapshot,amountCents:input.amountCents,method:input.method,paymentDate:input.paymentDate,
      reference:input.reference.trim(),note:input.note.trim(),createdBy:userId,createdAt:serverTimestamp(),voided:false,
      voidReason:null,voidedBy:null,voidedAt:null})
    const actionRef=doc(collection(receiptRef,'actions'))
    transaction.update(receiptRef,{paidCents:next.paidCents,paymentStatus:next.paymentStatus,updatedBy:userId,updatedAt:serverTimestamp(),lastActionId:actionRef.id})
    transaction.set(actionRef,actionData('payment_create',current,userId,{paymentId:paymentRef.id,
      afterSnapshot:{paidCents:next.paidCents,paymentStatus:next.paymentStatus}}))
  })
  return paymentRef.id
}
export async function voidPurchasePaymentRecord(payment:PurchasePayment,value:PurchaseReceipt,reason:string){
  assertPaymentCanVoid(payment)
  const clean=reason.trim();if(clean.length<3||clean.length>100)throw new Error('Void reason must be 3 to 100 characters')
  const userId=uid()
  await runTransaction(db,async transaction=>{
    const paymentRef=doc(db,'purchasePayments',payment.id);const receiptRef=doc(db,'purchaseReceipts',value.id)
    const [paymentSnap,receiptSnap]=await Promise.all([transaction.get(paymentRef),transaction.get(receiptRef)])
    if(!paymentSnap.exists()||paymentSnap.data().voided)throw new Error('Payment was already voided or not found.')
    if(!receiptSnap.exists())throw new Error('Receipt was not found.')
    const current=receipt(value.id,receiptSnap.data());const actualAmount=Number(paymentSnap.data().amountCents)
    const next=voidPurchasePayment(current,actualAmount)
    transaction.update(paymentRef,{voided:true,voidReason:clean,voidedBy:userId,voidedAt:serverTimestamp()})
    const actionRef=doc(collection(receiptRef,'actions'))
    transaction.update(receiptRef,{paidCents:next.paidCents,paymentStatus:next.paymentStatus,updatedBy:userId,updatedAt:serverTimestamp(),lastActionId:actionRef.id})
    transaction.set(actionRef,actionData('payment_void',current,userId,{paymentId:payment.id,reason:clean,
      beforeSnapshot:{paidCents:current.paidCents},afterSnapshot:{paidCents:next.paidCents,paymentStatus:next.paymentStatus}}))
  })
}
export async function paySelectedReceipts(receipts:PurchaseReceipt[],input:Omit<PurchasePaymentInput,'amountCents'>){
  if(!receipts.length)throw new Error('Select at least one receipt.')
  if(receipts.length>4)throw new Error('Pay Selected supports up to 4 receipts per atomic payment group.')
  const group=doc(collection(db,'purchasePaymentGroups')).id
  const paymentRefs=receipts.map(()=>doc(collection(db,'purchasePayments')))
  const actionRefs=receipts.map(item=>doc(collection(doc(db,'purchaseReceipts',item.id),'actions')))
  const userId=uid()
  await runTransaction(db,async transaction=>{
    const receiptRefs=receipts.map(item=>doc(db,'purchaseReceipts',item.id))
    const snaps=await Promise.all(receiptRefs.map(ref=>transaction.get(ref)))
    const current=snaps.map((snap,index)=>{
      if(!snap.exists())throw new Error('A selected receipt was not found.')
      return receipt(receipts[index].id,snap.data())
    })
    const next=current.map(item=>applyPurchasePayment(item,item.totalAmountCents-item.paidCents))
    current.forEach((item,index)=>{
      const amountCents=item.totalAmountCents-item.paidCents,paymentRef=paymentRefs[index],actionRef=actionRefs[index]
      transaction.set(paymentRef,{paymentGroupId:group,receiptId:item.id,receiptCode:item.receiptCode,supplierId:item.supplierId,
        supplierNameSnapshot:item.supplierNameSnapshot,amountCents,method:input.method,paymentDate:input.paymentDate,
        reference:input.reference.trim(),note:input.note.trim(),createdBy:userId,createdAt:serverTimestamp(),voided:false,
        voidReason:null,voidedBy:null,voidedAt:null})
      transaction.update(receiptRefs[index],{paidCents:next[index].paidCents,paymentStatus:next[index].paymentStatus,
        updatedBy:userId,updatedAt:serverTimestamp(),lastActionId:actionRef.id})
      transaction.set(actionRef,actionData('payment_create',item,userId,{paymentId:paymentRef.id,
        afterSnapshot:{paidCents:next[index].paidCents,paymentStatus:next[index].paymentStatus}}))
    })
  })
  return group
}
