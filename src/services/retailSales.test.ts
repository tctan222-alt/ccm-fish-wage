import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeRetailLine, type RetailSaleInput } from '../lib/retailSales'
import seed from '../data/retailFishSeed.json'

const state = vi.hoisted(() => ({ records: new Map<string, Record<string, unknown>>(), versions: new Map<string, number>(), retries: 0, writes: vi.fn(), failPath: '', uid: 'u1', nextId: 0, beforeCommit: null as ((paths: string[]) => void) | null }))
vi.mock('../firebase', () => ({ db: {}, auth: { get currentUser() { return { uid: state.uid } } } }))
vi.mock('firebase/firestore', () => {
  const snapshot = (path: string) => ({ id: path.split('/').at(-1), exists: () => state.records.has(path), data: () => state.records.get(path) })
  return {
    collection: (_db: unknown, name: string) => ({ path: name }),
    doc: (parent: { path?: string }, ...parts: string[]) => {
      const path = [parent.path, ...(parent.path && !parts.length ? [`auto-${++state.nextId}`] : parts)].filter(Boolean).join('/')
      return { path, id: path.split('/').at(-1) }
    },
    getDoc: async (ref: { path: string }) => snapshot(ref.path),
    getDocs: async (ref?: { path: string }) => ({ docs: [...state.records.keys()].filter(path => path.startsWith(`${ref?.path ?? 'retailSales'}/`) && path.split('/').length === 2).map(snapshot) }),
    onSnapshot: (ref: { path: string }, next: (data: unknown) => void) => {
      next({ docs: [...state.records.keys()].filter(path => path.startsWith(`${ref.path}/`) && path.split('/').length === 2).map(snapshot) })
      return vi.fn()
    },
    query: vi.fn(), where: vi.fn(),
    serverTimestamp: () => { const now = Date.now(); return { toDate: () => new Date(now) } },
    // Model atomic commit and optimistic retries so a service regression that
    // allocates outside the transaction fails concurrent-save tests.
    runTransaction: async (_db: unknown, callback: (transaction: unknown) => Promise<unknown>) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const reads = new Map<string, number>(), staged = new Map<string, Record<string, unknown>>()
        const set = (ref: { path: string }, data: Record<string, unknown>) => {
          if (state.failPath === ref.path) { state.failPath = ''; throw new Error('connection interrupted') }
          staged.set(ref.path, data)
        }
        const result = await callback({
          get: async (ref: { path: string }) => { reads.set(ref.path, state.versions.get(ref.path) ?? 0); return snapshot(ref.path) },
          set,
          update: (ref: { path: string }, data: Record<string, unknown>) => set(ref, { ...state.records.get(ref.path), ...data }),
        })
        state.beforeCommit?.([...staged.keys()])
        if ([...reads].some(([path, version]) => version !== (state.versions.get(path) ?? 0))) { state.retries++; continue }
        for (const [path, data] of staged) { state.writes(path); state.records.set(path, data); state.versions.set(path, (state.versions.get(path) ?? 0) + 1) }
        return result
      }
      throw new Error('transaction retry limit')
    },
  }
})
import { clearPendingRetailSale, initializeRetailFish, loadPendingRetailSale, loadRetailSale, loadRetailSales, quickAddRetailFish, rememberPendingRetailSale, saveRetailFish, saveRetailSale, updateRetailSale, watchRetailFish } from './retailSales'
const input: RetailSaleInput = { businessDate: '06/09/2026', vendorName: '阿明', vesselId: 'v833', vesselCodeSnapshot: '833', lines: [makeRetailLine(seed[0], '2', '6.15')] }
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-08T12:00:00Z')); state.records.clear(); state.records.set('vessels/v833', { active: true, vesselCode: '833' }); state.versions.clear(); state.retries = 0; state.writes.mockClear(); state.failPath = ''; state.uid = 'u1'; state.nextId = 0; state.beforeCommit = null; sessionStorage.clear() })

