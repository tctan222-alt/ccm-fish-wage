import { collection,getDocs,query,where } from 'firebase/firestore'
import { db,firebaseConfigured } from '../firebase'
import type { Worker } from '../types'
export async function loadActiveWorkers():Promise<Worker[]> {
  if (!firebaseConfigured) throw new Error('Firebase is not configured')
  const snapshot=await getDocs(query(collection(db,'workers'),where('active','==',true)))
  return snapshot.docs.map(doc=>({id:doc.id,...doc.data()} as Worker)).sort((a,b)=>a.order-b.order).slice(0,20)
}
