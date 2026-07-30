import {
  collection,
  doc,
  getDocs,
  getDocsFromServer,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import { auth,db,firebaseConfigured } from '../firebase'
import { monthDateRange } from '../lib/wage'
import type { WageEntry } from '../types'

export interface StoredWageEntry extends WageEntry {
  id:string
  createdAt?:unknown
  updatedAt?:unknown
}

export interface WageVoidRecord {
  id:string
  entryId:string
  dateKey:string
  workerId:string
  workerName:string
  weightKg:number
  rateRm:string
  wageRm:string
  voidReason:string
  voidedBy:string
  voidedAt?:unknown
}

export interface DailyWageData {
  entries:StoredWageEntry[]
  voids:WageVoidRecord[]
}
export interface MonthlyWageData extends DailyWageData {
  monthKey:string
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

export async function loadVoidsByDate(dateKey:string):Promise<WageVoidRecord[]> {
  if (!firebaseConfigured) throw new Error('Firebase is not configured')
  const snapshot=await getDocs(
    query(collection(db,'fishHeadWageVoids'),where('dateKey','==',dateKey)),
  )
  return snapshot.docs.map(item=>({id:item.id,...item.data()} as WageVoidRecord))
}

export async function loadDailyWageData(dateKey:string):Promise<DailyWageData> {
  const [entries,voids]=await Promise.all([
    loadWageEntriesByDate(dateKey),
    loadVoidsByDate(dateKey),
  ])
  return {entries,voids}
}

export async function loadWageEntriesByMonth(monthKey:string):Promise<StoredWageEntry[]> {
  if (!firebaseConfigured) throw new Error('Firebase is not configured')
  const {startDateKey,endDateKey}=monthDateRange(monthKey)
  const snapshot=await getDocs(
    query(
      collection(db,'fishHeadWageEntries'),
      where('dateKey','>=',startDateKey),
      where('dateKey','<=',endDateKey),
    ),
  )
  return snapshot.docs
    .map(item=>({id:item.id,...item.data()} as StoredWageEntry))
    .filter(entry=>entry.deleted===false)
}

export async function loadWageEntriesByMonthFromServer(monthKey:string):Promise<StoredWageEntry[]> {
  if (!firebaseConfigured) throw new Error('Firebase is not configured')
  const {startDateKey,endDateKey}=monthDateRange(monthKey)
  const snapshot=await getDocsFromServer(
    query(
      collection(db,'fishHeadWageEntries'),
      where('dateKey','>=',startDateKey),
      where('dateKey','<=',endDateKey),
    ),
  )
  return snapshot.docs
    .map(item=>({id:item.id,...item.data()} as StoredWageEntry))
    .filter(entry=>entry.deleted===false)
}

export async function loadVoidsByMonth(monthKey:string):Promise<WageVoidRecord[]> {
  if (!firebaseConfigured) throw new Error('Firebase is not configured')
  const {startDateKey,endDateKey}=monthDateRange(monthKey)
  const snapshot=await getDocs(
    query(
      collection(db,'fishHeadWageVoids'),
      where('dateKey','>=',startDateKey),
      where('dateKey','<=',endDateKey),
    ),
  )
  return snapshot.docs.map(item=>({id:item.id,...item.data()} as WageVoidRecord))
}

export async function loadMonthlyWageData(monthKey:string):Promise<MonthlyWageData> {
  const [entries,voids]=await Promise.all([
    loadWageEntriesByMonth(monthKey),
    loadVoidsByMonth(monthKey),
  ])
  return {monthKey,entries,voids}
}

export async function voidWageEntry(entry:StoredWageEntry,reason:string):Promise<void> {
  if (!firebaseConfigured) throw new Error('Firebase is not configured')
  const user=auth.currentUser
  if (!user) throw new Error('Authentication is required')

  const cleanReason=reason.trim()
  if (cleanReason.length===0||cleanReason.length>100) {
    throw new Error('A valid void reason is required')
  }

  const entryReference=doc(db,'fishHeadWageEntries',entry.id)
  const auditReference=doc(db,'fishHeadWageVoids',entry.id)
  const batch=writeBatch(db)

  batch.update(entryReference,{
    deleted:true,
    updatedAt:serverTimestamp(),
  })

  batch.set(auditReference,{
    entryId:entry.id,
    dateKey:entry.dateKey,
    workerId:entry.workerId,
    workerName:entry.workerName,
    weightKg:entry.weightKg,
    rateRm:entry.rateRm,
    wageRm:entry.wageRm,
    voidReason:cleanReason,
    voidedBy:user.uid,
    voidedAt:serverTimestamp(),
  })

  await batch.commit()
}
