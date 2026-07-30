import { collection,doc,getDocs,query,serverTimestamp,setDoc,updateDoc,where } from 'firebase/firestore'
import { auth,db,firebaseConfigured } from '../firebase'
import { makeWorkerCode,normalizeWorker,normalizeWorkerInput,validateWorker,type WorkerInput } from '../lib/masterData'
import type { Worker } from '../types'

function requireUser(){
  if(!firebaseConfigured)throw new Error('Firebase is not configured')
  const user=auth.currentUser
  if(!user)throw new Error('Authentication is required')
  return user
}

function sortWorkers(workers:Worker[]) {
  return workers.sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name))
}

function fromSnapshot(id:string,data:Record<string,unknown>){
  return normalizeWorker({id,...data} as unknown as Worker)
}

export async function loadWorkers():Promise<Worker[]> {
  if(!firebaseConfigured)throw new Error('Firebase is not configured')
  const snapshot=await getDocs(collection(db,'workers'))
  return sortWorkers(snapshot.docs.map(item=>fromSnapshot(item.id,item.data())))
}

export async function loadActiveWorkers():Promise<Worker[]> {
  if(!firebaseConfigured)throw new Error('Firebase is not configured')
  const snapshot=await getDocs(query(collection(db,'workers'),where('active','==',true)))
  return sortWorkers(snapshot.docs.map(item=>fromSnapshot(item.id,item.data()))).slice(0,20)
}

export async function createWorker(input:WorkerInput| string,order:number):Promise<Worker> {
  const user=requireUser()
  const value=typeof input==='string'
    ?{name:input,phone:'',department:'fish_head',employmentStartDate:'',employmentEndDate:'',notes:''}
    :input
  const clean=normalizeWorkerInput(value)
  const errors=validateWorker(clean)
  if(errors.length)throw new Error(errors[0])
  const reference=doc(collection(db,'workers'))
  const worker:Worker={
    id:reference.id,
    ...clean,
    workerCode:makeWorkerCode(reference.id),
    active:true,
    order,
    createdBy:user.uid,
    updatedBy:user.uid,
    inactiveBy:null,
    inactiveAt:null,
  }
  const timestamp=serverTimestamp()
  await setDoc(reference,{
    ...clean,
    workerCode:worker.workerCode,
    active:true,
    order,
    createdBy:user.uid,
    createdAt:timestamp,
    updatedBy:user.uid,
    updatedAt:timestamp,
    inactiveBy:null,
    inactiveAt:null,
  })
  return worker
}

export async function updateWorker(worker:Worker,input:WorkerInput):Promise<Worker> {
  const user=requireUser()
  const clean=normalizeWorkerInput(input)
  const errors=validateWorker(clean)
  if(errors.length)throw new Error(errors[0])
  const workerCode=worker.workerCode||makeWorkerCode(worker.id)
  await updateDoc(doc(db,'workers',worker.id),{
    ...clean,
    workerCode,
    inactiveBy:worker.inactiveBy??null,
    inactiveAt:worker.inactiveAt??null,
    updatedBy:user.uid,
    updatedAt:serverTimestamp(),
  })
  return {...worker,...clean,workerCode,updatedBy:user.uid}
}

export async function deactivateWorker(worker:Worker):Promise<void> {
  const user=requireUser()
  await updateDoc(doc(db,'workers',worker.id),{
    active:false,
    updatedBy:user.uid,
    updatedAt:serverTimestamp(),
    inactiveBy:user.uid,
    inactiveAt:serverTimestamp(),
  })
}

export async function reactivateWorker(worker:Worker):Promise<void> {
  const user=requireUser()
  await updateDoc(doc(db,'workers',worker.id),{
    active:true,
    updatedBy:user.uid,
    updatedAt:serverTimestamp(),
    inactiveBy:null,
    inactiveAt:null,
  })
}

export async function setWorkerActive(workerId:string,active:boolean):Promise<void> {
  const workers=await loadWorkers()
  const worker=workers.find(item=>item.id===workerId)
  if(!worker)throw new Error('Worker was not found')
  return active?reactivateWorker(worker):deactivateWorker(worker)
}
