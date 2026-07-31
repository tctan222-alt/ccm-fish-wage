import { collection, doc, getDocs, query, runTransaction, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { auth, db, firebaseConfigured } from '../firebase'
import { createIceWorkRecord, iceWorkMonthClosingId, type IceWorkRecord } from '../lib/iceWork'

function requireUser(){
  if(!firebaseConfigured)throw new Error('Firebase 尚未设定。')
  if(!auth.currentUser)throw new Error('请先登录。')
  return auth.currentUser
}

function recordFrom(id:string,data:Record<string,unknown>):IceWorkRecord{
  return {...data,id} as IceWorkRecord
}

export async function loadIceWorkRecords(vesselId:string,monthKey:string){
  const snapshot=await getDocs(query(collection(db,'iceWorkRecords'),where('vesselId','==',vesselId),where('monthKey','==',monthKey)))
  return snapshot.docs.map(item=>recordFrom(item.id,item.data()))
    .sort((a,b)=>b.workDate.localeCompare(a.workDate)||b.id.localeCompare(a.id))
}

export async function saveIceWorkRecord(record:IceWorkRecord){
  const user=requireUser()
  const { id, ...stored }=record
  const recordRef=doc(db,'iceWorkRecords',id)
  const values={...stored,createdBy:record.createdBy||user.uid,createdAt:serverTimestamp(),updatedBy:user.uid,updatedAt:serverTimestamp()}
  if(!record.monthEndSettlement){
    await setDoc(recordRef,values)
    return {...record,createdBy:record.createdBy||user.uid,updatedBy:user.uid}
  }
  const closingRef=doc(db,'iceWorkMonthClosings',iceWorkMonthClosingId(record.vesselId,record.monthKey))
  await runTransaction(db,async transaction=>{
    const [existingRecord,closing]=await Promise.all([transaction.get(recordRef),transaction.get(closingRef)])
    if(existingRecord.exists())throw new Error('本月尾结算记录已存在，请重新载入后查看。')
    if(closing.exists()&&closing.data().status==='active')throw new Error('本月已有月尾结算记录。')
    const revision=closing.exists()?Number(closing.data().revision)+1:1
    transaction.set(recordRef,values)
    transaction.set(closingRef,{
      vesselId:record.vesselId,monthKey:record.monthKey,activeRecordId:record.id,status:'active',revision,
      createdBy:closing.exists()?String(closing.data().createdBy):user.uid,createdAt:closing.exists()?closing.data().createdAt:serverTimestamp(),
      updatedBy:user.uid,updatedAt:serverTimestamp(),
    })
  })
  return {...record,createdBy:record.createdBy||user.uid,updatedBy:user.uid}
}

export async function createAndSaveIceWorkRecord(input:Parameters<typeof createIceWorkRecord>[0]){
  const user=requireUser(),record=createIceWorkRecord({...input,createdBy:user.uid})
  return saveIceWorkRecord(record)
}

export async function voidIceWorkRecord(record:IceWorkRecord,reason:string){
  const user=requireUser(),clean=reason.trim()
  if(clean.length<2)throw new Error('作废原因至少需要两个字。')
  const recordRef=doc(db,'iceWorkRecords',record.id)
  const voidValues={status:'voided',voided:true,voidReason:clean,voidedBy:user.uid,voidedAt:serverTimestamp(),updatedBy:user.uid,updatedAt:serverTimestamp()}
  if(record.monthEndSettlement){
    const closingRef=doc(db,'iceWorkMonthClosings',iceWorkMonthClosingId(record.vesselId,record.monthKey))
    await runTransaction(db,async transaction=>{
      const closing=await transaction.get(closingRef)
      if(!closing.exists()||closing.data().activeRecordId!==record.id||closing.data().status!=='active')throw new Error('找不到本月尾结算锁定记录。')
      transaction.set(recordRef,voidValues,{merge:true})
      transaction.set(closingRef,{status:'voided',revision:Number(closing.data().revision)+1,updatedBy:user.uid,updatedAt:serverTimestamp()},{merge:true})
    })
  }else await setDoc(recordRef,voidValues,{merge:true})
  return {...record,status:'voided' as const,voided:true,voidReason:clean,voidedBy:user.uid}
}
