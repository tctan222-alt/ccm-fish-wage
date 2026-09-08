import { collection, doc, getDoc, getDocs, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore'
import { auth, db } from '../firebase'
import seed from '../data/retailFishSeed.json'
import { normalizeRetailFish, normalizeRetailLine, prepareRetailSale, type RetailFish, type RetailFishInput, type RetailLineInput, type RetailSale, type RetailSaleInput } from '../lib/retailSales'
import { sortKeyFromBusinessDate } from '../lib/businessDate'
import { retailHistoryRange, type RetailHistoryRange } from '../lib/retailHistory'
import { retailEditStatus, retailInvoiceNumber } from '../lib/retailInvoice'

function userId() {
  if (!auth.currentUser) throw new Error('请先登录。 Please sign in.')
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

export async function saveRetailFish(id: string | null, input: RetailFishInput): Promise<RetailFish> {
  const uid = userId(), clean = normalizeRetailFish(input)
  const ref = id ? doc(db, 'retailFish', id) : doc(collection(db, 'retailFish'))
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref)
    if (id && !snapshot.exists()) throw new Error('鱼种已不存在，请刷新后重试。 This fish no longer exists. Refresh and retry.')
    if (snapshot.exists()) transaction.update(ref, { ...clean, updatedBy: uid, updatedAt: serverTimestamp() })
    else transaction.set(ref, { ...clean, createdBy: uid, updatedBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  })
  return { id: ref.id, ...clean }
}

export async function quickAddRetailFish(input: RetailFishInput): Promise<RetailFish> {
  const clean = normalizeRetailFish(input)
  if (!clean.malayName) throw new Error('请输入马来文鱼名。 Please enter the Malay fish name.')
  if (clean.suggestedPriceCents === null) throw new Error('请输入建议 RM/kg。 Please enter the suggested price (RM/kg).')
  return saveRetailFish(null, clean)
}

export const newRetailSaleId = () => doc(collection(db, 'retailSales')).id

export interface PendingRetailSale { id: string; input: RetailSaleInput }
const pendingKey = () => `ccm:retail-pending:${userId()}`
export function loadPendingRetailSale(): { id: string; input: Omit<RetailSale, 'id' | 'createdAt'> } | null {
  const value = sessionStorage.getItem(pendingKey())
  if (!value) return null
  const pending = JSON.parse(value) as PendingRetailSale
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(pending.id)) throw new Error('待确认结算编号无效，请从销售历史核对。 Invalid pending invoice ID. Check Sales History.')
  return { id: pending.id, input: prepareRetailSale(pending.input) }
}
export function rememberPendingRetailSale(pending: PendingRetailSale) {
  sessionStorage.setItem(pendingKey(), JSON.stringify({ id: pending.id, input: prepareRetailSale(pending.input) }))
}
export function clearPendingRetailSale() { sessionStorage.removeItem(pendingKey()) }

function saleFromDocument(id: string, data: Record<string, unknown>): RetailSale {
  const groups = data.lineGroups as Record<'first' | 'second' | 'third' | 'fourth', RetailLineInput[]>
  return { ...data, id, lines: [...groups.first, ...groups.second, ...groups.third, ...groups.fourth].map(normalizeRetailLine) } as RetailSale
}

function retailError(code: string, message: string) { return Object.assign(new Error(message), { code }) }

function persistenceError(problem: unknown): Error {
  const code = problem && typeof problem === 'object' && 'code' in problem ? String(problem.code) : ''
  if (code === 'permission-denied') return retailError(code, '保存未获服务器允许，请检查登录权限及 3 天编辑期限，重新载入后重试。 Save was rejected. Check access and the 3-day editing period, then reload and retry.')
  if (code === 'unavailable' || code === 'deadline-exceeded') return retailError(code, '暂时无法确认保存结果，请检查网络后重试同一操作。 Unable to confirm the save. Check your connection and retry the same operation.')
  return problem instanceof Error ? problem : new Error('保存失败，请重试。 Save failed. Please retry.')
}

const operationPattern = /^[a-zA-Z0-9_-]{1,100}$/
function assertOperationId(value: string) {
  if (!operationPattern.test(value) || value === 'initial') throw new Error('操作编号无效，请重新载入。 Invalid operation ID. Please reload.')
}

function sameInput(id: string, data: Record<string, unknown>, clean: RetailSaleInput) {
  return JSON.stringify(prepareRetailSale(saleFromDocument(id, data))) === JSON.stringify(clean)
}

function saleHeader(clean: ReturnType<typeof prepareRetailSale>) {
  return { businessDate: clean.businessDate, dateSortKey: clean.dateSortKey, vendorName: clean.vendorName, remark: clean.remark ?? '', totalAmountCents: clean.totalAmountCents }
}

