import { addDoc,collection,doc,getDocs,query,updateDoc,where } from 'firebase/firestore'
import { db,firebaseConfigured } from '../firebase'
import type { Worker } from '../types'

function sortWorkers(workers:Worker[]) {
  return workers.sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name))
}

export async function loadWorkers():Promise<Worker[]> {
  if (!firebaseConfigured) throw new Error('Firebase is not configured')
  const snapshot=await getDocs(collection(db,'workers'))
  return sortWorkers(snapshot.docs.map(item=>({id:item.id,...item.data()} as Worker)))
}

export async function loadActiveWorkers():Promise<Worker[]> {
  if (!firebaseConfigured) throw new Error('Firebase is not configured')
  const snapshot=await getDocs(query(collection(db,'workers'),where('active','==',true)))
  return sortWorkers(snapshot.docs.map(item=>({id:item.id,...item.data()} as Worker))).slice(0,20)
}

export async function createWorker(name:string,order:number):Promise<Worker> {
  if (!firebaseConfigured) throw new Error('Firebase is not configured')
  const cleanName=name.trim()
  const reference=await addDoc(collection(db,'workers'),{name:cleanName,active:true,order})
  return {id:reference.id,name:cleanName,active:true,order}
}

export async function setWorkerActive(workerId:string,active:boolean):Promise<void> {
  if (!firebaseConfigured) throw new Error('Firebase is not configured')
  await updateDoc(doc(db,'workers',workerId),{active})
}