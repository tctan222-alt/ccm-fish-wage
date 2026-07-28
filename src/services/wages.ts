import { collection,doc,serverTimestamp,writeBatch } from 'firebase/firestore'
import { auth,db,firebaseConfigured } from '../firebase'
import type { WageEntry } from '../types'

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