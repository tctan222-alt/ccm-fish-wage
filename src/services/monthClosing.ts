import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { auth,db,firebaseConfigured } from '../firebase'
import {
  applyPayment,
  assertMonthCanClose,
  buildClosingSnapshot,
  canReopenMonth,
  nextCloseVersion,
  validateReopenReason,
  voidPaymentAmount,
  type RateBreakdown,
} from '../lib/monthClosing'
import { loadWageEntriesByMonthFromServer } from './wages'

export type WageMonthStatus='open'|'closed'
export type PaymentMethod='cash'|'bank'|'other'

export interface WageMonthRecord {
  monthKey:string
  status:WageMonthStatus
  closeVersion:number
  workerCount:number
  basketCount:number
  totalWeightKg:number
  totalWageCents:number
  paidCents:number
  closedBy:string|null
  closedAt?:unknown
  reopenedBy:string|null
  reopenedAt?:unknown|null
  updatedAt?:unknown
  lastActionId:string
  closingToken:string|null
  closingBy:string|null
  closingAt?:unknown|null
  statementIds:string[]
}

export interface WageStatementRecord {
  id:string
  monthKey:string
  closeVersion:number
  workerId:string
  workerName:string
  basketCount:number
  totalWeightKg:number
  wageCents:number
  paidCents:number
  rateBreakdown:RateBreakdown
  snapshotAt?:unknown
  createdBy:string
  lastActionId:string
}

export interface WagePaymentRecord {
  id:string
  monthKey:string
  closeVersion:number
  workerId:string
  workerName:string
  statementId:string
  amountCents:number
  method:PaymentMethod
  paymentDate:string
  reference:string
  note:string
  createdBy:string
  createdAt?:unknown
  voided:boolean
  voidReason:string|null
  voidedBy:string|null
  voidedAt?:unknown|null
}

export interface WageMonthClosingData {
  month:WageMonthRecord|null
  statements:WageStatementRecord[]
  payments:WagePaymentRecord[]
}

function requireUser(){
  if(!firebaseConfigured)throw new Error('Firebase is not configured')
  const user=auth.currentUser
  if(!user)throw new Error('Authentication is required')
  return user
}

function monthReference(monthKey:string){
  return doc(db,'fishHeadWageMonths',monthKey)
}

export async function loadWageMonthClosingData(monthKey:string):Promise<WageMonthClosingData> {
  if(!firebaseConfigured)throw new Error('Firebase is not configured')
  const monthRef=monthReference(monthKey)
  const monthSnapshot=await getDoc(monthRef)
  if(!monthSnapshot.exists())return {month:null,statements:[],payments:[]}

  const month={monthKey,...monthSnapshot.data()} as WageMonthRecord
  if(month.status!=='closed')return {month,statements:[],payments:[]}

  const [statementSnapshot,paymentSnapshot]=await Promise.all([
    getDocs(query(collection(monthRef,'statements'),where('closeVersion','==',month.closeVersion))),
    getDocs(query(collection(monthRef,'payments'),where('closeVersion','==',month.closeVersion))),
  ])
  const statements=statementSnapshot.docs
    .map(item=>({id:item.id,...item.data()} as WageStatementRecord))
    .sort((a,b)=>a.workerName.localeCompare(b.workerName))
  if(statements.length!==month.workerCount||statements.some(statement=>!month.statementIds.includes(statement.id))){
    throw new Error('Closed wage statement snapshot is incomplete')
  }
  const payments=paymentSnapshot.docs
    .map(item=>({id:item.id,...item.data()} as WagePaymentRecord))
    .sort((a,b)=>b.paymentDate.localeCompare(a.paymentDate))
  return {month,statements,payments}
}

