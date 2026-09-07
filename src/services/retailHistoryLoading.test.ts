import { beforeEach, describe, expect, it, vi } from 'vitest'

interface StoredDocument { id: string; data: () => Record<string, unknown> }
interface QuerySnapshot { docs: StoredDocument[]; metadata: { fromCache: boolean } }
const state = vi.hoisted(() => ({
  next: undefined as ((snapshot: QuerySnapshot) => void) | undefined,
  error: undefined as ((error: Error) => void) | undefined,
  unsubscribe: vi.fn(), query: vi.fn(), where: vi.fn(), listen: vi.fn(), writes: vi.fn(),
}))
vi.mock('../firebase', () => ({ db: { name: 'test-only' }, auth: { currentUser: { uid: 'test-user' } } }))
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ path: name }),
  query: (collection: unknown, constraint: unknown) => { state.query(collection, constraint); return { collection, constraint } },
  where: (...args: unknown[]) => { state.where(...args); return args },
  onSnapshot: (query: unknown, options: unknown, next: (snapshot: QuerySnapshot) => void, error: (error: Error) => void) => {
    state.listen(query, options); state.next = next; state.error = error
    return state.unsubscribe
  },
  doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), runTransaction: state.writes, serverTimestamp: state.writes,
}))
import * as retailService from './retailSales'

function storedSale(id: string, timestamp: number, overrides: Record<string, unknown> = {}): StoredDocument {
  const data = {
    businessDate: '07/09/2026', dateSortKey: 20260907, vendorName: `Vendor ${id}`, totalAmountCents: 1230,
    createdAt: { toDate: () => new Date(timestamp) },
    lineGroups: { first: [{ fishId: 'old-fish', chineseName: '历史鱼名', malayName: 'old name', weightKg: 2, unitPriceCents: 615, amountCents: 1230 }], second: [], third: [], fourth: [] },
    ...overrides,
  }
  return { id, data: () => data }
}

beforeEach(() => {
  state.next = undefined; state.error = undefined
  vi.clearAllMocks()
})

describe('retail history subscription', () => {
  it('starts the selected business-date query immediately and keeps server metadata changes', () => {
    const unsubscribe = retailService.watchRetailSales('07/09/2026', vi.fn(), vi.fn())
    expect(state.where).toHaveBeenCalledWith('dateSortKey', '==', 20260907)
    expect(state.query).toHaveBeenCalledWith({ path: 'retailSales' }, ['dateSortKey', '==', 20260907])
    expect(state.listen).toHaveBeenCalledOnce()
    expect(state.listen).toHaveBeenCalledWith(expect.anything(), { includeMetadataChanges: true })
    expect(unsubscribe).toBe(state.unsubscribe)
    unsubscribe()
    expect(state.unsubscribe).toHaveBeenCalledOnce()
  })

  it('delivers initially empty cache then late server history through the same subscription', () => {
    const next = vi.fn(), error = vi.fn()
    retailService.watchRetailSales('07/09/2026', next, error)
    expect(next).not.toHaveBeenCalled()
    state.next!({ docs: [], metadata: { fromCache: true } })
    expect(next).toHaveBeenLastCalledWith({ sales: [], fromCache: true })
    state.next!({ docs: [storedSale('late', 100)], metadata: { fromCache: false } })
    expect(next).toHaveBeenLastCalledWith({ sales: [expect.objectContaining({ id: 'late' })], fromCache: false })
    expect(state.listen).toHaveBeenCalledOnce()
    expect(error).not.toHaveBeenCalled()
  })

  it('delivers server-confirmed empty history even when only metadata changes', () => {
    const next = vi.fn()
    retailService.watchRetailSales('07/09/2026', next, vi.fn())
    state.next!({ docs: [], metadata: { fromCache: true } })
    state.next!({ docs: [], metadata: { fromCache: false } })
    expect(next.mock.calls).toEqual([[{ sales: [], fromCache: true }], [{ sales: [], fromCache: false }]])
  })

  it('preserves legacy snapshots, orders newest first, and performs no writes', () => {
    const next = vi.fn(), older = storedSale('older', 100), newer = storedSale('newer', 200)
    const original = JSON.stringify(older.data())
    retailService.watchRetailSales('07/09/2026', next, vi.fn())
    state.next!({ docs: [older, newer], metadata: { fromCache: true } })
    expect(next).toHaveBeenCalledWith({ sales: [
      expect.objectContaining({ id: 'newer', lines: [expect.objectContaining({ chineseName: '历史鱼名', weightDeciKg: 20, unitPriceCents: 615, amountCents: 1230 })] }),
      expect.objectContaining({ id: 'older' }),
    ], fromCache: true })
    expect(JSON.stringify(older.data())).toBe(original)
    expect(state.writes).not.toHaveBeenCalled()
  })

  it('forwards query errors with their code instead of leaving consumers waiting', () => {
    const next = vi.fn(), error = vi.fn()
    retailService.watchRetailSales('07/09/2026', next, error)
    const denied = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })
    state.error!(denied)
    expect(error).toHaveBeenCalledWith(denied)
    expect(next).not.toHaveBeenCalled()
  })

  it('reports malformed snapshot mapping errors through the error callback', () => {
    const next = vi.fn(), error = vi.fn()
    retailService.watchRetailSales('07/09/2026', next, error)
    expect(() => state.next!({ docs: [storedSale('malformed', 100, { lineGroups: null })], metadata: { fromCache: false } })).not.toThrow()
    expect(error).toHaveBeenCalledWith(expect.any(Error))
    expect(next).not.toHaveBeenCalled()
  })
})
