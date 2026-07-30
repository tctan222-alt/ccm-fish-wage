import {
  collection,doc,getDoc,getDocs,query,runTransaction,serverTimestamp,setDoc,where,
} from 'firebase/firestore'
import { auth,db,firebaseConfigured } from '../firebase'
import {
  DEFAULT_VESSEL_WAGE_TEMPLATES,addCrewPayment,assertCrewPaymentCanBeVoided,calculateTripSettlement,createCrewSettlement,
  normalizeTripInput,settleVesselTrip,validateCrewSettlement,validateTripInput,voidCrewPayment,voidVesselTrip,
  type CreateCrewSettlementInput,type VesselCrewPayment,type VesselCrewSettlement,type VesselPaymentMethod,
  type VesselTrip,type VesselWageTemplate,
} from '../lib/vesselTrips'

export interface VesselTripEntry {
  id:string;tripId:string;type:'income'|'expense';category:string;amountCents:number;date:string;note:string
  voided:boolean;voidReason:string|null
}

export interface VesselTripBundle {
  trip:VesselTrip
  crew:VesselCrewSettlement[]
  entries:VesselTripEntry[]
  payments:VesselCrewPayment[]
}

function requireUser(){
  if(!firebaseConfigured)throw new Error('Firebase is not configured')
  const user=auth.currentUser
  if(!user)throw new Error('Authentication is required')
  return user
}
function dataTrip(id:string,data:Record<string,unknown>):VesselTrip{
  return {id,tripCode:String(data.tripCode??''),vesselId:String(data.vesselId??''),vesselCodeSnapshot:String(data.vesselCodeSnapshot??''),
    vesselNameSnapshot:String(data.vesselNameSnapshot??''),departureDate:String(data.departureDate??''),returnDate:String(data.returnDate??''),
    status:data.status as VesselTrip['status'],incomeCents:Number(data.incomeCents??0),expenseCents:Number(data.expenseCents??0),
    crewWageCents:Number(data.crewWageCents??0),crewAdvanceCents:Number(data.crewAdvanceCents??0),
    crewPaidCents:Number(data.crewPaidCents??0),profitCents:Number(data.profitCents??0),notes:String(data.notes??''),
    revision:Number(data.revision??1),voidReason:data.voidReason?String(data.voidReason):null}
}
function dataCrew(id:string,data:Record<string,unknown>):VesselCrewSettlement{
  return {id,workerId:String(data.workerId),workerNameSnapshot:String(data.workerNameSnapshot),role:data.role as VesselCrewSettlement['role'],
    halfDayUnits:Number(data.halfDayUnits),nightCount:Number(data.nightCount),templateId:String(data.templateId),
    dayRateCents:Number(data.dayRateCents),nightRateCents:Number(data.nightRateCents),grossWageCents:Number(data.grossWageCents),
    advanceCents:Number(data.advanceCents),paidCents:Number(data.paidCents),balanceCents:Number(data.balanceCents)}
}

export async function loadVesselWageTemplates():Promise<VesselWageTemplate[]>{
  const snapshot=await getDocs(collection(db,'vesselWageTemplates'))
  const stored=snapshot.docs.map(item=>({id:item.id,...item.data()} as VesselWageTemplate))
  const codes=new Set(stored.map(item=>item.vesselCode))
  return [...stored,...DEFAULT_VESSEL_WAGE_TEMPLATES.filter(item=>!codes.has(item.vesselCode))]
    .sort((a,b)=>a.vesselCode.localeCompare(b.vesselCode))
}

export async function saveVesselWageTemplate(value:VesselWageTemplate){
  const user=requireUser()
  if(!value.vesselCode.trim()||!Number.isInteger(value.dayRateCents)||value.dayRateCents<0||
    !Number.isInteger(value.nightRateCents)||value.nightRateCents<0)throw new Error('Valid vessel and integer-cent rates are required.')
  const ref=value.id.startsWith('default-')?doc(collection(db,'vesselWageTemplates')):doc(db,'vesselWageTemplates',value.id)
  const result={...value,id:ref.id,vesselCode:value.vesselCode.trim(),name:value.name.trim()}
  const existing=await getDoc(ref),timestamp=serverTimestamp()
  await setDoc(ref,{...result,createdBy:existing.exists()?existing.data().createdBy:user.uid,
    createdAt:existing.exists()?existing.data().createdAt:timestamp,updatedBy:user.uid,updatedAt:timestamp})
  return result
}

