import {
  collection,doc,getDocs,runTransaction,serverTimestamp,setDoc,
} from 'firebase/firestore'
import { auth,db,firebaseConfigured } from '../firebase'
import {
  buildDefaultCategoryCreates,buildDefaultVesselCreates,buildDefaultVesselOrderRepairs,normalizeCategoryInput,normalizeVesselInput,
  validateCategoryInput,validateVesselInput,activeVessels,type PurchaseCategory,type PurchaseCategoryInput,
  type Vessel,type VesselInput,
} from '../lib/purchasing'

function user(){
  if(!firebaseConfigured)throw new Error('Firebase is not configured')
  if(!auth.currentUser)throw new Error('Authentication is required')
  return auth.currentUser
}
function category(id:string,data:Record<string,unknown>):PurchaseCategory{
  return {id,categoryCode:String(data.categoryCode??''),displayName:String(data.displayName??''),active:data.active===true,
    order:Number(data.order??0),notes:String(data.notes??''),createdBy:String(data.createdBy??''),createdAt:data.createdAt,
    updatedBy:String(data.updatedBy??''),updatedAt:data.updatedAt,inactiveBy:typeof data.inactiveBy==='string'?data.inactiveBy:null,inactiveAt:data.inactiveAt??null}
}
function vessel(id:string,data:Record<string,unknown>):Vessel{
  return {id,vesselCode:String(data.vesselCode??''),displayName:String(data.displayName??''),defaultSupplierId:String(data.defaultSupplierId??''),
    defaultSupplierNameSnapshot:String(data.defaultSupplierNameSnapshot??''),active:data.active===true,order:Number(data.order??Number.MAX_SAFE_INTEGER),notes:String(data.notes??''),
    createdBy:String(data.createdBy??''),createdAt:data.createdAt,updatedBy:String(data.updatedBy??''),updatedAt:data.updatedAt,
    inactiveBy:typeof data.inactiveBy==='string'?data.inactiveBy:null,inactiveAt:data.inactiveAt??null}
}
export async function loadPurchaseCategories(){
  const snap=await getDocs(collection(db,'purchaseCategories'))
  return snap.docs.map(item=>category(item.id,item.data())).sort((a,b)=>a.order-b.order)
}
export async function loadVessels(){
  const snap=await getDocs(collection(db,'vessels'))
  const { activeVessels }=await import('../lib/purchasing')
  const rows=snap.docs.map(item=>vessel(item.id,item.data()))
  return [...activeVessels(rows),...rows.filter(item=>!item.active).sort((a,b)=>a.vesselCode.localeCompare(b.vesselCode))]
}
export async function loadActiveVessels(){ return activeVessels(await loadVessels()) }
export async function initializeDefaultVessels(){
  const uid=user().uid,existing=await loadVessels(),missing=buildDefaultVesselCreates(existing),orderRepairs=buildDefaultVesselOrderRepairs(existing)
  if(!missing.length&&!orderRepairs.length)return activeVessels(existing)
  await runTransaction(db,async transaction=>{
    const refs=missing.map(item=>doc(db,'vessels',item.vesselCode))
    const snapshots=await Promise.all(refs.map(ref=>transaction.get(ref)))
    missing.forEach((item,index)=>{if(!snapshots[index].exists())transaction.set(refs[index],{
      vesselCode:item.vesselCode,displayName:item.displayName,defaultSupplierId:'',defaultSupplierNameSnapshot:'',active:true,order:item.order,notes:'',
      createdBy:uid,createdAt:serverTimestamp(),updatedBy:uid,updatedAt:serverTimestamp(),inactiveBy:null,inactiveAt:null,
    })})
    orderRepairs.forEach(item=>transaction.update(doc(db,'vessels',item.id),{order:item.order,updatedBy:uid,updatedAt:serverTimestamp()}))
  })
  return loadActiveVessels()
}
export async function initializeDefaultPurchaseCategories(){
  const uid=user().uid
  const existing=await loadPurchaseCategories()
  const missing=buildDefaultCategoryCreates(existing)
  if(!missing.length)return existing
  await runTransaction(db,async transaction=>{
    const refs=missing.map(item=>doc(db,'purchaseCategories',item.categoryCode))
    const snapshots=await Promise.all(refs.map(ref=>transaction.get(ref)))
    missing.forEach((item,index)=>{
      if(snapshots[index].exists())return
      transaction.set(refs[index],{categoryCode:item.categoryCode,displayName:item.displayName,active:true,order:item.order,notes:'',
        createdBy:uid,createdAt:serverTimestamp(),updatedBy:uid,updatedAt:serverTimestamp(),inactiveBy:null,inactiveAt:null})
    })
  })
  return loadPurchaseCategories()
}
export async function createPurchaseCategory(input:PurchaseCategoryInput){
  const uid=user().uid;const clean=normalizeCategoryInput(input);const errors=validateCategoryInput(clean)
  if(errors.length)throw new Error(errors[0])
  const ref=doc(db,'purchaseCategories',clean.categoryCode)
  await setDoc(ref,{...clean,active:true,createdBy:uid,createdAt:serverTimestamp(),updatedBy:uid,updatedAt:serverTimestamp(),inactiveBy:null,inactiveAt:null})
  return {id:ref.id,...clean,active:true,createdBy:uid,updatedBy:uid,inactiveBy:null} as PurchaseCategory
}
export async function updatePurchaseCategory(item:PurchaseCategory,input:PurchaseCategoryInput){
  const uid=user().uid;const clean=normalizeCategoryInput(input);const errors=validateCategoryInput(clean)
  if(errors.length)throw new Error(errors[0]);if(clean.categoryCode!==item.categoryCode)throw new Error('Category code cannot be changed.')
  await setDoc(doc(db,'purchaseCategories',item.id),{displayName:clean.displayName,order:clean.order,notes:clean.notes,updatedBy:uid,updatedAt:serverTimestamp()},{merge:true})
  return {...item,...clean,updatedBy:uid}
}
async function setCategoryActive(item:PurchaseCategory,active:boolean){
  const uid=user().uid
  await setDoc(doc(db,'purchaseCategories',item.id),{active,updatedBy:uid,updatedAt:serverTimestamp(),
    inactiveBy:active?null:uid,inactiveAt:active?null:serverTimestamp()},{merge:true})
}
export const deactivatePurchaseCategory=(item:PurchaseCategory)=>setCategoryActive(item,false)
export const reactivatePurchaseCategory=(item:PurchaseCategory)=>setCategoryActive(item,true)