function assertReplay(data: Record<string, unknown>, id: string, uid: string, clean: RetailSaleInput, type: 'create' | 'update', revision: number) {
  if (data.type !== type || data.saleId !== id || data.performedBy !== uid || data.revision !== revision
    || !sameInput(id, data.afterSnapshot as Record<string, unknown>, clean)) {
    throw retailError('retail/conflict', '操作编号已用于其他修改，请重新载入。 This operation ID was used for another change. Please reload.')
  }
}

async function prepareGroups(id: string, input: RetailSaleInput, uid: string, groupSetId = 'initial') {
  const { lines } = prepareRetailSale(input), ref = doc(db, 'retailSales', id)
  const lineGroups: Record<'first' | 'second' | 'third' | 'fourth', RetailLineInput[]> = { first: lines.slice(0, 5), second: lines.slice(5, 10), third: lines.slice(10, 15), fourth: lines.slice(15) }
  // Each immutable preparation validates five lines within the Rules expression
  // budget. These documents are not invoices: only the final atomic header,
  // number counter and audit commit makes a sale or revision visible.
  for (const groupId of ['first', 'second', 'third', 'fourth'] as const) {
    const groupLines = lineGroups[groupId]
    const groupRef = doc(ref, 'groups', groupSetId === 'initial' ? groupId : `${groupSetId}_${groupId}`)
    lineGroups[groupId] = await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(groupRef)
      if (snapshot.exists()) {
        const data = snapshot.data()
        const stored = data.lines.length ? prepareRetailSale({ ...input, lines: data.lines }).lines : []
        const expected = groupLines
        if (data.createdBy !== uid || data.lines.length !== groupLines.length || JSON.stringify(stored) !== JSON.stringify(expected)) throw new Error('结算明细编号已使用，请从历史核对。 This invoice item ID is already in use. Check Sales History.')
        // Resume a pre-upgrade pending checkout with the exact immutable group
        // snapshot. Newly created groups always contain weightDeciKg.
        return data.lines as RetailLineInput[]
      }
      transaction.set(groupRef, { lines: groupLines, totalAmountCents: groupLines.reduce<number>((sum, line) => sum + line.amountCents, 0), createdBy: uid, createdAt: serverTimestamp() })
      return groupLines
    })
  }
  return lineGroups
}