export async function loadVesselTrips(){
  const snapshot=await getDocs(collection(db,'vesselTrips'))
  return snapshot.docs.map(item=>dataTrip(item.id,item.data())).sort((a,b)=>b.departureDate.localeCompare(a.departureDate))
}

export async function loadVesselTripBundle(tripId:string):Promise<VesselTripBundle>{
  const tripRef=doc(db,'vesselTrips',tripId)
  const [tripSnapshot,crewSnapshot,entrySnapshot,paymentSnapshot]=await Promise.all([
    getDoc(tripRef),getDocs(collection(tripRef,'crew')),
    getDocs(query(collection(db,'vesselTripEntries'),where('tripId','==',tripId))),
    getDocs(query(collection(db,'vesselCrewPayments'),where('tripId','==',tripId))),
  ])
  if(!tripSnapshot.exists())throw new Error('Vessel Trip was not found.')
  return {
    trip:dataTrip(tripSnapshot.id,tripSnapshot.data()),
    crew:crewSnapshot.docs.map(item=>dataCrew(item.id,item.data())).sort((a,b)=>a.workerNameSnapshot.localeCompare(b.workerNameSnapshot)),
    entries:entrySnapshot.docs.map(item=>({id:item.id,...item.data()} as VesselTripEntry)).sort((a,b)=>b.date.localeCompare(a.date)),
    payments:paymentSnapshot.docs.map(item=>({id:item.id,...item.data()} as VesselCrewPayment)).sort((a,b)=>b.paymentDate.localeCompare(a.paymentDate)),
  }
}

export async function createVesselTrip(input:VesselTrip){
  const user=requireUser(),ref=doc(collection(db,'vesselTrips'))
  const clean=normalizeTripInput({...input,id:ref.id,status:'draft',incomeCents:0,expenseCents:0,crewWageCents:0,
    crewAdvanceCents:0,crewPaidCents:0,profitCents:0,revision:1,voidReason:null})
  const errors=validateTripInput(clean)
  if(errors.length)throw new Error(errors[0])
  const {profitCents}=calculateTripSettlement(clean),timestamp=serverTimestamp()
  const result={...clean,profitCents,status:'draft' as const,revision:1,voidReason:null}
  await setDoc(ref,{...result,createdBy:user.uid,createdAt:timestamp,updatedBy:user.uid,updatedAt:timestamp,lastActionId:'create'})
  return result
}

export async function addVesselCrewSettlement(tripId:string,input:CreateCrewSettlementInput){
  const user=requireUser(),tripRef=doc(db,'vesselTrips',tripId),crewRef=doc(collection(tripRef,'crew'))
  if((input.advanceCents??0)!==0||(input.paidCents??0)!==0)throw new Error('Record advances and payments through the crew payment workflow.')
  const settlement=createCrewSettlement({...input,id:crewRef.id})
  const errors=validateCrewSettlement(settlement)
  if(errors.length)throw new Error(errors[0])
  await runTransaction(db,async transaction=>{
    const snap=await transaction.get(tripRef)
    if(!snap.exists())throw new Error('Vessel Trip was not found.')
    const trip=dataTrip(snap.id,snap.data())
    if(trip.status!=='draft')throw new Error('Crew can only be changed on a draft trip.')
    const crewWageCents=trip.crewWageCents+settlement.grossWageCents
    const crewAdvanceCents=trip.crewAdvanceCents+settlement.advanceCents
    const {profitCents}=calculateTripSettlement({...trip,crewWageCents,crewAdvanceCents})
    const actionId=`crew_add_${crewRef.id}`,timestamp=serverTimestamp()
    transaction.set(crewRef,{...settlement,tripId,createdBy:user.uid,createdAt:timestamp,lastActionId:actionId})
    transaction.update(tripRef,{crewWageCents,crewAdvanceCents,profitCents,revision:trip.revision+1,
      updatedBy:user.uid,updatedAt:timestamp,lastActionId:actionId})
    transaction.set(doc(tripRef,'actions',actionId),{type:'crew_add',crewSettlementId:crewRef.id,performedBy:user.uid,performedAt:timestamp})
  })
  return settlement
}

