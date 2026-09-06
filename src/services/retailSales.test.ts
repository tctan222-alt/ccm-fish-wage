import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeRetailLine, type RetailSaleInput } from '../lib/retailSales'
import seed from '../data/retailFishSeed.json'

const state = vi.hoisted(() => ({ records: new Map<string, Record<string, unknown>>(), writes: vi.fn(), failPath: '', uid: 'u1' }))
vi.mock('../firebase', () => ({ db: {}, auth: { get currentUser() { return { uid: state.uid } } } }))
vi.mock('firebase/firestore', () => {
  const snapshot = (path: string) => ({ id: path.split('/').at(-1), exists: () => state.records.has(path), data: () => state.records.get(path) })
  return {
    collection: (_db: unknown, name: string) => ({ path: name }),
    doc: (parent: { path?: string }, ...parts: string[]) => ({ path: [parent.path, ...parts].filter(Boolean).join('/') }),
    getDoc: async (ref: { path: string }) => snapshot(ref.path),
    getDocs: vi.fn(), onSnapshot: vi.fn(), query: vi.fn(), where: vi.fn(),
    serverTimestamp: () => ({ toDate: () => new Date('2026-09-06T12:00:00Z') }),
    runTransaction: async (_db: unknown, callback: (transaction: unknown) => Promise<void>) => callback({
      get: async (ref: { path: string }) => snapshot(ref.path),
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        if (state.failPath === ref.path) { state.failPath = ''; throw new Error('connection interrupted') }
        state.writes(ref.path); state.records.set(ref.path, data)
      },
      update: (ref: { path: string }, data: Record<string, unknown>) => { state.records.set(ref.path, { ...state.records.get(ref.path), ...data }) },
    }),
  }
})
import { clearPendingRetailSale, initializeRetailFish, loadPendingRetailSale, rememberPendingRetailSale, saveRetailSale } from './retailSales'
const input: RetailSaleInput = { businessDate: '06/09/2026', vendorName: '阿明', lines: [makeRetailLine(seed[0], '2', '6.15')] }
beforeEach(() => { state.records.clear(); state.writes.mockClear(); state.failPath = ''; state.uid = 'u1'; sessionStorage.clear() })
describe('retail persistence', () => {
  it('writes full snapshots and does not duplicate a repeated checkout even with reordered Firestore keys', async () => {
    const first = await saveRetailSale('sale', input)
    const group = state.records.get('retailSales/sale/groups/first')!
    group.lines = [Object.fromEntries(Object.entries(input.lines[0]).reverse())]
    const retried = await saveRetailSale('sale', input)
    expect(first.lines).toEqual(input.lines); expect(retried.totalAmountCents).toBe(1230)
    expect(state.writes).toHaveBeenCalledTimes(5)
  })
  it('keeps partial preparation out of sales and safely resumes the same ID', async () => {
    state.failPath = 'retailSales/sale/groups/second'
    await expect(saveRetailSale('sale', input)).rejects.toThrow('connection interrupted')
    expect(state.records.has('retailSales/sale')).toBe(false)
    await expect(saveRetailSale('sale', input)).resolves.toMatchObject({ totalAmountCents: 1230 })
    expect(state.writes.mock.calls.filter(([path]) => path === 'retailSales/sale/groups/first')).toHaveLength(1)
  })
  it('rejects reusing an ID with different business data', async () => {
    await saveRetailSale('sale', input)
    await expect(saveRetailSale('sale', { ...input, vendorName: 'different' })).rejects.toThrow('编号已使用')
    expect(state.writes).toHaveBeenCalledTimes(5)
  })
  it('initializes only missing defaults without overwriting name, price, or inactive edits', async () => {
    await initializeRetailFish()
    const key = `retailFish/${seed[0].id}`
    state.records.set(key, { ...state.records.get(key), chineseName: '修正名', suggestedPriceCents: 999, active: false })
    await initializeRetailFish()
    expect(state.writes).toHaveBeenCalledTimes(3)
    expect(state.records.get(key)).toMatchObject({ chineseName: '修正名', suggestedPriceCents: 999, active: false })
  })
  it('restores only the current user pending sale and clears it after confirmation', () => {
    rememberPendingRetailSale({ id: 'sale', input })
    expect(loadPendingRetailSale()).toMatchObject({ id: 'sale', input })
    state.uid = 'u2'; expect(loadPendingRetailSale()).toBeNull()
    state.uid = 'u1'; clearPendingRetailSale(); expect(loadPendingRetailSale()).toBeNull()
  })
})