export async function closeWageMonth(monthKey:string):Promise<void> {
  const user=requireUser()
  const monthRef=monthReference(monthKey)
  const lockToken=doc(collection(db,'fishHeadWageCloseAttempts')).id

  await runTransaction(db,async transaction=>{
    const currentSnapshot=await transaction.get(monthRef)
    const current=currentSnapshot.exists()?currentSnapshot.data() as WageMonthRecord:null
    assertMonthCanClose(current)
    const timestamp=serverTimestamp()
    if(current){
      transaction.update(monthRef,{closingToken:lockToken,closingBy:user.uid,closingAt:timestamp,updatedAt:timestamp})
    }else{
      transaction.set(monthRef,{
        monthKey,
        status:'open',
        closeVersion:0,
        workerCount:0,
        basketCount:0,
        totalWeightKg:0,
        totalWageCents:0,
        paidCents:0,
        closedBy:null,
        closedAt:null,
        reopenedBy:null,
        reopenedAt:null,
        updatedAt:timestamp,
        lastActionId:'closing_lock',
        closingToken:lockToken,
        closingBy:user.uid,
        closingAt:timestamp,
        statementIds:[],
      })
    }
  })

  try{
    const entries=await loadWageEntriesByMonthFromServer(monthKey)
    await runTransaction(db,async transaction=>{
      const currentSnapshot=await transaction.get(monthRef)
      if(!currentSnapshot.exists())throw new Error('Month closing lock was lost')
      const current=currentSnapshot.data() as WageMonthRecord
      if(current.status!=='open'||current.closingToken!==lockToken||current.closingBy!==user.uid){
        throw new Error('Month closing lock was lost')
      }
      const closeVersion=nextCloseVersion(current)
      const closing=buildClosingSnapshot(monthKey,closeVersion,entries)
      const timestamp=serverTimestamp()
      const actionId=`close_${closeVersion}`
      const actionRef=doc(monthRef,'actions',actionId)
      const statementIds=closing.statements.map(statement=>statement.id)

      transaction.set(monthRef,{
        ...closing.month,
        closedBy:user.uid,
        closedAt:timestamp,
        reopenedBy:null,
        reopenedAt:null,
        updatedAt:timestamp,
        lastActionId:actionId,
        closingToken:null,
        closingBy:null,
        closingAt:null,
        statementIds,
      })

      for(const statement of closing.statements){
        transaction.set(doc(monthRef,'statements',statement.id),{
          ...statement,
          snapshotAt:timestamp,
          createdBy:user.uid,
          lastActionId:actionId,
        })
      }

      transaction.set(actionRef,{
        type:'close',
        monthKey,
        closeVersion,
        performedBy:user.uid,
        performedAt:timestamp,
        afterSnapshot:{...closing.month,statementIds},
      })
    })
  }catch(problem){
    await runTransaction(db,async transaction=>{
      const currentSnapshot=await transaction.get(monthRef)
      if(!currentSnapshot.exists())return
      const current=currentSnapshot.data() as WageMonthRecord
      if(current.status==='open'&&current.closingToken===lockToken){
        transaction.update(monthRef,{closingToken:null,closingBy:null,closingAt:null,updatedAt:serverTimestamp()})
      }
    })
    throw problem
  }
}

export interface CreatePaymentInput {
  monthKey:string
  statementId:string
  amountCents:number
  method:PaymentMethod
  paymentDate:string
  reference?:string
  note?:string
}

export async function createWagePayment(input:CreatePaymentInput):Promise<void> {
  const user=requireUser()
  if(!['cash','bank','other'].includes(input.method))throw new Error('A valid payment method is required')
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate))throw new Error('A valid payment date is required')

  const monthRef=monthReference(input.monthKey)
  const statementRef=doc(monthRef,'statements',input.statementId)
  const paymentRef=doc(collection(monthRef,'payments'))
  const actionId=`payment_create_${paymentRef.id}`
  const actionRef=doc(monthRef,'actions',actionId)

  await runTransaction(db,async transaction=>{
    const [monthSnapshot,statementSnapshot]=await Promise.all([
      transaction.get(monthRef),
      transaction.get(statementRef),
    ])
    if(!monthSnapshot.exists()||!statementSnapshot.exists())throw new Error('Closed wage statement was not found')
    const month=monthSnapshot.data() as WageMonthRecord
    const statement={id:statementSnapshot.id,...statementSnapshot.data()} as WageStatementRecord
    if(month.status!=='closed'||statement.closeVersion!==month.closeVersion)throw new Error('Payments require the current closed month')

    const statementPaidCents=applyPayment(statement.paidCents,input.amountCents,statement.wageCents)
    const monthPaidCents=applyPayment(month.paidCents,input.amountCents,month.totalWageCents)
    const timestamp=serverTimestamp()
    const payment:Omit<WagePaymentRecord,'id'|'createdAt'|'voidedAt'>={
      monthKey:input.monthKey,
      closeVersion:month.closeVersion,
      workerId:statement.workerId,
      workerName:statement.workerName,
      statementId:statement.id,
      amountCents:input.amountCents,
      method:input.method,
      paymentDate:input.paymentDate,
      reference:(input.reference??'').trim(),
      note:(input.note??'').trim(),
      createdBy:user.uid,
      voided:false,
      voidReason:null,
      voidedBy:null,
    }

    transaction.set(paymentRef,{...payment,createdAt:timestamp,voidedAt:null})
    transaction.update(statementRef,{paidCents:statementPaidCents,lastActionId:actionId})
    transaction.update(monthRef,{paidCents:monthPaidCents,updatedAt:timestamp,lastActionId:actionId})
    transaction.set(actionRef,{
      type:'payment_create',
      monthKey:input.monthKey,
      closeVersion:month.closeVersion,
      workerId:statement.workerId,
      paymentId:paymentRef.id,
      performedBy:user.uid,
      performedAt:timestamp,
      afterSnapshot:{amountCents:input.amountCents,statementPaidCents,monthPaidCents},
    })
  })
}