export async function addVesselTripEntry(tripId:string,input:Omit<VesselTripEntry,'id'|'tripId'|'voided'|'voidReason'>){
  const user=requireUser()
  if(!['income','expense'].includes(input.type)||!Number.isInteger(input.amountCents)||input.amountCents<=0)throw new Error('Entry amount must be positive integer cents.')
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!input.category.trim())throw new Error('Entry date and category are required.')
  const tripRef=doc(db,'vesselTrips',tripId),entryRef=doc(collection(db,'vesselTripEntries'))
  await runTransaction(db,async transaction=>{
    const snap=await transaction.get(tripRef)
    if(!snap.exists())throw new Error('Vessel Trip was not found.')
    const trip=dataTrip(snap.id,snap.data())
    if(trip.status!=='draft')throw new Error('Income and expenses can only be changed on a draft trip.')
    const incomeCents=trip.incomeCents+(input.type==='income'?input.amountCents:0)
    const expenseCents=trip.expenseCents+(input.type==='expense'?input.amountCents:0)
    const {profitCents}=calculateTripSettlement({...trip,incomeCents,expenseCents})
    const actionId=`entry_add_${entryRef.id}`,timestamp=serverTimestamp()
    transaction.set(entryRef,{...input,tripId,category:input.category.trim(),note:input.note.trim(),voided:false,voidReason:null,
      createdBy:user.uid,createdAt:timestamp,lastActionId:actionId})
    transaction.update(tripRef,{incomeCents,expenseCents,profitCents,revision:trip.revision+1,
      updatedBy:user.uid,updatedAt:timestamp,lastActionId:actionId})
    transaction.set(doc(tripRef,'actions',actionId),{type:'entry_add',entryId:entryRef.id,performedBy:user.uid,performedAt:timestamp})
  })
}

export async function voidVesselTripEntry(entry:VesselTripEntry,reason:string){
  const user=requireUser(),cleanReason=reason.trim()
  if(entry.voided)throw new Error('This trip entry is already voided.')
  if(cleanReason.length<3||cleanReason.length>100)throw new Error('Void reason must be 3 to 100 characters.')
  const tripRef=doc(db,'vesselTrips',entry.tripId),entryRef=doc(db,'vesselTripEntries',entry.id)
  await runTransaction(db,async transaction=>{
    const [tripSnap,entrySnap]=await Promise.all([transaction.get(tripRef),transaction.get(entryRef)])
    if(!tripSnap.exists()||!entrySnap.exists())throw new Error('Vessel Trip entry was not found.')
    const trip=dataTrip(tripSnap.id,tripSnap.data()),stored={id:entrySnap.id,...entrySnap.data()} as VesselTripEntry
    if(trip.status!=='draft')throw new Error('Income and expenses can only be voided on a draft trip.')
    if(stored.voided)throw new Error('This trip entry is already voided.')
    const incomeCents=trip.incomeCents-(stored.type==='income'?stored.amountCents:0)
    const expenseCents=trip.expenseCents-(stored.type==='expense'?stored.amountCents:0)
    const {profitCents}=calculateTripSettlement({...trip,incomeCents,expenseCents})
    const actionId=`entry_void_${entry.id}`,timestamp=serverTimestamp()
    transaction.update(entryRef,{voided:true,voidReason:cleanReason,lastActionId:actionId})
    transaction.update(tripRef,{incomeCents,expenseCents,profitCents,revision:trip.revision+1,
      updatedBy:user.uid,updatedAt:timestamp,lastActionId:actionId})
    transaction.set(doc(tripRef,'actions',actionId),{type:'entry_void',entryId:entry.id,reason:cleanReason,
      performedBy:user.uid,performedAt:timestamp,beforeSnapshot:{type:stored.type,amountCents:stored.amountCents,voided:false},
      afterSnapshot:{voided:true,incomeCents,expenseCents}})
  })
}

