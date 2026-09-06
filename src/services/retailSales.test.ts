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
    getDocs: async () => ({ docs: [...state.records.keys()].filter(path => /^retailSales\/[^/]+$/.test(path)).map(snapshot) }),
    onSnapshot: vi.fn(), query: vi.fn(), where: vi.fn(),
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
import { clearPendingRetailSale, initializeRetailFish, loadPendingRetailSale, loadRetailSale, loadRetailSales, rememberPendingRetailSale, saveRetailSale } from './retailSales'
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
  it('persists decimal snapshots with no legacy weight field', async () => {
    const lines = [makeRetailLine(seed[0], '12.5', '6'), makeRetailLine(seed[1], '7.3', '8')]
    const sale = await saveRetailSale('decimal', { ...input, lines })
    expect(sale.totalAmountCents).toBe(13340)
    expect(sale.lines).toEqual(lines)
    expect(state.records.get('retailSales/decimal/groups/first')).toMatchObject({ lines, totalAmountCents: 13340 })
    expect(JSON.stringify(state.records.get('retailSales/decimal'))).not.toContain('weightKg')
  })
  it('reads historical integer kg snapshots in detail and history without rewriting stored data', async () => {
    const legacy = { fishId: 'old-fish', chineseName: '历史名称', malayName: 'old', weightKg: 2, unitPriceCents: 615, amountCents: 1230 }
    const record = { businessDate: input.businessDate, vendorName: input.vendorName, dateSortKey: 20260906, totalAmountCents: 1230, lineGroups: { first: [legacy], second: [], third: [], fourth: [] } }
    state.records.set('retailSales/old', record)
    const before = JSON.stringify(record)
    expect((await loadRetailSale('old')).lines[0]).toMatchObject({ chineseName: '历史名称', weightDeciKg: 20, amountCents: 1230 })
    expect((await loadRetailSales(input.businessDate))[0].lines[0]).toMatchObject({ weightDeciKg: 20, unitPriceCents: 615 })
    expect(JSON.stringify(state.records.get('retailSales/old'))).toBe(before)
    expect(state.writes).not.toHaveBeenCalled()
  })
  it('safely completes and retries a legacy pending checkout with existing immutable groups', async () => {
    const legacy = { fishId: 'old-fish', chineseName: '历史名称', malayName: 'old', weightKg: 2, unitPriceCents: 615, amountCents: 1230 }
    const legacyInput = { ...input, lines: Array.from({ length: 6 }, () => ({ ...legacy })) }
    const firstGroup = { lines: legacyInput.lines.slice(0, 5), totalAmountCents: 6150, createdBy: 'u1' }
    state.records.set('retailSales/old/groups/first', firstGroup)
    sessionStorage.setItem('ccm:retail-pending:u1', JSON.stringify({ id: 'old', input: legacyInput }))
    const pending = loadPendingRetailSale()!
    const sale = await saveRetailSale(pending.id, pending.input)
    expect(sale.lines).toHaveLength(6)
    expect(sale.lines[5]).toMatchObject({ weightDeciKg: 20, amountCents: 1230 })
    expect(state.records.get('retailSales/old/groups/first')).toBe(firstGroup)
    expect(state.records.get('retailSales/old/groups/second')).toMatchObject({ lines: [{ weightDeciKg: 20 }] })
    const header = state.records.get('retailSales/old')!
    expect(header).toMatchObject({ lineGroups: { first: firstGroup.lines, second: [{ weightDeciKg: 20 }] } })
    await expect(saveRetailSale(pending.id, pending.input)).resolves.toMatchObject({ totalAmountCents: 7380 })
    expect(state.writes).toHaveBeenCalledTimes(4)
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
  it('restores decimal pending weights exactly and rejects corrupt or unsupported precision', () => {
    const decimalInput = { ...input, lines: [makeRetailLine(seed[0], '7.3', '8')] }
    rememberPendingRetailSale({ id: 'decimal-pending', input: decimalInput })
    expect(loadPendingRetailSale()).toMatchObject({ id: 'decimal-pending', input: decimalInput })
    sessionStorage.setItem('ccm:retail-pending:u1', JSON.stringify({ id: 'invalid', input: { ...input, lines: [{ ...decimalInput.lines[0], weightDeciKg: 22.5 }] } }))
    expect(() => loadPendingRetailSale()).toThrow()
  })
})
