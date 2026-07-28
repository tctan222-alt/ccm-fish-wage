import { addDoc,collection,serverTimestamp } from 'firebase/firestore'
import { auth,db,firebaseConfigured } from '../firebase'
import type { WageEntry } from '../types'
export async function saveWageEntry(entry:WageEntry):Promise<void> {
  if (!firebaseConfigured) throw new Error('Firebase is not configured')
  await addDoc(collection(db,'fishHeadWageEntries'),{...entry,createdBy:entry.createdBy??auth.currentUser?.uid??null,createdAt:serverTimestamp(),updatedAt:serverTimestamp()})
}