export async function confirmVesselTrip(tripId:string){
  const user=requireUser(),tripRef=doc(db,'vesselTrips',tripId)
  await runTransaction(db,async transaction=>{
    const snap=await transaction.get(tripRef)
    if(!snap.exists())throw new Error('Vessel Trip was not found.')
    const trip=dataTrip(snap.id,snap.data())
    if(trip.status!=='draft')throw new Error('Only a draft trip can be confirmed.')
    if(validateTripInput(trip).length)throw new Error(validateTripInput(trip)[0])
    const timestamp=serverTimestamp(),actionId='confirm'
    transaction.update(tripRef,{status:'confirmed',revision:trip.revision+1,confirmedBy:user.uid,confirmedAt:timestamp,
      updatedBy:user.uid,updatedAt:timestamp,lastActionId:actionId})
    transaction.set(doc(tripRef,'actions',actionId),{type:'confirm',performedBy:user.uid,performedAt:timestamp})
  })
}

export async function settleVesselTripRecord(tripId:string){
  const user=requireUser(),tripRef=doc(db,'vesselTrips',tripId)
  await runTransaction(db,async transaction=>{
    const snap=await transaction.get(tripRef)
    if(!snap.exists())throw new Error('Vessel Trip was not found.')
    const next=settleVesselTrip(dataTrip(snap.id,snap.data())),timestamp=serverTimestamp(),actionId='settle'
    transaction.update(tripRef,{status:next.status,revision:next.revision,settledBy:user.uid,settledAt:timestamp,
      updatedBy:user.uid,updatedAt:timestamp,lastActionId:actionId})
    transaction.set(doc(tripRef,'actions',actionId),{type:'settle',performedBy:user.uid,performedAt:timestamp})
  })
}

export async function createVesselCrewPayment(input:{
  tripId:string;crewSettlementId:string;paymentType:'advance'|'settlement';amountCents:number;method:VesselPaymentMethod;paymentDate:string;reference:string;note:string
}){
  const user=requireUser(),tripRef=doc(db,'vesselTrips',input.tripId),crewRef=doc(tripRef,'crew',input.crewSettlementId)
  const paymentRef=doc(collection(db,'vesselCrewPayments'))
  await runTransaction(db,async transaction=>{
    const [tripSnap,crewSnap]=await Promise.all([transaction.get(tripRef),transaction.get(crewRef)])
    if(!tripSnap.exists()||!crewSnap.exists())throw new Error('Trip crew settlement was not found.')
    const trip=dataTrip(tripSnap.id,tripSnap.data()),crew=dataCrew(crewSnap.id,crewSnap.data())
    if(input.paymentType==='advance'&&!['draft','confirmed'].includes(trip.status))throw new Error('Advances require an active draft or confirmed trip.')
    if(input.paymentType==='settlement'&&trip.status!=='confirmed')throw new Error('Confirm the trip before making a settlement payment.')
    if(!['cash','bank','other'].includes(input.method)||!/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate))throw new Error('Valid payment details are required.')
    const next=addCrewPayment(crew,input.amountCents,input.paymentType),timestamp=serverTimestamp(),actionId=`payment_create_${paymentRef.id}`
    const payment:Omit<VesselCrewPayment,'id'>={tripId:input.tripId,crewSettlementId:crew.id,workerId:crew.workerId,
      workerNameSnapshot:crew.workerNameSnapshot,paymentType:input.paymentType,amountCents:input.amountCents,method:input.method,paymentDate:input.paymentDate,
      reference:input.reference.trim(),note:input.note.trim(),voided:false,voidReason:null}
    transaction.set(paymentRef,{...payment,createdBy:user.uid,createdAt:timestamp,voidedBy:null,voidedAt:null,lastActionId:actionId})
    transaction.update(crewRef,{advanceCents:next.advanceCents,paidCents:next.paidCents,balanceCents:next.balanceCents,lastActionId:actionId})
    transaction.update(tripRef,{crewAdvanceCents:trip.crewAdvanceCents+(input.paymentType==='advance'?input.amountCents:0),
      crewPaidCents:trip.crewPaidCents+(input.paymentType==='settlement'?input.amountCents:0),revision:trip.revision+1,
      updatedBy:user.uid,updatedAt:timestamp,lastActionId:actionId})
    transaction.set(doc(tripRef,'actions',actionId),{type:'payment_create',paymentId:paymentRef.id,
      crewSettlementId:crew.id,performedBy:user.uid,performedAt:timestamp})
  })
}

