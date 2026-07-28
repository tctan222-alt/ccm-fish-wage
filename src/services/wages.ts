import { collection,doc,getDocs,query,serverTimestamp,where,writeBatch } from 'firebase/firestore'
import { auth,db,firebaseConfigured } from '../firebase'
import type { WageEntry } from '../types'

export interface StoredWageEntry extends WageEntry {
  id:string
  createdAt?:unknown
  updatedAt?:unknown
}

export async function saveWageEntries(entries:WageEntry[]):Promise<void> {
  if (!firebaseConfigured) throw new Error('Firebase is not configured')
  if (entries.length===0) return

  const batch=writeBatch(db)
  for (const entry of entries) {
    const reference=doc(collection(db,'fishHeadWageEntries'))
    batch.set(reference,{
      ...entry,
      createdBy:entry.createdBy??auth.currentUser?.uid??null,
      createdAt:serverTimestamp(),
      updatedAt:serverTimestamp(),
    })
  }
  await batch.commit()
}

export async function saveWageEntry(entry:WageEntry):Promise<void> {
  await saveWageEntries([entry])
}

export async function loadWageEntriesByDate(dateKey:string):Promise<StoredWageEntry[]> {
  if (!firebaseConfigured) throw new Error('Firebase is not configured')
  const snapshot=await getDocs(
    query(collection(db,'fishHeadWageEntries'),where('dateKey','==',dateKey)),
  )
  return snapshot.docs
    .map(item=>({id:item.id,...item.data()} as StoredWageEntry))
    .filter(entry=>entry.deleted===false)
}