export async function voidWagePayment(monthKey:string,paymentId:string,reason:string):Promise<void> {
  const user=requireUser()
  const cleanReason=reason.trim()
  if(cleanReason.length<3||cleanReason.length>100)throw new Error('Void reason must be 3 to 100 characters')

  const monthRef=monthReference(monthKey)
  const paymentRef=doc(monthRef,'payments',paymentId)
  const actionId=`payment_void_${paymentId}`
  const actionRef=doc(monthRef,'actions',actionId)

  await runTransaction(db,async transaction=>{
    const [monthSnapshot,paymentSnapshot]=await Promise.all([
      transaction.get(monthRef),
      transaction.get(paymentRef),
    ])
    if(!monthSnapshot.exists()||!paymentSnapshot.exists())throw new Error('Payment was not found')
    const month=monthSnapshot.data() as WageMonthRecord
    const payment={id:paymentSnapshot.id,...paymentSnapshot.data()} as WagePaymentRecord
    if(month.status!=='closed'||payment.closeVersion!==month.closeVersion)throw new Error('Only current closed-month payments can be voided')
    if(payment.voided)throw new Error('This payment is already voided')

    const statementRef=doc(monthRef,'statements',payment.statementId)
    const statementSnapshot=await transaction.get(statementRef)
    if(!statementSnapshot.exists())throw new Error('Wage statement was not found')
    const statement={id:statementSnapshot.id,...statementSnapshot.data()} as WageStatementRecord
    const statementPaidCents=voidPaymentAmount(statement.paidCents,payment.amountCents)
    const monthPaidCents=voidPaymentAmount(month.paidCents,payment.amountCents)
    const timestamp=serverTimestamp()

    transaction.update(paymentRef,{
      voided:true,
      voidReason:cleanReason,
      voidedBy:user.uid,
      voidedAt:timestamp,
    })
    transaction.update(statementRef,{paidCents:statementPaidCents,lastActionId:actionId})
    transaction.update(monthRef,{paidCents:monthPaidCents,updatedAt:timestamp,lastActionId:actionId})
    transaction.set(actionRef,{
      type:'payment_void',
      monthKey,
      closeVersion:month.closeVersion,
      workerId:statement.workerId,
      paymentId,
      reason:cleanReason,
      performedBy:user.uid,
      performedAt:timestamp,
      beforeSnapshot:{amountCents:payment.amountCents,statementPaidCents:statement.paidCents,monthPaidCents:month.paidCents},
      afterSnapshot:{statementPaidCents,monthPaidCents},
    })
  })
}

export async function reopenWageMonth(monthKey:string,reason:string):Promise<void> {
  const user=requireUser()
  const cleanReason=validateReopenReason(reason)
  const monthRef=monthReference(monthKey)

  await runTransaction(db,async transaction=>{
    const monthSnapshot=await transaction.get(monthRef)
    if(!monthSnapshot.exists())throw new Error('Closed wage month was not found')
    const month=monthSnapshot.data() as WageMonthRecord
    if(month.status!=='closed')throw new Error('This month is already open')
    if(!canReopenMonth(month.paidCents))throw new Error('Void all payments before reopening this month')
    const timestamp=serverTimestamp()
    const actionId=`reopen_${month.closeVersion}`
    const actionRef=doc(monthRef,'actions',actionId)

    transaction.update(monthRef,{
      status:'open',
      reopenedBy:user.uid,
      reopenedAt:timestamp,
      updatedAt:timestamp,
      lastActionId:actionId,
      closingToken:null,
      closingBy:null,
      closingAt:null,
    })
    transaction.set(actionRef,{
      type:'reopen',
      monthKey,
      closeVersion:month.closeVersion,
      reason:cleanReason,
      performedBy:user.uid,
      performedAt:timestamp,
      beforeSnapshot:{status:'closed',paidCents:month.paidCents},
      afterSnapshot:{status:'open',paidCents:month.paidCents},
    })
  })
}