export async function saveRetailSale(id: string, input: RetailSaleInput): Promise<RetailSale> {
  const uid = userId(), clean = prepareRetailSale(input), ref = doc(db, 'retailSales', id)
  assertOperationId(id)
  const actionRef = doc(ref, 'actions', id)
  try {
    const lineGroups = await prepareGroups(id, clean, uid)
    await runTransaction(db, async transaction => {
      const [existing, action] = await Promise.all([transaction.get(ref), transaction.get(actionRef)])
      if (existing.exists()) {
        const data = existing.data()
        // A lost response must not consume a second number, even if another device
        // has already edited the invoice since the original checkout committed.
        if (action.exists()) assertReplay(action.data(), id, uid, clean, 'create', 1)
        else if (data.createdBy !== uid || !sameInput(id, data, clean)) throw new Error('结算编号已使用，请从历史核对。 This invoice ID is already in use. Check Sales History.')
        return
      }
      const counterRef = doc(db, 'retailInvoiceCounters', String(clean.dateSortKey))
      const counter = await transaction.get(counterRef)
      const lastSequence = counter.exists() ? counter.data().lastSequence : 0
      if (!Number.isSafeInteger(lastSequence) || lastSequence < 0) throw new Error('单号计数器无效，请联系管理员。 Invalid invoice counter. Contact the administrator.')
      const sequence = lastSequence + 1, invoiceNumber = retailInvoiceNumber(clean.businessDate, sequence)
      const after = { ...saleHeader(clean), lineGroups, invoiceNumber, invoiceSequence: sequence, revision: 1, groupSetId: 'initial', lastActionId: id,
        createdBy: uid, updatedBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
      transaction.set(counterRef, { dateSortKey: clean.dateSortKey, lastSequence: sequence, lastSaleId: id, updatedBy: uid, updatedAt: serverTimestamp() })
      transaction.set(ref, after)
      transaction.set(actionRef, { type: 'create', saleId: id, clientOperationId: id, revision: 1, performedBy: uid, performedAt: serverTimestamp(), beforeSnapshot: null, afterSnapshot: after })
    })
    return await loadRetailSale(id)
  } catch (problem) { throw persistenceError(problem) }
}

function assertEditable(id: string, data: Record<string, unknown>, clean: RetailSaleInput, expectedRevision: number) {
  if ((data.revision ?? 1) !== expectedRevision) throw retailError('retail/conflict', '此结算单已被其他操作更新，请重新载入后再修改。 This invoice has changed. Reload before editing.')
  if (data.businessDate !== clean.businessDate) throw retailError('retail/date-immutable', '已保存的结算日期不可修改。 The saved invoice date cannot be changed.')
  const status = retailEditStatus(saleFromDocument(id, data))
  if (status === 'expired') throw retailError('retail/edit-expired', '已超过 3 天编辑期限 / Editing period expired')
  if (status !== 'editable') throw retailError('retail/time-unavailable', '无法确认首次保存时间，请检查设备时间并重新载入。 Unable to confirm the original save time. Check the device clock and reload.')
}

export async function updateRetailSale(id: string, input: RetailSaleInput, expectedRevision: number, operationId: string): Promise<RetailSale> {
  const uid = userId(), clean = prepareRetailSale(input), ref = doc(db, 'retailSales', id)
  assertOperationId(id); assertOperationId(operationId)
  if (operationId === id || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('修改版本或操作编号无效，请重新载入。 Invalid revision or operation ID. Please reload.')
  const actionRef = doc(ref, 'actions', operationId), revision = expectedRevision + 1
  try {
    const [before, priorAction] = await Promise.all([getDoc(ref), getDoc(actionRef)])
    if (!before.exists()) throw new Error('找不到此现金结算单。 Cash invoice not found.')
    if (priorAction.exists()) { assertReplay(priorAction.data(), id, uid, clean, 'update', revision); return await loadRetailSale(id) }
    assertEditable(id, before.data(), clean, expectedRevision)
    const lineGroups = await prepareGroups(id, clean, uid, operationId)
    await runTransaction(db, async transaction => {
      const [existing, action] = await Promise.all([transaction.get(ref), transaction.get(actionRef)])
      if (!existing.exists()) throw new Error('找不到此现金结算单。 Cash invoice not found.')
      if (action.exists()) { assertReplay(action.data(), id, uid, clean, 'update', revision); return }
      const data = existing.data()
      assertEditable(id, data, clean, expectedRevision)
      const after = { ...data, ...saleHeader(clean), lineGroups, revision, groupSetId: operationId, lastActionId: operationId, updatedBy: uid, updatedAt: serverTimestamp() }
      transaction.set(ref, after)
      transaction.set(actionRef, { type: 'update', saleId: id, clientOperationId: operationId, revision, performedBy: uid, performedAt: serverTimestamp(), beforeSnapshot: data, afterSnapshot: after })
    })
    return await loadRetailSale(id)
  } catch (problem) { throw persistenceError(problem) }
}

export async function loadRetailSale(id: string): Promise<RetailSale> {
  const snapshot = await getDoc(doc(db, 'retailSales', id))
  if (!snapshot.exists()) throw new Error('找不到此现金结算单。 Cash invoice not found.')
  return saleFromDocument(snapshot.id, snapshot.data())
}

export async function loadRetailSales(businessDate: string): Promise<RetailSale[]> {
  const snapshot = await getDocs(query(collection(db, 'retailSales'), where('dateSortKey', '==', sortKeyFromBusinessDate(businessDate))))
  return snapshot.docs.map(item => saleFromDocument(item.id, item.data()))
    .sort((a, b) => (b.createdAt?.toDate().getTime() ?? 0) - (a.createdAt?.toDate().getTime() ?? 0))
}

export interface RetailHistorySnapshot { sales: RetailSale[]; fromCache: boolean }

export function watchRetailSales(range: RetailHistoryRange, next: (snapshot: RetailHistorySnapshot) => void, error: (problem: unknown) => void) {
  const { fromDate, toDate } = retailHistoryRange('range', '', range.fromDate, range.toDate)
  const historyQuery = query(collection(db, 'retailSales'),
    where('dateSortKey', '>=', sortKeyFromBusinessDate(fromDate)),
    where('dateSortKey', '<=', sortKeyFromBusinessDate(toDate)))
  // Keep listening through initial cache/server synchronization. A one-shot getDocs
  // hides cached rows while waiting online and cannot update its first result later.
  return onSnapshot(historyQuery, { includeMetadataChanges: true }, snapshot => {
    try {
      const sales = snapshot.docs.map(item => saleFromDocument(item.id, item.data()))
        .sort((a, b) => b.dateSortKey - a.dateSortKey
          || (b.createdAt?.toDate().getTime() ?? 0) - (a.createdAt?.toDate().getTime() ?? 0)
          || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      next({ sales, fromCache: snapshot.metadata.fromCache })
    } catch (problem) { error(problem) }
  }, error)
}
