import { collection, doc, getDoc, getDocs, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore'
import { auth, db } from '../firebase'
import seed from '../data/retailFishSeed.json'
import { normalizeRetailFish, prepareRetailSale, type RetailFish, type RetailFishInput, type RetailLine, type RetailSale, type RetailSaleInput } from '../lib/retailSales'
import { sortKeyFromBusinessDate } from '../lib/businessDate'

function userId() {
  if (!auth.currentUser) throw new Error('请先登录。')
  return auth.currentUser.uid
}

export function watchRetailFish(next: (items: RetailFish[]) => void, error: (error: Error) => void) {
  return onSnapshot(collection(db, 'retailFish'), snapshot => next(snapshot.docs.map(item => ({ ...item.data(), id: item.id }) as RetailFish)
    .sort((a, b) => a.chineseName.localeCompare(b.chineseName, 'zh-Hans-CN'))), error)
}

export async function initializeRetailFish() {
  const uid = userId()
  // Stable IDs and transaction reads make retries safe without overwriting later edits.
  await runTransaction(db, async transaction => {
    const refs = seed.map(item => doc(db, 'retailFish', item.id))
    const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)))
    seed.forEach((input, index) => {
      if (!snapshots[index].exists()) transaction.set(refs[index], {
        ...normalizeRetailFish(input), createdBy: uid, updatedBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })
    })
  })
}

export async function saveRetailFish(id: string | null, input: RetailFishInput) {
  const uid = userId(), clean = normalizeRetailFish(input)
  const ref = id ? doc(db, 'retailFish', id) : doc(collection(db, 'retailFish'))
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref)
    if (id && !snapshot.exists()) throw new Error('鱼种已不存在，请刷新后重试。')
    if (snapshot.exists()) transaction.update(ref, { ...clean, updatedBy: uid, updatedAt: serverTimestamp() })
    else transaction.set(ref, { ...clean, createdBy: uid, updatedBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  })
}

export const newRetailSaleId = () => doc(collection(db, 'retailSales')).id

export interface PendingRetailSale { id: string; input: RetailSaleInput }
const pendingKey = () => `ccm:retail-pending:${userId()}`
export function loadPendingRetailSale(): PendingRetailSale | null {
  const value = sessionStorage.getItem(pendingKey())
  if (!value) return null
  const pending = JSON.parse(value) as PendingRetailSale
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(pending.id)) throw new Error('待确认结算编号无效，请从销售历史核对。')
  return { id: pending.id, input: prepareRetailSale(pending.input) }
}
export function rememberPendingRetailSale(pending: PendingRetailSale) {
  sessionStorage.setItem(pendingKey(), JSON.stringify(pending))
}
export function clearPendingRetailSale() { sessionStorage.removeItem(pendingKey()) }

function saleFromDocument(id: string, data: Record<string, unknown>): RetailSale {
  const groups = data.lineGroups as Record<'first' | 'second' | 'third' | 'fourth', RetailLine[]>
  return { ...data, id, lines: [...groups.first, ...groups.second, ...groups.third, ...groups.fourth] } as RetailSale
}

export async function saveRetailSale(id: string, input: RetailSaleInput): Promise<RetailSale> {
  const uid = userId(), clean = prepareRetailSale(input), ref = doc(db, 'retailSales', id)
  const { lines, ...header } = clean
  const lineGroups = { first: lines.slice(0, 5), second: lines.slice(5, 10), third: lines.slice(10, 15), fourth: lines.slice(15) }
  // Preparing immutable groups separately keeps Rules within its evaluation
  // budget. A sale is visible only after the final complete snapshot is committed.
  for (const [groupId, groupLines] of Object.entries(lineGroups)) {
    const groupRef = doc(ref, 'groups', groupId)
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(groupRef)
      if (snapshot.exists()) {
        const data = snapshot.data()
        const stored = data.lines.length ? prepareRetailSale({ ...input, lines: data.lines }).lines : []
        const expected = groupLines
        if (data.createdBy !== uid || data.lines.length !== groupLines.length || JSON.stringify(stored) !== JSON.stringify(expected)) throw new Error('结算明细编号已使用，请从历史核对。')
        return
      }
      transaction.set(groupRef, { lines: groupLines, totalAmountCents: groupLines.reduce<number>((sum, line) => sum + line.amountCents, 0), createdBy: uid, createdAt: serverTimestamp() })
    })
  }
  await runTransaction(db, async transaction => {
    const existing = await transaction.get(ref)
    if (existing.exists()) {
      const data = existing.data()
      if (data.createdBy !== uid || JSON.stringify(prepareRetailSale(saleFromDocument(id, data))) !== JSON.stringify(clean)) throw new Error('结算编号已使用，请从历史核对。')
      return
    }
    transaction.set(ref, { ...header, lineGroups, createdBy: uid, updatedBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  })
  return loadRetailSale(id)
}

export async function loadRetailSale(id: string): Promise<RetailSale> {
  const snapshot = await getDoc(doc(db, 'retailSales', id))
  if (!snapshot.exists()) throw new Error('找不到此现金结算单。')
  return saleFromDocument(snapshot.id, snapshot.data())
}

export async function loadRetailSales(businessDate: string): Promise<RetailSale[]> {
  const snapshot = await getDocs(query(collection(db, 'retailSales'), where('dateSortKey', '==', sortKeyFromBusinessDate(businessDate))))
  return snapshot.docs.map(item => saleFromDocument(item.id, item.data()))
    .sort((a, b) => (b.createdAt?.toDate().getTime() ?? 0) - (a.createdAt?.toDate().getTime() ?? 0))
}