export async function createVessel(input:VesselInput){
  const uid=user().uid;const clean=normalizeVesselInput(input);const errors=validateVesselInput(clean)
  if(errors.length)throw new Error(errors[0])
  const ref=doc(collection(db,'vessels'))
  await setDoc(ref,{...clean,active:true,createdBy:uid,createdAt:serverTimestamp(),updatedBy:uid,updatedAt:serverTimestamp(),inactiveBy:null,inactiveAt:null})
  return {id:ref.id,...clean,active:true,createdBy:uid,updatedBy:uid,inactiveBy:null} as Vessel
}
export async function updateVessel(item:Vessel,input:VesselInput){
  const uid=user().uid;const clean=normalizeVesselInput(input);const errors=validateVesselInput(clean)
  if(errors.length)throw new Error(errors[0])
  await setDoc(doc(db,'vessels',item.id),{...clean,updatedBy:uid,updatedAt:serverTimestamp()},{merge:true})
  return {...item,...clean,updatedBy:uid}
}
async function setVesselActive(item:Vessel,active:boolean){
  const uid=user().uid
  await setDoc(doc(db,'vessels',item.id),{active,updatedBy:uid,updatedAt:serverTimestamp(),
    inactiveBy:active?null:uid,inactiveAt:active?null:serverTimestamp()},{merge:true})
}
export const deactivateVessel=(item:Vessel)=>setVesselActive(item,false)
export const reactivateVessel=(item:Vessel)=>setVesselActive(item,true)
