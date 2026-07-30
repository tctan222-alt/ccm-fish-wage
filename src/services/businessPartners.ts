import { collection,doc,getDocs,serverTimestamp,setDoc,updateDoc } from 'firebase/firestore'
import { auth,db,firebaseConfigured } from '../firebase'
import {
  activeCustomers,
  activeSuppliers,
  makePartnerCode,
  normalizeBusinessPartner,
  validateBusinessPartner,
  type BusinessPartner,
  type BusinessPartnerInput,
} from '../lib/masterData'

function requireUser(){
  if(!firebaseConfigured)throw new Error('Firebase is not configured')
  const user=auth.currentUser
  if(!user)throw new Error('Authentication is required')
  return user
}

function fromFirestore(id:string,data:Record<string,unknown>):BusinessPartner {
  return {
    id,
    partnerCode:String(data.partnerCode??''),
    displayName:String(data.displayName??''),
    legalName:String(data.legalName??''),
    supplier:data.supplier===true,
    customer:data.customer===true,
    active:data.active===true,
    phone:String(data.phone??''),
    registrationNo:String(data.registrationNo??''),
    paymentTermsDays:Number(data.paymentTermsDays??0),
    notes:String(data.notes??''),
    createdBy:typeof data.createdBy==='string'?data.createdBy:undefined,
    createdAt:data.createdAt,
    updatedBy:typeof data.updatedBy==='string'?data.updatedBy:undefined,
    updatedAt:data.updatedAt,
    inactiveBy:typeof data.inactiveBy==='string'?data.inactiveBy:null,
    inactiveAt:data.inactiveAt??null,
  }
}

export async function loadBusinessPartners():Promise<BusinessPartner[]> {
  if(!firebaseConfigured)throw new Error('Firebase is not configured')
  const snapshot=await getDocs(collection(db,'businessPartners'))
  return snapshot.docs
    .map(item=>fromFirestore(item.id,item.data()))
    .sort((a,b)=>a.displayName.localeCompare(b.displayName))
}

export async function loadActiveSuppliers(){return activeSuppliers(await loadBusinessPartners())}
export async function loadActiveCustomers(){return activeCustomers(await loadBusinessPartners())}

export async function createBusinessPartner(input:BusinessPartnerInput):Promise<BusinessPartner> {
  const user=requireUser()
  const clean=normalizeBusinessPartner(input)
  const errors=validateBusinessPartner(clean)
  if(errors.length)throw new Error(errors[0])
  const reference=doc(collection(db,'businessPartners'))
  const timestamp=serverTimestamp()
  const partner:BusinessPartner={
    id:reference.id,
    partnerCode:makePartnerCode(reference.id),
    ...clean,
    active:true,
    createdBy:user.uid,
    updatedBy:user.uid,
    inactiveBy:null,
    inactiveAt:null,
  }
  await setDoc(reference,{
    partnerCode:partner.partnerCode,
    ...clean,
    active:true,
    createdBy:user.uid,
    createdAt:timestamp,
    updatedBy:user.uid,
    updatedAt:timestamp,
    inactiveBy:null,
    inactiveAt:null,
  })
  return partner
}

export async function updateBusinessPartner(partner:BusinessPartner,input:BusinessPartnerInput):Promise<BusinessPartner> {
  const user=requireUser()
  const clean=normalizeBusinessPartner(input)
  const errors=validateBusinessPartner(clean)
  if(errors.length)throw new Error(errors[0])
  await updateDoc(doc(db,'businessPartners',partner.id),{
    ...clean,
    updatedBy:user.uid,
    updatedAt:serverTimestamp(),
  })
  return {...partner,...clean,updatedBy:user.uid}
}

export async function deactivateBusinessPartner(partner:BusinessPartner):Promise<void> {
  const user=requireUser()
  await updateDoc(doc(db,'businessPartners',partner.id),{
    active:false,
    updatedBy:user.uid,
    updatedAt:serverTimestamp(),
    inactiveBy:user.uid,
    inactiveAt:serverTimestamp(),
  })
}

export async function reactivateBusinessPartner(partner:BusinessPartner):Promise<void> {
  const user=requireUser()
  await updateDoc(doc(db,'businessPartners',partner.id),{
    active:true,
    updatedBy:user.uid,
    updatedAt:serverTimestamp(),
    inactiveBy:null,
    inactiveAt:null,
  })
}