it('stores independent same-day vessel snapshots and audits a vessel change without changing invoice identity', async () => {
  state.records.set('vessels/v978', { active: true, vesselCode: '978' })
  const first = await saveRetailSale('vessel-first', input)
  const second = await saveRetailSale('vessel-second', { ...input, vesselId: 'v978', vesselCodeSnapshot: '978' })
  expect([first.vesselCodeSnapshot, second.vesselCodeSnapshot]).toEqual(['833', '978'])
  const edited = await updateRetailSale(first.id, { ...input, vesselId: 'v978', vesselCodeSnapshot: '978' }, 1, 'vessel-edit')
  expect(edited).toMatchObject({ id: first.id, invoiceNumber: first.invoiceNumber, createdAt: first.createdAt, revision: 2, vesselId: 'v978', vesselCodeSnapshot: '978' })
  expect(state.records.get('retailSales/vessel-first/actions/vessel-edit')).toMatchObject({ beforeSnapshot: { vesselId: 'v833' }, afterSnapshot: { vesselId: 'v978' } })
})

describe('retail quick-add fish', () => {
  it('rejects saved aliases and Other Chinese names colliding with Malay, but allows two Malay translations to match', async () => {
    state.records.set('retailFish/existing', { chineseName: '金线', malayName: 'Kerisi', suggestedPriceCents: 205, active: true })
    await expect(saveRetailFish(null, { chineseName: '新鱼', malayName: '', suggestedPriceCents: null, active: true, aliases: ['Kerisi'] })).rejects.toThrow(/重复/)
    await expect(quickAddRetailFish({ chineseName: 'Kerisi', malayName: '', suggestedPriceCents: null, active: true })).rejects.toThrow(/重复/)
    expect(state.writes).not.toHaveBeenCalled()
    await expect(saveRetailFish(null, { chineseName: '另一鱼', malayName: 'Kerisi', suggestedPriceCents: null, active: true })).resolves.toMatchObject({ chineseName: '另一鱼' })
  })
  it('allows optional details, assigns successive order, blocks inactive alias duplicates and preserves audit on edit', async () => {
    const first = await quickAddRetailFish({ chineseName: '第一鱼', malayName: '', suggestedPriceCents: null, active: true })
    const second = await quickAddRetailFish({ chineseName: '第二鱼', malayName: '', suggestedPriceCents: null, active: true })
    expect([first.sortOrder, second.sortOrder]).toEqual([1, 2])
    const before = state.records.get(`retailFish/${first.id}`)!
    await saveRetailFish(first.id, { ...first, aliases: ['旧称'], active: false })
    expect(state.records.get(`retailFish/${first.id}`)).toMatchObject({ createdBy: before.createdBy, createdAt: before.createdAt, aliases: ['旧称'], active: false })
    await expect(quickAddRetailFish({ ...second, chineseName: '旧称' })).rejects.toThrow(/停用/)
    expect([...state.records.keys()].filter(path => !path.startsWith('vessels/')).length).toBe(2)
  })
  it('preserves an existing starter with a nonstarter ID without duplicating or overwriting it', async () => {
    state.records.set('retailFish/original', { ...seed[0], suggestedPriceCents: 999 })
    await initializeRetailFish()
    expect(state.records.has(`retailFish/${seed[0].id}`)).toBe(false)
    expect(state.records.get('retailFish/original')?.suggestedPriceCents).toBe(999)
    expect([...state.records.keys()].filter(path => !path.startsWith('vessels/')).length).toBe(31)
  })
  const fishInput = { chineseName: ' 新鱼 ', malayName: ' ikan baru ', suggestedPriceCents: 650, active: true }
  it('persists a reusable master item and preserves sale snapshots after later master changes', async () => {
    const created = await quickAddRetailFish(fishInput)
    expect(created).toEqual({ id: 'auto-1', chineseName: '新鱼', malayName: 'ikan baru', suggestedPriceCents: 650, active: true, aliases: [], sortOrder: 1 })
    expect(state.records.get(`retailFish/${created.id}`)).toMatchObject({ chineseName: '新鱼', malayName: 'ikan baru', suggestedPriceCents: 650, active: true, createdBy: 'u1', updatedBy: 'u1' })
    const next = vi.fn()
    watchRetailFish(next, vi.fn())
    expect(next).toHaveBeenCalledWith([expect.objectContaining(created)])
    await saveRetailSale('quick-sale', { ...input, lines: [makeRetailLine(created, '12.5', '6.50')] })
    await saveRetailFish(created.id, { ...created, chineseName: '新名称', malayName: 'changed', suggestedPriceCents: 900 })
    expect((await loadRetailSale('quick-sale')).lines[0]).toMatchObject({ fishId: created.id, chineseName: '新鱼', malayName: 'ikan baru', weightDeciKg: 125, unitPriceCents: 650, amountCents: 8125 })
  })
  it.each([
    { chineseName: ' ' },
    { suggestedPriceCents: 0 }, { suggestedPriceCents: -1 }, { suggestedPriceCents: 6.5 },
  ])('rejects incomplete or invalid quick-add data before any write: %j', async invalid => {
    await expect(quickAddRetailFish({ ...fishInput, ...invalid })).rejects.toThrow()
    expect(state.writes).not.toHaveBeenCalled()
    expect([...state.records.keys()].filter(path => !path.startsWith('vessels/')).length).toBe(0)
  })
  it('still allows optional Malay name and suggested price from master administration', async () => {
    await expect(saveRetailFish(null, { ...fishInput, malayName: '', suggestedPriceCents: null })).resolves.toMatchObject({ id: 'auto-1', malayName: '', suggestedPriceCents: null })
    expect(state.records.get('retailFish/auto-1')).toMatchObject({ malayName: '', suggestedPriceCents: null })
  })
  it('propagates persistence failures instead of returning an unpersisted fish', async () => {
    state.failPath = 'retailFish/auto-1'
    await expect(quickAddRetailFish(fishInput)).rejects.toThrow('connection interrupted')
    expect([...state.records.keys()].filter(path => !path.startsWith('vessels/')).length).toBe(0)
  })
})
describe('retail persistence', () => {
  it('writes full snapshots and does not duplicate a repeated checkout even with reordered Firestore keys', async () => {
    const first = await saveRetailSale('sale', input)
    const group = state.records.get('retailSales/sale/groups/first')!
    group.lines = [Object.fromEntries(Object.entries(input.lines[0]).reverse())]
    const retried = await saveRetailSale('sale', input)
    expect(first.lines).toEqual(input.lines); expect(retried.totalAmountCents).toBe(1230)
    expect(state.writes).toHaveBeenCalledTimes(7)
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
    expect(state.writes).toHaveBeenCalledTimes(6)
  })
  it('rejects reusing an ID with different business data', async () => {
    await saveRetailSale('sale', input)
    await expect(saveRetailSale('sale', { ...input, vendorName: 'different' })).rejects.toMatchObject({ code: 'retail/conflict' })
    expect(state.writes).toHaveBeenCalledTimes(7)
  })
  it('initializes only missing defaults without overwriting name, price, or inactive edits', async () => {
    await initializeRetailFish()
    const key = `retailFish/${seed[0].id}`
    state.records.set(key, { ...state.records.get(key), chineseName: '修正名', suggestedPriceCents: 999, active: false })
    await initializeRetailFish()
    expect(state.writes).toHaveBeenCalledTimes(31)
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

afterEach(() => vi.useRealTimers())
describe('Retail invoice counters and audited updates', () => {
  const counterPath = 'retailInvoiceCounters/20260906'
  it('continues beyond 999 and uses a backdated business date rather than the creation clock', async () => {
    state.records.set(counterPath, { lastSequence: 999 })
    const result = await saveRetailSale('backdated', input)
    expect(result.invoiceNumber).toBe('060920261000')
    expect(result.createdAt?.toDate().toISOString()).toBe('2026-09-08T12:00:00.000Z')
  })
  it('retains inactive historical snapshots and prices, but rejects a newly inactive or missing replacement', async () => {
    await saveRetailSale('sale', input)
    state.records.set(`retailFish/${seed[0].id}`, { ...seed[0], chineseName: '最新名', suggestedPriceCents: 99999, active: false })
    const unchanged = await updateRetailSale('sale', { ...input, remark: '保留原鱼' }, 1, 'keep-inactive')
    expect(unchanged.lines).toEqual(input.lines)
    for (const active of [false, undefined]) {
      if (active === false) state.records.set('retailFish/replacement', { ...seed[1], active })
      else state.records.delete('retailFish/replacement')
      const lines = [makeRetailLine({ ...seed[1], id: 'replacement' }, '1', '5')]
      await expect(updateRetailSale('sale', { ...input, lines }, 2, `inactive-${String(active)}`)).rejects.toMatchObject({ code: 'retail/inactive-fish' })
      expect((await loadRetailSale('sale')).revision).toBe(2)
    }
    state.records.set('retailFish/replacement', { ...seed[1], active: true })
    const lines = [makeRetailLine({ ...seed[1], id: 'replacement' }, '1', '5')]
    expect((await updateRetailSale('sale', { ...input, lines }, 2, 'active-replacement')).lines).toEqual(lines)
    expect(state.records.get('retailFish/replacement')?.suggestedPriceCents).toBe(seed[1].suggestedPriceCents)
  })
  it('revalidates a newly added copy or replacement even when that fish ID already exists in another original line', async () => {
    const lines = [input.lines[0], makeRetailLine(seed[1], '1', '8')]
    await saveRetailSale('sale', { ...input, lines })
    state.records.set(`retailFish/${seed[0].id}`, { ...seed[0], active: false })
    // The picker selected it while active, then Master was deactivated before Save.
    const replacement = { ...input, lines: [lines[0], input.lines[0]] }
    await expect(updateRetailSale('sale', replacement, 1, 'replace-existing', [0, -1])).rejects.toMatchObject({ code: 'retail/inactive-fish' })
    await expect(updateRetailSale('sale', { ...input, lines: [...lines, input.lines[0]] }, 1, 'add-existing', [0, 1, -1])).rejects.toMatchObject({ code: 'retail/inactive-fish' })
    expect((await loadRetailSale('sale')).revision).toBe(1)
    // Removing another line preserves the surviving original's identity, not its position.
    await expect(updateRetailSale('sale', { ...input, lines: [lines[0]] }, 1, 'retain-original', [0])).resolves.toMatchObject({ revision: 2 })
  })
  it('retains original inactive rows after removal/reordering and rejects forged or duplicated origin indices', async () => {
    const lines = [input.lines[0], makeRetailLine(seed[1], '1', '8')]
    await saveRetailSale('sale', { ...input, lines })
    state.records.set(`retailFish/${seed[1].id}`, { ...seed[1], active: false })
    await expect(updateRetailSale('sale', { ...input, lines: [lines[1]] }, 1, 'keep-second', [1])).resolves.toMatchObject({ revision: 2 })
    await expect(updateRetailSale('sale', { ...input, lines: [lines[1], lines[1]] }, 2, 'duplicate-origin', [0, 0])).rejects.toMatchObject({ code: 'retail/invalid-origin' })
    await expect(updateRetailSale('sale', { ...input, lines: [lines[0]] }, 2, 'fake-origin', [0])).rejects.toMatchObject({ code: 'retail/invalid-origin' })
    expect((await loadRetailSale('sale')).revision).toBe(2)
  })
  it('preserves separate duplicate historical rows by their unique origins, including reordering', async () => {
    const lines = [input.lines[0], { ...input.lines[0], unitPriceCents: 800, amountCents: 1600 }]
    await saveRetailSale('sale', { ...input, lines })
    state.records.set(`retailFish/${seed[0].id}`, { ...seed[0], active: false })
    const result = await updateRetailSale('sale', { ...input, lines: [lines[1], lines[0]] }, 1, 'reorder-originals', [1, 0])
    expect(result.lines).toEqual([lines[1], lines[0]])
    expect(result.totalAmountCents).toBe(2830)
  })
  it('rejects replacement back to the original fish after it becomes inactive, even though its ID is historical', async () => {
    await saveRetailSale('sale', input)
    state.records.set(`retailFish/${seed[0].id}`, { ...seed[0], active: false })
    await expect(updateRetailSale('sale', input, 1, 'replace-back', [-1])).rejects.toMatchObject({ code: 'retail/inactive-fish' })
    expect((await loadRetailSale('sale')).revision).toBe(1)
  })
  it('retries when a replacement Master becomes inactive after the transaction read, then rejects without committing an edit', async () => {
    await saveRetailSale('sale', input)
    const masterPath = `retailFish/${seed[1].id}`
    state.records.set(masterPath, { ...seed[1], active: true })
    state.beforeCommit = paths => {
      if (!paths.includes('retailSales/sale')) return
      state.beforeCommit = null
      state.records.set(masterPath, { ...seed[1], active: false })
      state.versions.set(masterPath, (state.versions.get(masterPath) ?? 0) + 1)
    }
    await expect(updateRetailSale('sale', { ...input, lines: [makeRetailLine(seed[1], '1', '8')] }, 1, 'deactivated-during-save', [-1])).rejects.toMatchObject({ code: 'retail/inactive-fish' })
    expect(state.retries).toBeGreaterThan(0)
    expect((await loadRetailSale('sale')).revision).toBe(1)
    expect(state.records.has('retailSales/sale/actions/deactivated-during-save')).toBe(false)
  })
  it('allocates 001, 002 for one business date and resets for the next date', async () => {
    expect((await saveRetailSale('first', input)).invoiceNumber).toBe('06092026001')
    expect((await saveRetailSale('second', input)).invoiceNumber).toBe('06092026002')
    expect((await saveRetailSale('next-day', { ...input, businessDate: '07/09/2026' })).invoiceNumber).toBe('07092026001')
    expect(state.records.get(counterPath)).toMatchObject({ lastSequence: 2, lastSaleId: 'second' })
  })
  it('retries contending daily counter reads so concurrent checkouts get distinct numbers', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => saveRetailSale(`device-${index}`, input)))
    expect(new Set(results.map(sale => sale.invoiceNumber)).size).toBe(6)
    expect(results.map(sale => sale.invoiceNumber).sort()).toEqual(Array.from({ length: 6 }, (_, index) => `0609202600${index + 1}`))
    expect(state.retries).toBeGreaterThan(0)
    expect(state.records.get(counterPath)?.lastSequence).toBe(6)
  })
  it.each(['retailSales/sale', 'retailSales/sale/actions/sale', counterPath])('does not commit an invoice, number or audit when final transaction fails at %s', async failPath => {
    state.failPath = failPath
    await expect(saveRetailSale('sale', input)).rejects.toThrow('connection interrupted')
    expect(state.records.has('retailSales/sale')).toBe(false)
    expect(state.records.has(counterPath)).toBe(false)
    expect(state.records.has('retailSales/sale/actions/sale')).toBe(false)
    expect((await loadRetailSales(input.businessDate))).toHaveLength(0)
    expect((await saveRetailSale('sale', input)).invoiceNumber).toBe('06092026001')
  })
  it('updates the same invoice and snapshots while retaining identity and recording before/after audit', async () => {
    const original = await saveRetailSale('sale', input)
    const storedBefore = state.records.get('retailSales/sale')!
    vi.setSystemTime(new Date('2026-09-09T11:59:00Z'))
    const lines = [makeRetailLine({ ...seed[0], chineseName: '修正鱼名', malayName: 'corrected' }, '12.5', '7.05')]
    const result = await updateRetailSale('sale', { ...input, vendorName: '新小贩', lines, remark: '  已核对  ' }, 1, 'edit-1')
    expect(result).toMatchObject({ id: 'sale', invoiceNumber: original.invoiceNumber, businessDate: input.businessDate, vendorName: '新小贩', revision: 2, remark: '已核对', lines, totalAmountCents: 8813 })
    expect(result.createdAt?.toDate()).toEqual(original.createdAt?.toDate())
    expect(result.updatedAt?.toDate().getTime()).toBeGreaterThan(original.updatedAt!.toDate().getTime())
    expect(state.records.get(counterPath)?.lastSequence).toBe(1)
    expect(await loadRetailSales(input.businessDate)).toHaveLength(1)
    expect(state.records.get('retailSales/sale/actions/edit-1')).toMatchObject({ type: 'update', revision: 2, performedBy: 'u1', beforeSnapshot: storedBefore, afterSnapshot: state.records.get('retailSales/sale') })
    expect(state.records.get('retailSales/sale/groups/first')?.lines).toEqual(input.lines)
    expect([...state.records.keys()].some(path => path.startsWith('retailFish/'))).toBe(false)
  })
  it('never changes the locked business date or allocates another number on edit', async () => {
    await saveRetailSale('sale', input)
    const writes = state.writes.mock.calls.length
    await expect(updateRetailSale('sale', { ...input, businessDate: '07/09/2026' }, 1, 'edit-date')).rejects.toMatchObject({ code: 'retail/date-immutable' })
    expect(state.writes).toHaveBeenCalledTimes(writes)
    expect(state.records.has('retailInvoiceCounters/20260907')).toBe(false)
  })
  it('locks historical invoices without a trusted createdAt, and never numbers them on read', async () => {
    state.records.set('retailSales/legacy', { businessDate: input.businessDate, vendorName: input.vendorName, dateSortKey: 20260906, totalAmountCents: 1230, lineGroups: { first: input.lines, second: [], third: [], fourth: [] } })
    await expect(updateRetailSale('legacy', input, 1, 'edit-legacy')).rejects.toMatchObject({ code: 'retail/time-unavailable' })
    expect(await loadRetailSale('legacy')).not.toHaveProperty('invoiceNumber')
    expect(state.writes).not.toHaveBeenCalled()
  })
  it('can edit eligible legacy invoices without generating a new invoice number or replacing creation metadata', async () => {
    const timestamp = { toDate: () => new Date('2026-09-07T12:00:00Z') }
    state.records.set('retailSales/legacy', { businessDate: input.businessDate, vendorName: input.vendorName, dateSortKey: 20260906, totalAmountCents: 1230,
      createdAt: timestamp, updatedAt: timestamp, createdBy: 'original-user', updatedBy: 'original-user', lineGroups: { first: input.lines, second: [], third: [], fourth: [] } })
    const result = await updateRetailSale('legacy', { ...input, vendorName: 'corrected' }, 1, 'edit-legacy')
    expect(result).toMatchObject({ id: 'legacy', createdAt: timestamp, createdBy: 'original-user', updatedBy: 'u1', revision: 2 })
    expect(result).not.toHaveProperty('invoiceNumber')
    expect(state.records.has(counterPath)).toBe(false)
  })
  it('rejects a stale revision instead of overwriting changes from another device', async () => {
    await saveRetailSale('sale', input)
    await updateRetailSale('sale', { ...input, vendorName: 'first edit' }, 1, 'edit-first')
    await expect(updateRetailSale('sale', { ...input, vendorName: 'stale edit' }, 1, 'edit-stale')).rejects.toMatchObject({ code: 'retail/conflict' })
    expect((await loadRetailSale('sale')).vendorName).toBe('first edit')
  })
  it('applies only one concurrent update from the same revision', async () => {
    await saveRetailSale('sale', input)
    const results = await Promise.allSettled([
      updateRetailSale('sale', { ...input, vendorName: 'device one' }, 1, 'edit-one'),
      updateRetailSale('sale', { ...input, vendorName: 'device two' }, 1, 'edit-two'),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((await loadRetailSale('sale')).revision).toBe(2)
    expect([...state.records.keys()].filter(path => path.includes('/actions/edit-'))).toHaveLength(1)
  })
  it('retries a failed update atomically without changing the displayed invoice or losing the before snapshot', async () => {
    await saveRetailSale('sale', input)
    state.failPath = 'retailSales/sale/actions/edit-retry'
    const changed = { ...input, vendorName: 'edited' }
    await expect(updateRetailSale('sale', changed, 1, 'edit-retry')).rejects.toThrow('connection interrupted')
    expect(await loadRetailSale('sale')).toMatchObject({ revision: 1, vendorName: input.vendorName })
    expect(state.records.has('retailSales/sale/actions/edit-retry')).toBe(false)
    await expect(updateRetailSale('sale', changed, 1, 'edit-retry')).resolves.toMatchObject({ revision: 2, vendorName: 'edited' })
    await expect(updateRetailSale('sale', changed, 1, 'edit-retry')).resolves.toMatchObject({ revision: 2 })
  })
  it('recognizes committed operations after a lost response, another revision, and expiry', async () => {
    await saveRetailSale('sale', input)
    const changed = { ...input, vendorName: 'edited' }
    await updateRetailSale('sale', changed, 1, 'edit-first')
    await updateRetailSale('sale', { ...input, vendorName: 'later edit' }, 2, 'edit-later')
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
    state.writes.mockClear()
    await expect(updateRetailSale('sale', changed, 1, 'edit-first')).resolves.toMatchObject({ revision: 3, vendorName: 'later edit' })
    await expect(saveRetailSale('sale', input)).resolves.toMatchObject({ invoiceNumber: '06092026001', revision: 3 })
    expect(state.writes).not.toHaveBeenCalled()
    expect(state.records.get(counterPath)?.lastSequence).toBe(1)
    await expect(updateRetailSale('sale', { ...input, vendorName: 'different retry' }, 1, 'edit-first')).rejects.toMatchObject({ code: 'retail/conflict' })
  })
  it('ignores attempts to inject immutable identity through business input', async () => {
    const original = await saveRetailSale('sale', input)
    const maliciousInput = { ...input, invoiceNumber: 'tampered', createdAt: new Date(), revision: 999 }
    const result = await updateRetailSale('sale', maliciousInput, 1, 'edit-identity')
    expect(result).toMatchObject({ invoiceNumber: original.invoiceNumber, createdAt: original.createdAt, revision: 2 })
  })
})