export async function voidVesselCrewPaymentRecord(payment:VesselCrewPayment,reason:string){
  const user=requireUser(),tripRef=doc(db,'vesselTrips',payment.tripId),crewRef=doc(tripRef,'crew',payment.crewSettlementId)
  const paymentRef=doc(db,'vesselCrewPayments',payment.id)
  await runTransaction(db,async transaction=>{
    const [tripSnap,crewSnap,paymentSnap]=await Promise.all([transaction.get(tripRef),transaction.get(crewRef),transaction.get(paymentRef)])
    if(!tripSnap.exists()||!crewSnap.exists()||!paymentSnap.exists())throw new Error('Crew payment was not found.')
    const trip=dataTrip(tripSnap.id,tripSnap.data()),crew=dataCrew(crewSnap.id,crewSnap.data())
    const stored={id:paymentSnap.id,...paymentSnap.data()} as VesselCrewPayment
    assertCrewPaymentCanBeVoided(trip)
    const result=voidCrewPayment(crew,stored,reason),timestamp=serverTimestamp(),actionId=`payment_void_${payment.id}`
    transaction.update(paymentRef,{voided:true,voidReason:result.payment.voidReason,voidedBy:user.uid,voidedAt:timestamp,lastActionId:actionId})
    transaction.update(crewRef,{advanceCents:result.settlement.advanceCents,paidCents:result.settlement.paidCents,
      balanceCents:result.settlement.balanceCents,lastActionId:actionId})
    transaction.update(tripRef,{crewAdvanceCents:trip.crewAdvanceCents-(stored.paymentType==='advance'?stored.amountCents:0),
      crewPaidCents:trip.crewPaidCents-(stored.paymentType==='settlement'?stored.amountCents:0),revision:trip.revision+1,
      updatedBy:user.uid,updatedAt:timestamp,lastActionId:actionId})
    transaction.set(doc(tripRef,'actions',actionId),{type:'payment_void',paymentId:payment.id,reason:result.payment.voidReason,
      performedBy:user.uid,performedAt:timestamp,beforeSnapshot:{paymentType:stored.paymentType,amountCents:stored.amountCents,
        crewAdvanceCents:crew.advanceCents,crewPaidCents:crew.paidCents,tripAdvanceCents:trip.crewAdvanceCents,tripPaidCents:trip.crewPaidCents},
      afterSnapshot:{crewAdvanceCents:result.settlement.advanceCents,crewPaidCents:result.settlement.paidCents,
        tripAdvanceCents:trip.crewAdvanceCents-(stored.paymentType==='advance'?stored.amountCents:0),
        tripPaidCents:trip.crewPaidCents-(stored.paymentType==='settlement'?stored.amountCents:0)}})
  })
}

export async function voidVesselTripRecord(tripId:string,reason:string){
  const user=requireUser(),tripRef=doc(db,'vesselTrips',tripId)
  await runTransaction(db,async transaction=>{
    const snap=await transaction.get(tripRef)
    if(!snap.exists())throw new Error('Vessel Trip was not found.')
    const current=dataTrip(snap.id,snap.data()),next=voidVesselTrip(current,reason),timestamp=serverTimestamp()
    transaction.update(tripRef,{status:next.status,voidReason:next.voidReason,revision:next.revision,voidedBy:user.uid,
      voidedAt:timestamp,updatedBy:user.uid,updatedAt:timestamp,lastActionId:'void'})
    transaction.set(doc(tripRef,'actions','void'),{type:'void',reason:next.voidReason,performedBy:user.uid,performedAt:timestamp})
  })
}
