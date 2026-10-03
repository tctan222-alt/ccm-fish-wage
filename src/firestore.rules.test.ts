import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch, type DocumentData, type DocumentReference, } from 'firebase/firestore'
import { createIceWorkRecord, createIceWorkSettlement } from './lib/iceWork'
import { makeRetailLine, MAX_RETAIL_LINES, prepareRetailSale, type RetailLineInput } from './lib/retailSales'
import { retailInvoiceNumber } from './lib/retailInvoice'
import retailSeed from './data/retailFishSeed.json'
import { createSettlementPageLoader,type ProjectedDocument } from './services/settlementSearch'

let environment: RulesTestEnvironment

describe('Firestore Emulator: projected settlement queries', () => {
  it.each(['fish_head', 'fish_meal'] as const)('executes real REST projection, range, product and cursor queries for %s without basket reads', async productType => {
    const prefix = `rest-${productType}`
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore()
      await Promise.all(Array.from({ length: 27 }, (_, index) => setDoc(doc(db, 'weighingSessions', `${prefix}-${String(index).padStart(2, '0')}`), {
        sessionCode: `${prefix}-${index}`, productType, weighingDate: index % 2 ? '2026-10-02' : '03/10/2026', monthKey: index % 2 ? '2026-10' : '10/2026',
        vesselId: 'rest-inactive', vesselCodeSnapshot: '历史船', status: 'completed', revision: 1,
        fishHeadBasketCount: 1, fishHeadWeightGrams: 80500, fishMealBucketBasketCount: 1, fishMealBagBasketCount: 0, fishMealTotalWeightGrams: 80500,
        notes: 'must not download this field',
      })))
    })
    // Unsigned identity is accepted only by the local Firebase Emulator; never a production credential.
    const token = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'rest-user', user_id: 'rest-user', aud: 'demo-ccm-rules', iss: 'https://securetoken.google.com/demo-ccm-rules', iat: 0, exp: 4102444800, firebase: { sign_in_provider: 'custom' } })).toString('base64url')}.`
    const endpoint = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-ccm-rules/databases/(default)/documents:runQuery`
    const load = createSettlementPageLoader(async query => {
      const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery: query }) })
      if (!response.ok) throw new Error(`Local query HTTP ${response.status}: ${await response.text()}`)
      const rows = await response.json() as { document?: ProjectedDocument }[]
      expect(rows.every(row => !row.document?.fields.notes)).toBe(true)
      return rows.flatMap(row => row.document ? [row.document] : [])
    })
    const criteria = { productType, from: '2026-10-01', to: '2026-10-31', vesselId: 'rest-inactive', status: 'completed' as const }
    const first = await load(criteria), second = await load(criteria, first.cursor)
    expect(first.items).toHaveLength(25); expect(second.items).toHaveLength(2)
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(27)
    expect([...first.items, ...second.items].slice(0,14).every(item => item.weighingDate === '03/10/2026')).toBe(true)
    expect([...first.items, ...second.items].slice(14).every(item => item.weighingDate === '2026-10-02')).toBe(true)
    expect(second.cursor).toBeNull()
  })
})

type RulesFirestore = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>
async function retailVesselFixture(sale: DocumentReference, uid = 'u1') {
  const db = sale.firestore
  const ref = doc(db, 'vessels', 'retail-833')
  await runTransaction(db, async tx => { if (!(await tx.get(ref)).exists()) tx.set(ref, { vesselCode: '833', displayName: '833', defaultSupplierId: '', defaultSupplierNameSnapshot: '', active: true, order: 0, notes: '', createdBy: uid, updatedBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), inactiveBy: null, inactiveAt: null }) })
  return { vesselId: ref.id, vesselCodeSnapshot: '833' }
}
async function createNumberedRetailSale(db: RulesFirestore, id: string, businessDate = '03/10/2026', uid = 'u1', vesselFields?: DocumentData) {
  const ref = doc(db, 'retailSales', id)
  const saved = await getDoc(ref)
  if (saved.exists()) return saved.data()
  const vessel = vesselFields ?? await retailVesselFixture(ref, uid)
  const clean = prepareRetailSale({ businessDate, vendorName: '阿明', lines: [makeRetailLine(retailSeed[0], '2', '6.15')] })
  const lineGroups = { first: clean.lines, second: [], third: [], fourth: [] }
  for (const [key, lines] of Object.entries(lineGroups)) await setDoc(doc(ref, 'groups', key), { lines, totalAmountCents: lines.reduce<number>((sum, line) => sum + line.amountCents, 0), createdBy: uid, createdAt: serverTimestamp() })
  return runTransaction(db, async tx => {
    const counterRef = doc(db, 'retailInvoiceCounters', String(clean.dateSortKey))
    const existing = await tx.get(ref), counter = await tx.get(counterRef)
    if (existing.exists()) return existing.data()
    const sequence = (counter.data()?.lastSequence ?? 0) + 1
    const after = { ...vessel, businessDate, dateSortKey: clean.dateSortKey, vendorName: clean.vendorName, totalAmountCents: clean.totalAmountCents, lineGroups, remark: '', invoiceNumber: retailInvoiceNumber(businessDate, sequence), invoiceSequence: sequence, revision: 1, groupSetId: 'initial', lastActionId: id, createdBy: uid, updatedBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
    tx.set(ref, after)
    tx.set(counterRef, { dateSortKey: clean.dateSortKey, lastSequence: sequence, lastSaleId: id, updatedBy: uid, updatedAt: serverTimestamp() })
    tx.set(doc(ref, 'actions', id), { type: 'create', saleId: id, clientOperationId: id, revision: 1, beforeSnapshot: null, afterSnapshot: after, performedBy: uid, performedAt: serverTimestamp() })
    return after
  })
}

async function updateNumberedRetailSale(db: RulesFirestore, id: string, operation: string, options: {
  before?: DocumentData; patch?: DocumentData; audit?: boolean; auditPatch?: DocumentData; lines?: RetailLineInput[]
} = {}) {
  const ref = doc(db, 'retailSales', id), before = options.before ?? (await getDoc(ref)).data()!
  const lines = options.lines ?? [makeRetailLine({ ...retailSeed[1], chineseName: '修正马丰', malayName: 'updated Malay' }, '12.5', '7.05')]
  const groups = { first: lines.slice(0, 5), second: lines.slice(5, 10), third: lines.slice(10, 15), fourth: lines.slice(15) }
  for (const [key, group] of Object.entries(groups)) await setDoc(doc(ref, 'groups', `${operation}_${key}`), {
    lines: group, totalAmountCents: group.reduce<number>((sum, line) => sum + line.amountCents, 0), createdBy: 'u1', createdAt: serverTimestamp(),
  })
  const after = { ...before, vendorName: '新小贩', remark: '已核对', lineGroups: groups, totalAmountCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
    revision: (before.revision ?? 1) + 1, groupSetId: operation, lastActionId: operation, updatedBy: 'u1', updatedAt: serverTimestamp(), ...options.patch }
  const batch = writeBatch(db)
  batch.set(ref, after)
  if (options.audit !== false) batch.set(doc(ref, 'actions', operation), { type: 'update', saleId: id, clientOperationId: operation, revision: after.revision,
    beforeSnapshot: before, afterSnapshot: after, performedBy: 'u1', performedAt: serverTimestamp(), ...options.auditPatch })
  return batch.commit()
}

describe('Firestore Rules: Retail 30-day numbered protocol', () => {
  it.each([
    {}, { vesselId: 'missing', vesselCodeSnapshot: '833' }, { vesselId: 'retail-833', vesselCodeSnapshot: 'FORGED' },
  ])('rejects a new invoice with absent, missing or forged vessel fields %j', async vesselFields => {
    const db = environment.authenticatedContext('u1').firestore()
    await retailVesselFixture(doc(db, 'retailSales', 'fixture'))
    await assertFails(createNumberedRetailSale(db, `bad-vessel-${Object.keys(vesselFields).length}-${vesselFields.vesselId ?? 'blank'}`, '03/10/2026', 'u1', vesselFields))
  })
  it('retains inactive vessel and legacy no-vessel snapshots on unrelated audited edits, but rejects selecting inactive vessels', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    await createNumberedRetailSale(db, 'inactive-vessel')
    await environment.withSecurityRulesDisabled(async context => updateDoc(doc(context.firestore(), 'vessels', 'retail-833'), { active: false }))
    await assertSucceeds(updateNumberedRetailSale(db, 'inactive-vessel', 'retained', { patch: { vendorName: '新小贩' } }))
    await assertFails(createNumberedRetailSale(db, 'new-inactive'))
    const before = (await getDoc(doc(db, 'retailSales', 'inactive-vessel'))).data()!
    const legacy = { ...before }; delete legacy.vesselId; delete legacy.vesselCodeSnapshot
    await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'retailSales', 'inactive-vessel'), legacy))
    await assertSucceeds(updateNumberedRetailSale(db, 'inactive-vessel', 'legacy-retained', { patch: { vendorName: '旧单修正' } }))
    await assertFails(updateNumberedRetailSale(db, 'inactive-vessel', 'inactive-new-choice', { patch: { vesselId: 'retail-833', vesselCodeSnapshot: '833' } }))
  })
  it('denies an audited vessel change at the exact 30-day boundary', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    await createNumberedRetailSale(db, 'expired-vessel')
    await environment.withSecurityRulesDisabled(async context => {
      await updateDoc(doc(context.firestore(), 'retailSales', 'expired-vessel'), { createdAt: Timestamp.fromMillis(Date.now() - 30 * 86400000) })
      await setDoc(doc(context.firestore(), 'vessels', 'v978'), { active: true, vesselCode: '978' })
    })
    await assertFails(updateNumberedRetailSale(db, 'expired-vessel', 'expired-vessel-edit', { patch: { vesselId: 'v978', vesselCodeSnapshot: '978' } }))
  })
  beforeEach(async () => { await environment.clearFirestore() })
  it('allows an audited vessel change only to an active Master snapshot', async () => {
    const db = environment.authenticatedContext('u1').firestore(), id = 'retail-vessel'
    await createNumberedRetailSale(db, id)
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'vessels', 'v978'), { active: true, vesselCode: '978' })
    })
    await assertSucceeds(updateNumberedRetailSale(db, id, 'change-vessel', { patch: { vesselId: 'v978', vesselCodeSnapshot: '978' } }))
    const saved = (await getDoc(doc(db, 'retailSales', id))).data()!
    expect(saved).toMatchObject({ vesselId: 'v978', vesselCodeSnapshot: '978', revision: 2 })
    expect((await getDoc(doc(db, 'retailSales', id, 'actions', 'change-vessel'))).data()?.afterSnapshot).toEqual(saved)
  })
  it('commits a numbered sale, its daily counter and immutable audit atomically', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    await assertSucceeds(createNumberedRetailSale(db, 'p10-first'))
    expect((await getDoc(doc(db, 'retailSales', 'p10-first'))).data()?.invoiceNumber).toBe('03102026001')
  })
  it('allocates unique numbers across two real authenticated clients, resets by business date, and retries without another allocation', async () => {
    const a = environment.authenticatedContext('u1').firestore(), b = environment.authenticatedContext('u2').firestore()
    await Promise.all([createNumberedRetailSale(a, 'device-a'), createNumberedRetailSale(b, 'device-b', '03/10/2026', 'u2')])
    const numbers = await Promise.all(['device-a', 'device-b'].map(async id => (await getDoc(doc(a, 'retailSales', id))).data()!.invoiceNumber))
    expect(numbers.sort()).toEqual(['03102026001', '03102026002'])
    await assertSucceeds(createNumberedRetailSale(a, 'device-a'))
    expect((await getDoc(doc(a, 'retailInvoiceCounters', '20261003'))).data()?.lastSequence).toBe(2)
    await assertSucceeds(createNumberedRetailSale(a, 'next-day', '04/10/2026'))
    expect((await getDoc(doc(a, 'retailSales', 'next-day'))).data()?.invoiceNumber).toBe('04102026001')
  })
  it('accepts sequence 1000 and uses the selected backdated business date', async () => {
    await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'retailInvoiceCounters', '20260903'), { lastSequence: 999 }))
    const db = environment.authenticatedContext('u1').firestore()
    await assertSucceeds(createNumberedRetailSale(db, 'sequence-1000', '03/09/2026'))
    expect((await getDoc(doc(db, 'retailSales', 'sequence-1000'))).data()?.invoiceNumber).toBe('030920261000')
  })
  it('updates only the same invoice with an immutable before/after audit and retains the original creation timestamp on a second edit', async () => {
    const db = environment.authenticatedContext('u1').firestore(), ref = doc(db, 'retailSales', 'editable')
    await createNumberedRetailSale(db, ref.id)
    const before = (await getDoc(ref)).data()!
    // Editing on day 20, then editing again, must retain the original deadline.
    before.createdAt = Timestamp.fromMillis(Date.now() - 20 * 86400000)
    await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'retailSales', ref.id), before))
    await assertSucceeds(updateNumberedRetailSale(db, ref.id, 'edit-one'))
    const after = (await getDoc(ref)).data()!
    expect(after).toMatchObject({ vendorName: '新小贩', remark: '已核对', revision: 2, invoiceNumber: before.invoiceNumber, invoiceSequence: 1, totalAmountCents: 8813 })
    expect(after.createdAt).toEqual(before.createdAt)
    const audit = (await getDoc(doc(ref, 'actions', 'edit-one'))).data()!
    expect(audit).toMatchObject({ beforeSnapshot: before, afterSnapshot: after, performedBy: 'u1' })
    expect(audit.performedAt).toEqual(after.updatedAt)
    await assertSucceeds(updateNumberedRetailSale(db, ref.id, 'edit-two'))
    expect((await getDoc(ref)).data()).toMatchObject({ revision: 3, createdAt: before.createdAt, invoiceNumber: before.invoiceNumber })
    expect((await getDocs(collection(db, 'retailSales'))).size).toBe(1)
    expect((await getDoc(doc(db, 'retailInvoiceCounters', '20261003'))).data()?.lastSequence).toBe(1)
    await assertFails(updateDoc(doc(ref, 'actions', 'edit-one'), { performedBy: 'u2' }))
    await assertFails(deleteDoc(doc(ref, 'actions', 'edit-one')))
    await assertFails(deleteDoc(ref))
  })
  it.each(['invoiceNumber', 'invoiceSequence', 'businessDate', 'dateSortKey', 'createdAt', 'createdBy', 'revision'])('rejects tampered immutable identity or revision: %s', async field => {
    const db = environment.authenticatedContext('u1').firestore(), id = `immutable-${field}`
    await createNumberedRetailSale(db, id)
    const patch: DocumentData = { [field]: { invoiceNumber: '03102026999', invoiceSequence: 999, businessDate: '04/10/2026', dateSortKey: 20261004,
      createdAt: serverTimestamp(), createdBy: 'u2', revision: 9 }[field] }
    if (field === 'businessDate') patch.dateSortKey = 20261004
    if (field === 'dateSortKey') patch.businessDate = '04/10/2026'
    await assertFails(updateNumberedRetailSale(db, id, 'tamper', { patch }))
    expect((await getDoc(doc(db, 'retailSales', id))).data()?.revision).toBe(1)
    expect((await getDoc(doc(db, 'retailSales', id, 'actions', 'tamper'))).exists()).toBe(false)
  })
  it('rejects missing/forged audits and invalid amount without committing either half of the update', async () => {
    const db = environment.authenticatedContext('u1').firestore(), id = 'invalid-update'
    await createNumberedRetailSale(db, id)
    for (const [operation, options] of [
      ['no-audit', { audit: false }], ['fake-before', { auditPatch: { beforeSnapshot: null } }],
      ['fake-actor', { auditPatch: { performedBy: 'u2' } }], ['fake-total', { patch: { totalAmountCents: 999 } }],
      ['long-remark', { patch: { remark: '字'.repeat(501) } }],
    ] as const) await assertFails(updateNumberedRetailSale(db, id, operation, options))
    expect((await getDoc(doc(db, 'retailSales', id))).data()?.revision).toBe(1)
    expect((await getDocs(collection(db, 'retailSales', id, 'actions'))).size).toBe(1)
  })
  it('allows only one of two captured-revision edits, preventing last-write-wins', async () => {
    const db = environment.authenticatedContext('u1').firestore(), other = environment.authenticatedContext('u1').firestore(), id = 'concurrent-edit'
    await createNumberedRetailSale(db, id)
    const before = (await getDoc(doc(db, 'retailSales', id))).data()!
    const results = await Promise.allSettled([updateNumberedRetailSale(db, id, 'edit-a', { before }), updateNumberedRetailSale(other, id, 'edit-b', { before })])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((await getDoc(doc(db, 'retailSales', id))).data()?.revision).toBe(2)
    expect((await getDocs(collection(db, 'retailSales', id, 'actions'))).size).toBe(2)
  })
  it('enforces SAVE-time expiry against original createdAt and fails closed on missing timestamps, despite an already captured editor snapshot', async () => {
    const db = environment.authenticatedContext('u1').firestore(), id = 'expiry-race', ref = doc(db, 'retailSales', id)
    await createNumberedRetailSale(db, id)
    const opened = (await getDoc(ref)).data()!
    for (const age of [30 * 86400000, 30 * 86400000 + 1000]) {
      const expired = { ...opened, createdAt: Timestamp.fromMillis(Date.now() - age) }
      await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'retailSales', id), expired))
      await assertFails(updateNumberedRetailSale(db, id, `expired-${age}`, { before: expired }))
    }
    const missing = { ...opened }; delete missing.createdAt
    await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'retailSales', id), missing))
    await assertFails(updateNumberedRetailSale(db, id, 'missing-clock', { before: missing }))
  })
  it('supports timestamped legacy integer snapshots without numbering them, and validates all 20 replacement rows', async () => {
    const db = environment.authenticatedContext('u1').firestore(), id = 'eligible-legacy'
    const legacy = { businessDate: '03/10/2026', dateSortKey: 20261003, vendorName: '原小贩', createdBy: 'original-owner', createdAt: Timestamp.fromMillis(Date.now() - 86400000),
      totalAmountCents: 1230, lineGroups: { first: [{ fishId: 'inactive-original', chineseName: '历史鱼名', malayName: 'old', weightKg: 2, unitPriceCents: 615, amountCents: 1230 }], second: [], third: [], fourth: [] } }
    await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'retailSales', id), legacy))
    const lines = Array.from({ length: 20 }, () => makeRetailLine(retailSeed[0], '0.1', '0.05'))
    await assertSucceeds(updateNumberedRetailSale(db, id, 'edit-legacy', { lines }))
    const result = (await getDoc(doc(db, 'retailSales', id))).data()!
    expect(result).toMatchObject({ revision: 2, createdBy: 'original-owner', createdAt: legacy.createdAt, totalAmountCents: 20 })
    expect(result.invoiceNumber).toBeUndefined()
    expect((await getDoc(doc(db, 'retailInvoiceCounters', '20261003'))).exists()).toBe(false)
  })
  describe('deterministic edit-window boundaries', () => {
    let fixed: RulesTestEnvironment
    const boundaryClock = Date.parse('2026-10-31T02:00:00Z')

    beforeAll(async () => {
      // Compile once during setup, rather than recompiling the entire ruleset
      // inside every 5-second assertion. Awaiting initialization also awaits
      // the Emulator's rules upload/compilation response.
      // Freeze ONLY the clock in retailEditOpen; writes/audit/counter rules
      // still use real request.time. The unmodified SAVE-time rule and expiry
      // race are exercised above.
      const source = await readFile('firestore.rules', 'utf8')
      const start = source.indexOf('function retailEditOpen('), end = source.indexOf('function retailNumber(', start)
      expect(start).toBeGreaterThanOrEqual(0)
      expect(end).toBeGreaterThan(start)
      const clock = `timestamp.value(${boundaryClock})`
      const rules = source.slice(0, start) + source.slice(start, end).replaceAll('now()', clock) + source.slice(end)
      fixed = await initializeTestEnvironment({ projectId: 'demo-p10-boundary', firestore: { rules } })
    })
    beforeEach(async () => { await fixed.clearFirestore() })
    afterAll(async () => { if (fixed) await fixed.cleanup() })

    it.each([0, 86400, 29 * 86400, 2591999, 2592000, 2592001])('compiles the unchanged expiry expression at a deterministic clock: age %s seconds', async age => {
      const db = fixed.authenticatedContext('u1').firestore(), id = 'boundary'
      await createNumberedRetailSale(db, id)
      const before = (await getDoc(doc(db, 'retailSales', id))).data()!
      before.createdAt = Timestamp.fromMillis(boundaryClock - age * 1000)
      await fixed.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'retailSales', id), before))
      const saving = updateNumberedRetailSale(db, id, 'boundary-edit', { before })
      if (age < 2592000) await assertSucceeds(saving)
      else await assertFails(saving)
    })
  })
})
const vessel = { vesselCode: '978', displayName: '978', defaultSupplierId: '', defaultSupplierNameSnapshot: '', active: true, order: 0, notes: '', createdBy: 'u1', createdAt: serverTimestamp(), updatedBy: 'u1', updatedAt: serverTimestamp(), inactiveBy: null, inactiveAt: null }

function weighingRecord(daysAgo=1,overrides:DocumentData={}) {
  const completedAt=Timestamp.fromMillis(Date.now()-daysAgo*24*60*60*1000)
  return {
    sessionCode:'FH-978-13092026-01',productType:'fish_head',weighingDate:'13/09/2026',monthKey:'09/2026',dateSortKey:20260913,monthSortKey:202609,
    externalSlipNo:'',vesselId:'v978',vesselCodeSnapshot:'978',vesselNameSnapshot:'978',status:'completed',lastSequenceNo:1,
    fishHeadBasketCount:1,fishHeadWeightGrams:1000,fishMealBucketBasketCount:0,fishMealBucketWeightGrams:0,
    fishMealBagBasketCount:0,fishMealBagWeightGrams:0,fishMealTotalWeightGrams:0,totalWeightGrams:1000,
    processedReceiptId:null,processedReceiptCode:null,notes:'',revision:2,voidReason:null,createdBy:'u1',createdAt:completedAt,
    updatedBy:'u1',updatedAt:completedAt,completedBy:'u1',completedAt,processedBy:null,processedAt:null,voidedBy:null,voidedAt:null,lastActionId:'complete-1',...overrides,
  }
}

async function seedWeighing(id:string,data=weighingRecord()) {
  await environment.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'weighingSessions',id),data))
  return doc(environment.authenticatedContext('u1').firestore(),'weighingSessions',id)
}

async function changeWeighing(ref:DocumentReference,type:string,patch:DocumentData,revisionDelta=1) {
  const before=(await getDoc(ref)).data()!,actionId=`${type}-${before.revision+1}`
  const after={...before,...patch,revision:before.revision+revisionDelta,updatedBy:'u1',updatedAt:serverTimestamp(),lastActionId:actionId}
  const batch=writeBatch(ref.firestore)
  batch.set(ref,after)
  batch.set(doc(ref,'actions',actionId),{type,sessionId:ref.id,entryId:null,reason:'修正记录',performedBy:'u1',performedAt:serverTimestamp(),
    beforeSnapshot:before,afterSnapshot:after,clientOperationId:actionId})
  return batch.commit()
}

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: 'demo-ccm-rules', firestore: { rules: await readFile('firestore.rules', 'utf8') } }) })
afterAll(async () => { if (environment) await environment.cleanup() })

describe('Firestore Rules: source-authoritative purchase settlement identity', () => {
  function draft(sourceSessionId:string,overrides:DocumentData={}):DocumentData {
    const line={lineType:'fish_head',nameSnapshot:'金线',totalWeightGrams:100_000,basketCount:1,totalWeightEntryCount:0,
      defaultUnitPriceCentsPerKg:275,unitPriceCentsPerKg:290,priceWasEdited:true,amountCents:29_000,
      sourceEntryIds:['saved-entry'],fishSpeciesId:'jin_xian',fishSpeciesCodeSnapshot:'jin_xian',fishSpeciesNameSnapshot:'金线'}
    return {productType:'fish_head',businessDate:'03/08/2026',dateSortKey:20260803,monthKey:'08/2026',monthSortKey:202608,
      vesselId:'v978',vesselCodeSnapshot:'978',receiptNo:'saved-receipt',status:'settlement_draft',lines:[line],totalAmountCents:29_000,
      sourceEntryIds:['saved-entry'],sourceSessionId,sourceSessionRevision:2,createdBy:'u1',createdAt:serverTimestamp(),
      updatedBy:'u1',updatedAt:serverTimestamp(),revision:1,voided:false,...overrides}
  }
  async function source(id:string,overrides:DocumentData={}) {
    return seedWeighing(id,weighingRecord(1,{weighingDate:'03/08/2026',dateSortKey:20260803,monthKey:'08/2026',monthSortKey:202608,...overrides}))
  }
  async function save(id:string,sourceSessionId:string,patch:DocumentData={},options:{guard?:boolean;audit?:boolean;userId?:string;guardPatch?:DocumentData}={}) {
    const userId=options.userId??'u1',db=environment.authenticatedContext(userId).firestore()
    const ref=doc(db,'purchaseSettlementDrafts',id),existing=await getDoc(ref),before=existing.exists()?existing.data()!:null
    const next:DocumentData={...(before??draft(sourceSessionId,{createdBy:userId})),sourceSessionId,
      revision:before?before.revision+1:1,updatedBy:userId,updatedAt:serverTimestamp(),...patch}
    const batch=writeBatch(db)
    batch.set(ref,next)
    if(options.audit!==false)batch.set(doc(ref,'actions',String(next.revision)),{
      beforeSnapshot:before,afterSnapshot:next,performedBy:userId,performedAt:serverTimestamp()})
    const guardRef=doc(db,'purchaseSettlementSources',`${next.productType}_session_${sourceSessionId}`)
    if(options.guard!==false&&!(await getDoc(guardRef)).exists())batch.set(guardRef,{
      productType:next.productType,sourceSessionId,draftId:id,createdBy:userId,createdAt:serverTimestamp(),...options.guardPatch})
    return batch.commit()
  }
  async function seedLegacy(id:string,sourceSessionId:string,bound=false,overrides:DocumentData={}) {
    const createdAt=Timestamp.fromMillis(Date.now()-120_000)
    const value=draft(sourceSessionId,{createdAt,updatedAt:createdAt,createdBy:'original-owner',revision:4,...overrides})
    if(!bound) { delete value.sourceSessionId; delete value.sourceSessionRevision }
    await environment.withSecurityRulesDisabled(async context=>{
      const db=context.firestore()
      await setDoc(doc(db,'purchaseSettlementDrafts',id),value)
      await setDoc(doc(db,'weighingSessions',sourceSessionId,'entries','saved-entry'),{
        sessionId:sourceSessionId,productType:'fish_head',recordedAt:Timestamp.fromMillis(createdAt.toMillis()-60_000)})
    })
    return value
  }
  it('allows canonical audited creation and rejects tuple, arbitrary ID, missing guard or mismatched guard target',async()=>{
    const sourceId='p5-canonical',canonical=`fish_head_session_${sourceId}`
    await source(sourceId)
    await assertFails(save(canonical,sourceId,{}, {guard:false}))
    await assertFails(save('fish_head_20260803_v978',sourceId))
    await assertFails(save('arbitrary-draft',sourceId))
    await assertFails(save(canonical,sourceId,{}, {guardPatch:{draftId:'another-draft'}}))
    await assertSucceeds(save(canonical,sourceId))
    const db=environment.authenticatedContext('u1').firestore()
    expect((await getDoc(doc(db,'purchaseSettlementSources',canonical))).data()?.draftId).toBe(canonical)
    const anonymous=environment.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(anonymous,'purchaseSettlementDrafts',canonical)))
    await assertFails(getDoc(doc(anonymous,'purchaseSettlementSources',canonical)))
  })
  it('permits current source date and vessel correction while preserving prices, creation and audited previous metadata',async()=>{
    const sourceId='p5-corrected',id=`fish_head_session_${sourceId}`,db=environment.authenticatedContext('u1').firestore()
    await source(sourceId)
    await assertSucceeds(save(id,sourceId))
    const original=(await getDoc(doc(db,'purchaseSettlementDrafts',id))).data()!
    await source(sourceId,{weighingDate:'02/10/2026',dateSortKey:20261002,monthKey:'10/2026',monthSortKey:202610,
      vesselId:'v833',vesselCodeSnapshot:'833',revision:3})
    const lines=[{...original.lines[0],totalWeightGrams:160_000,amountCents:46_400}]
    await assertSucceeds(save(id,sourceId,{businessDate:'02/10/2026',dateSortKey:20261002,monthKey:'10/2026',monthSortKey:202610,
      vesselId:'v833',vesselCodeSnapshot:'833',sourceSessionRevision:3,lines,totalAmountCents:46_400}))
    const current=(await getDoc(doc(db,'purchaseSettlementDrafts',id))).data()!
    expect(current.createdAt).toEqual(original.createdAt)
    expect(current.createdBy).toBe(original.createdBy)
    expect(current.revision).toBe(2)
    expect(current.lines[0]).toMatchObject({unitPriceCentsPerKg:290,priceWasEdited:true,totalWeightGrams:160_000,amountCents:46_400})
    const action=(await getDoc(doc(db,'purchaseSettlementDrafts',id,'actions','2'))).data()!
    expect(action.beforeSnapshot).toEqual(original)
    expect(action.afterSnapshot).toEqual(current)
    expect(action.performedBy).toBe('u1')
  })
  it('retains bound legacy document ID and allows corrected metadata without copying it',async()=>{
    const sourceId='p5-bound-legacy',id='fish_head_20260803_p5-bound',db=environment.authenticatedContext('u1').firestore()
    await source(sourceId)
    const original=await seedLegacy(id,sourceId,true)
    await source(sourceId,{weighingDate:'04/08/2026',dateSortKey:20260804,revision:3})
    await assertSucceeds(save(id,sourceId,{businessDate:'04/08/2026',dateSortKey:20260804,sourceSessionRevision:3}))
    const result=(await getDoc(doc(db,'purchaseSettlementDrafts',id))).data()!
    expect(result.createdAt).toEqual(original.createdAt)
    expect(result.createdBy).toBe('original-owner')
    expect(result.lines).toEqual(original.lines)
    expect(result.revision).toBe(5)
    expect((await getDoc(doc(db,'purchaseSettlementSources',`fish_head_session_${sourceId}`))).data()?.draftId).toBe(id)
    expect((await getDoc(doc(db,'purchaseSettlementDrafts',`fish_head_session_${sourceId}`))).exists()).toBe(false)
    await assertFails(save(`fish_head_session_${sourceId}`,sourceId,{businessDate:'04/08/2026',dateSortKey:20260804,sourceSessionRevision:3}))
  })
  it('binds an unbound legacy draft using its previously recorded source entry and retains saved snapshots',async()=>{
    const sourceId='p5-unbound',id='fish_head_20260803_p5-unbound',db=environment.authenticatedContext('u1').firestore()
    await source(sourceId)
    const original=await seedLegacy(id,sourceId)
    await assertSucceeds(save(id,sourceId,{sourceSessionRevision:2}))
    const value=(await getDoc(doc(db,'purchaseSettlementDrafts',id))).data()!
    expect(value).toMatchObject({sourceSessionId:sourceId,sourceSessionRevision:2,createdBy:'original-owner',revision:5})
    expect(value.createdAt).toEqual(original.createdAt)
    expect(value.lines).toEqual(original.lines)
    const before=(await getDoc(doc(db,'purchaseSettlementDrafts',id,'actions','5'))).data()?.beforeSnapshot
    expect(before).toEqual(original)
    expect(before.sourceSessionId).toBeUndefined()
  })
  it('rejects forged legacy proof from incoming IDs, another source/product, or an entry recorded after the legacy draft',async()=>{
    for(const kind of ['incoming-only','wrong-session','wrong-product','too-new']) {
      const sourceId=`p5-proof-${kind}`,id=`legacy-${kind}`
      await source(sourceId)
      const original=await seedLegacy(id,sourceId)
      await environment.withSecurityRulesDisabled(async context=>{
        const entryRef=doc(context.firestore(),'weighingSessions',sourceId,'entries','saved-entry')
        if(kind==='incoming-only') {
          await deleteDoc(entryRef)
          await setDoc(doc(context.firestore(),'weighingSessions',sourceId,'entries','invented-entry'),{
            sessionId:sourceId,productType:'fish_head',recordedAt:Timestamp.fromMillis(original.createdAt.toMillis()-60_000)})
        } else await updateDoc(entryRef,kind==='wrong-session'?{sessionId:'another-session'}:
          kind==='wrong-product'?{productType:'fish_meal'}:{recordedAt:Timestamp.fromMillis(Date.now())})
      })
      await assertFails(save(id,sourceId,{sourceSessionRevision:2,...(kind==='incoming-only'?{sourceEntryIds:['invented-entry']}: {})}))
    }
  })
  it('keeps source binding, source guard, creation, revisions and audit immutable',async()=>{
    const sourceId='p5-immutable',otherId='p5-immutable-other',id=`fish_head_session_${sourceId}`,db=environment.authenticatedContext('u1').firestore()
    await source(sourceId)
    await source(otherId)
    await assertSucceeds(save(id,sourceId))
    await assertFails(save(id,otherId))
    await assertFails(save(id,sourceId,{createdBy:'another-user'}))
    await assertFails(save(id,sourceId,{createdAt:serverTimestamp()}))
    await assertFails(save(id,sourceId,{revision:7}))
    await assertFails(save(id,sourceId,{}, {audit:false}))
    const guard=doc(db,'purchaseSettlementSources',id)
    await assertFails(updateDoc(guard,{draftId:'replacement'}))
    await assertFails(updateDoc(guard,{sourceSessionId:otherId}))
    await assertFails(deleteDoc(guard))
    await assertFails(updateDoc(doc(db,'purchaseSettlementDrafts',id,'actions','1'),{performedBy:'another-user'}))
    await assertFails(deleteDoc(doc(db,'purchaseSettlementDrafts',id)))
  })
  it('rejects incorrect source metadata, revision, guard ownership and timestamps',async()=>{
    const sourceId='p5-metadata',id=`fish_head_session_${sourceId}`
    await source(sourceId)
    await assertFails(save(id,sourceId,{monthKey:'09/2026'}))
    await assertFails(save(id,sourceId,{monthSortKey:202609}))
    await assertFails(save(id,sourceId,{businessDate:'04/08/2026',dateSortKey:20260804}))
    await assertFails(save(id,sourceId,{vesselId:'v833',vesselCodeSnapshot:'833'}))
    await assertFails(save(id,sourceId,{sourceSessionRevision:1}))
    await assertFails(save(id,sourceId,{}, {guardPatch:{createdBy:'another-user'}}))
    await assertFails(save(id,sourceId,{}, {guardPatch:{createdAt:Timestamp.fromMillis(0)}}))
    await assertFails(save(id,sourceId,{}, {guardPatch:{sourceSessionId:'another-session'}}))
    await assertFails(save(id,sourceId,{}, {guardPatch:{productType:'fish_meal'}}))
    await assertSucceeds(save(id,sourceId))
  })
  it('gives same-vessel same-day source sessions separate canonical drafts',async()=>{
    for(const sourceId of ['p5-same-tuple-a','p5-same-tuple-b']) {
      await source(sourceId)
      await assertSucceeds(save(`fish_head_session_${sourceId}`,sourceId))
    }
    const db=environment.authenticatedContext('u1').firestore()
    const a=(await getDoc(doc(db,'purchaseSettlementDrafts','fish_head_session_p5-same-tuple-a'))).data()!
    const b=(await getDoc(doc(db,'purchaseSettlementDrafts','fish_head_session_p5-same-tuple-b'))).data()!
    expect(a.vesselId).toBe(b.vesselId)
    expect(a.dateSortKey).toBe(b.dateSortKey)
    expect(a.sourceSessionId).not.toBe(b.sourceSessionId)
  })
  it('preserves fish-meal canonical creation and edits under the same source guard',async()=>{
    const sourceId='p5-fish-meal',id=`fish_meal_session_${sourceId}`,db=environment.authenticatedContext('u1').firestore()
    await source(sourceId,{productType:'fish_meal'})
    const line={lineType:'fish_meal',fishMealQuality:'bucket',nameSnapshot:'桶装',totalWeightGrams:100_000,basketCount:1,totalWeightEntryCount:0,
      defaultUnitPriceCentsPerKg:115,unitPriceCentsPerKg:115,priceWasEdited:false,amountCents:11_500,sourceEntryIds:['saved-entry']}
    await assertSucceeds(save(id,sourceId,{productType:'fish_meal',lines:[line],totalAmountCents:11_500}))
    await assertSucceeds(save(id,sourceId,{receiptNo:'meal-updated'}))
    expect((await getDoc(doc(db,'purchaseSettlementDrafts',id))).data()).toMatchObject({productType:'fish_meal',revision:2,lines:[line]})
    expect((await getDoc(doc(db,'purchaseSettlementSources',id))).data()?.draftId).toBe(id)
  })
  it('allows two devices to concurrently allocate exactly one canonical authoritative draft',async()=>{
    const sourceId='p5-concurrent',id=`fish_head_session_${sourceId}`
    await source(sourceId)
    let arrivals=0
    let release:()=>void=()=>undefined
    const bothRead=new Promise<void>(resolve=>{release=resolve})
    const create=async(userId:string,synchronized=true)=>{
      const db=environment.authenticatedContext(userId).firestore(),ref=doc(db,'purchaseSettlementDrafts',id)
      let firstAttempt=true
      return runTransaction(db,async transaction=>{
        const guard=doc(db,'purchaseSettlementSources',id)
        const [current,sourceSnapshot,binding]=await Promise.all([
          transaction.get(ref),transaction.get(doc(db,'weighingSessions',sourceId)),transaction.get(guard)])
        expect(sourceSnapshot.exists()).toBe(true)
        if(firstAttempt&&synchronized) { firstAttempt=false; arrivals+=1; if(arrivals===2)release(); await bothRead }
        if(current.exists()) { expect(binding.data()?.draftId).toBe(id); return id }
        const value=draft(sourceId,{createdBy:userId,updatedBy:userId})
        transaction.set(ref,value)
        transaction.set(guard,{productType:'fish_head',sourceSessionId:sourceId,draftId:id,createdBy:userId,createdAt:serverTimestamp()})
        transaction.set(doc(ref,'actions','1'),{beforeSnapshot:null,afterSnapshot:value,performedBy:userId,performedAt:serverTimestamp()})
        return id
      })
    }
    const outcomes=await Promise.allSettled([create('u1'),create('u2')])
    expect(outcomes.filter(value=>value.status==='fulfilled').length).toBeGreaterThanOrEqual(1)
    for(const outcome of outcomes) {
      if(outcome.status==='fulfilled')expect(outcome.value).toBe(id)
      // The emulator can reject the stale create against the winner's immutable
      // guard before the SDK sees an ABORTED conflict. Reload must use that winner.
      else expect(['permission-denied','aborted']).toContain(outcome.reason.code)
    }
    const db=environment.authenticatedContext('u1').firestore()
    const found=await getDocs(query(collection(db,'purchaseSettlementDrafts'),where('sourceSessionId','==',sourceId)))
    expect(found.docs.map(item=>item.id)).toEqual([id])
    expect(found.docs[0].data().revision).toBe(1)
    expect(found.docs[0].data().lines[0]).toMatchObject({unitPriceCentsPerKg:290,priceWasEdited:true,amountCents:29_000})
    expect((await getDoc(doc(db,'purchaseSettlementSources',id))).data()?.draftId).toBe(id)
    expect(await Promise.all([create('u1',false),create('u2',false)])).toEqual([id,id])
    expect((await getDocs(collection(db,'purchaseSettlementDrafts',id,'actions'))).size).toBe(1)
  },20_000)
})

describe('Firestore Rules: retail cash sales', () => {
  const line = makeRetailLine(retailSeed[0], '2', '6.15')
  function sale(lines = [line]) {
    return { ...prepareRetailSale({ businessDate: '06/09/2026', vendorName: '阿明', lines }), createdBy: 'u1', updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
  }
  async function writeSale(ref: DocumentReference, input: Omit<ReturnType<typeof sale>, 'createdAt'> & { createdAt: unknown }) {
    const vessel = await retailVesselFixture(ref)
    const { lines, ...header } = input
    const lineGroups = { first: lines.slice(0, 5), second: lines.slice(5, 10), third: lines.slice(10, 15), fourth: lines.slice(15) }
    for (const [key, items] of Object.entries(lineGroups)) await setDoc(doc(ref, 'groups', key), { lines: items, totalAmountCents: items.reduce<number>((sum, item) => sum + item.amountCents, 0), createdBy: 'u1', createdAt: serverTimestamp() })
    const counterRef = doc(ref.firestore, 'retailInvoiceCounters', String(header.dateSortKey))
    const sequence = ((await getDoc(counterRef)).data()?.lastSequence ?? 0) + 1
    const after = { ...vessel, ...header, lineGroups, remark: '', invoiceNumber: header.businessDate.replaceAll('/', '') + String(sequence).padStart(3, '0'), invoiceSequence: sequence, revision: 1, groupSetId: 'initial', lastActionId: ref.id }
    const batch = writeBatch(ref.firestore)
    batch.set(ref, after)
    batch.set(counterRef, { dateSortKey: header.dateSortKey, lastSequence: sequence, lastSaleId: ref.id, updatedBy: 'u1', updatedAt: serverTimestamp() })
    batch.set(doc(ref, 'actions', ref.id), { type: 'create', saleId: ref.id, clientOperationId: ref.id, revision: 1, beforeSnapshot: null, afterSnapshot: after, performedBy: 'u1', performedAt: serverTimestamp() })
    return batch.commit()
  }
  it('allows initial fish, subsequent edits and no suggested price, without rewriting sale snapshots', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    for (const { id, ...fish } of retailSeed) await assertSucceeds(setDoc(doc(db, 'retailFish', id), { ...fish, createdBy: 'u1', updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
    const fishRef = doc(db, 'retailFish', retailSeed[0].id), saleRef = doc(db, 'retailSales', 'retail-snapshot')
    await assertSucceeds(writeSale(saleRef, sale()))
    await assertSucceeds(updateDoc(fishRef, { chineseName: '新鱼名', malayName: '', suggestedPriceCents: null, active: false, updatedBy: 'u1', updatedAt: serverTimestamp() }))
    expect((await getDoc(saleRef)).data()?.lineGroups.first[0]).toMatchObject({ chineseName: '甘丰', malayName: 'kembung', unitPriceCents: 615, amountCents: 1230 })
    await assertFails(deleteDoc(fishRef))
    await assertFails(updateDoc(fishRef, { createdBy: 'other', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(fishRef, { suggestedPriceCents: -1, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(fishRef, { suggestedPriceCents: 6.15, updatedAt: serverTimestamp() }))
  })
  it('reads legacy masters and validates aliases/order on audited upgrades without permitting deletes', async () => {
    const db = environment.authenticatedContext('u1').firestore(), ref = doc(db, 'retailFish', 'master-p9')
    await assertSucceeds(setDoc(ref, { chineseName: '金线', malayName: '', suggestedPriceCents: null, active: true, createdBy: 'u1', updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
    await assertSucceeds(getDoc(ref))
    await assertSucceeds(updateDoc(ref, { aliases: ['金仙'], sortOrder: 8, updatedBy: 'u1', updatedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(ref, { active: false, updatedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(ref, { active: true, updatedAt: serverTimestamp() }))
    for (const aliases of [null, 'alias', [1], [''], ['x'.repeat(101)], ['金线'], ['黑昌'], ['a', 'a'], ['a', 'b', 'c', 'd', 'e', 'f']]) {
      await assertFails(updateDoc(ref, { aliases, updatedAt: serverTimestamp() }))
    }
    for (const sortOrder of [null, '1', -1, 0.5, 1000001]) await assertFails(updateDoc(ref, { sortOrder, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(ref, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(ref, { updatedBy: 'other', updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(ref))
  })
  it('creates a complete P9 master but rejects forbidden official names and malformed final alias slot', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const fish = { chineseName: '乌昌', malayName: '', suggestedPriceCents: null, aliases: ['a', 'b', 'c', 'd', 'e'], sortOrder: 0, active: true, createdBy: 'u1', updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
    await assertSucceeds(setDoc(doc(db, 'retailFish', 'p9-create'), fish))
    await assertFails(setDoc(doc(db, 'retailFish', 'p9-black'), { ...fish, chineseName: '黑昌' }))
    await assertFails(setDoc(doc(db, 'retailFish', 'p9-last-alias'), { ...fish, aliases: ['a', 'b', 'c', 'd', 1] }))
  })
  it('rejects anonymous reads/writes and all mutations of saved sales', async () => {
    const db = environment.authenticatedContext('u1').firestore(), ref = doc(db, 'retailSales', 'retail-immutable')
    await assertSucceeds(writeSale(ref, sale()))
    await assertFails(updateDoc(ref, { vendorName: 'changed', updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(ref))
    await assertFails(updateDoc(doc(ref, 'groups', 'first'), { totalAmountCents: 1 }))
    await assertFails(deleteDoc(doc(ref, 'groups', 'first')))
    const anonymous = environment.unauthenticatedContext().firestore()
    for (const collection of ['retailFish', 'retailSales']) {
      await assertFails(getDoc(doc(anonymous, collection, 'any')))
      await assertFails(setDoc(doc(anonymous, collection, 'any'), sale()))
    }
  })
  it('checks every line up to the maximum and verifies the total', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const max = sale(Array.from({ length: MAX_RETAIL_LINES }, (_, index) => ({ ...line, chineseName: `鱼${index}` })))
    await assertSucceeds(writeSale(doc(db, 'retailSales', 'retail-max'), max))
    const lastTampered = max.lines.map((item, index) => index === MAX_RETAIL_LINES - 1 ? { ...item, amountCents: 1 } : item)
    await assertFails(writeSale(doc(db, 'retailSales', 'retail-last-tampered'), { ...max, lines: lastTampered }))
    await assertFails(writeSale(doc(db, 'retailSales', 'retail-total-tampered'), { ...max, totalAmountCents: 1 }))
    await assertFails(writeSale(doc(db, 'retailSales', 'retail-over-limit'), { ...max, lines: [...max.lines, line], totalAmountCents: max.totalAmountCents + line.amountCents }))
  })
  it('accepts tenths of a kg and independently enforces rounding to integer cents', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const cases = [['12.5', '6', 7500], ['7.3', '8', 5840], ['0.1', '0.05', 1], ['0.1', '0.04', 0], ['300', '10000', 300000000]] as const
    for (const [index, [kg, price, expected]] of cases.entries()) {
      const decimalLine = makeRetailLine(retailSeed[0], kg, price)
      expect(decimalLine.amountCents).toBe(expected)
      const ref = doc(db, 'retailSales', `retail-decimal-${index}`)
      await assertSucceeds(writeSale(ref, sale([decimalLine])))
      expect((await getDoc(ref)).data()?.totalAmountCents).toBe(expected)
      await assertFails(writeSale(doc(db, 'retailSales', `retail-rounding-tampered-${index}`), {
        ...sale([decimalLine]), lines: [{ ...decimalLine, amountCents: expected + 1 }], totalAmountCents: expected + 1,
      }))
    }
    await assertFails(setDoc(doc(db, 'retailSales', 'retail-legacy-write', 'groups', 'first'), {
      lines: [{ fishId: line.fishId, chineseName: line.chineseName, malayName: line.malayName, weightKg: 2, unitPriceCents: 615, amountCents: 1230 }],
      totalAmountCents: 1230, createdBy: 'u1', createdAt: serverTimestamp(),
    }))
  })
  it('can finalize pre-upgrade immutable integer groups without rewriting them', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const ref = doc(db, 'retailSales', 'retail-legacy-pending')
    const legacyLine = { fishId: line.fishId, chineseName: line.chineseName, malayName: line.malayName, weightKg: 2, unitPriceCents: 615, amountCents: 1230 }
    await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'retailSales', ref.id, 'groups', 'first'), {
      lines: [legacyLine], totalAmountCents: 1230, createdBy: 'u1', createdAt: serverTimestamp(),
    }))
    for (const key of ['second', 'third', 'fourth']) await assertSucceeds(setDoc(doc(ref, 'groups', key), { lines: [], totalAmountCents: 0, createdBy: 'u1', createdAt: serverTimestamp() }))
    const header = { businessDate: '06/09/2026', dateSortKey: 20260906, vendorName: '阿明', totalAmountCents: 1230,
      createdBy: 'u1', updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      lineGroups: { first: [legacyLine], second: [], third: [], fourth: [] } }
    async function finalize(uid: string, lines: Record<string, RetailLineInput[]> = header.lineGroups) {
      const client = environment.authenticatedContext(uid).firestore(), batch = writeBatch(client)
      const vessel = await retailVesselFixture(doc(client, 'retailSales', ref.id), uid)
      const counter = doc(client, 'retailInvoiceCounters', '20260906'), sequence = ((await getDoc(counter)).data()?.lastSequence ?? 0) + 1
      const after = { ...header, ...vessel, createdBy: uid, updatedBy: uid, lineGroups: lines, remark: '', invoiceNumber: retailInvoiceNumber(header.businessDate, sequence), invoiceSequence: sequence, revision: 1, groupSetId: 'initial', lastActionId: ref.id }
      batch.set(doc(client, 'retailSales', ref.id), after)
      batch.set(counter, { dateSortKey: 20260906, lastSequence: sequence, lastSaleId: ref.id, updatedBy: uid, updatedAt: serverTimestamp() })
      batch.set(doc(client, 'retailSales', ref.id, 'actions', ref.id), { type: 'create', saleId: ref.id, clientOperationId: ref.id, revision: 1, beforeSnapshot: null, afterSnapshot: after, performedBy: uid, performedAt: serverTimestamp() })
      return batch.commit()
    }
    await assertFails(finalize('other'))
    await assertFails(finalize('u1', { ...header.lineGroups, first: [line] }))
    await assertSucceeds(finalize('u1'))
    expect((await getDoc(doc(ref, 'groups', 'first'))).data()?.lines).toEqual([legacyLine])
  })
  it('rejects invalid dates, kg, prices, empty sales and forged audit fields', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const invalid = [
      { businessDate: '29/02/2026', dateSortKey: 20260229 }, { dateSortKey: 20260907 }, { vendorName: '' }, { lines: [], totalAmountCents: 0 },
      ...[0, -1, 3001, 22.5].map(weightDeciKg => ({ lines: [{ ...line, weightDeciKg, amountCents: Math.floor((weightDeciKg * line.unitPriceCents + 5) / 10) }], totalAmountCents: Math.floor((weightDeciKg * line.unitPriceCents + 5) / 10) })),
      ...[0, -1, 1.5, 1000001].map(unitPriceCents => ({ lines: [{ ...line, unitPriceCents, amountCents: Math.floor((line.weightDeciKg * unitPriceCents + 5) / 10) }], totalAmountCents: Math.floor((line.weightDeciKg * unitPriceCents + 5) / 10) })),
      { lines: [{ ...line, weightKg: 2 }] },
      { createdBy: 'other' }, { updatedBy: 'other' }, { createdAt: new Date('2020-01-01') }, { inventoryDeducted: true },
    ]
    for (let index = 0; index < invalid.length; index++) await assertFails(writeSale(doc(db, 'retailSales', `retail-invalid-${index}`), { ...sale(), ...invalid[index] }))
    await assertFails(setDoc(doc(db, 'retailSales', 'retail-missing-groups'), { ...sale(), lineGroups: { first: [line], second: [] } }))
  })
})

describe('Firestore Rules: vessels and ice-work audit', () => {
  it.each([
    {type:'session_update',status:'completed',patch:{externalSlipNo:'FH-REVISION'}},
    {type:'reopen',status:'completed',patch:{status:'weighing'}},
    {type:'complete',status:'weighing',patch:{status:'completed'}},
    {type:'session_void',status:'completed',patch:{status:'voided',voidReason:'修正记录',voidedBy:'u1',voidedAt:serverTimestamp()}},
  ])('requires an atomic source revision increment for $type',async({type,status,patch})=>{
    const vesselId=`revision-vessel-${type}`
    await environment.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'vessels',vesselId),vessel))
    const ref=await seedWeighing(`revision-${type}`,weighingRecord(6,{status,vesselId}))
    await assertFails(changeWeighing(ref,type,patch,0))
    await assertFails(changeWeighing(ref,type,patch,2))
    expect((await getDoc(ref)).data()).toMatchObject({revision:2,status,externalSlipNo:''})
    await assertSucceeds(changeWeighing(ref,type,patch))
    expect((await getDoc(ref)).data()).toMatchObject({revision:3,status:type==='reopen'?'weighing':type==='session_void'?'voided':'completed',
      externalSlipNo:type==='session_update'?'FH-REVISION':''})
  })

  it('allows reopening a completed weighing session only during its seven-day edit window',async()=>{
    const within=await seedWeighing('within-window',weighingRecord(6)),expired=await seedWeighing('expired-window',weighingRecord(8))
    await assertFails(changeWeighing(within,'reopen',{status:'weighing',completedAt:null,completedBy:null}))
    await assertFails(changeWeighing(within,'reopen',{status:'weighing',completedAt:serverTimestamp()}))
    await assertSucceeds(changeWeighing(within,'reopen',{status:'weighing'}))
    await assertFails(changeWeighing(expired,'reopen',{status:'weighing'}))
    await assertSucceeds(getDoc(expired))
  })

  it('preserves the first completion on re-completion, including sessions left open past the deadline',async()=>{
    const source=weighingRecord(8,{status:'weighing'}),ref=await seedWeighing('recomplete',source)
    await assertFails(changeWeighing(ref,'complete',{status:'completed',completedAt:serverTimestamp()}))
    await assertSucceeds(changeWeighing(ref,'complete',{status:'completed'}))
    expect((await getDoc(ref)).data()?.completedAt).toEqual(source.completedAt)
    await assertFails(changeWeighing(ref,'reopen',{status:'weighing'}))
    const initial=await seedWeighing('first-completion',weighingRecord(0,{status:'weighing',completedBy:null,completedAt:null}))
    await assertSucceeds(changeWeighing(initial,'complete',{status:'completed',completedBy:'u1',completedAt:serverTimestamp()}))
  })

  it('allows audited basket create/update/void within the original window and rejects delayed offline writes',async()=>{
    for(const daysAgo of [6,8]) {
      const ref=await seedWeighing(`basket-window-${daysAgo}`,weighingRecord(daysAgo,{status:'weighing'}))
      const entryRef=doc(ref,'entries','basket')
      const initial={clientEntryId:'basket',sessionId:ref.id,productType:'fish_head',fishSpeciesId:'custom_test',fishSpeciesCodeSnapshot:'custom_test',fishSpeciesNameSnapshot:'测试鱼',
        fishMealQuality:null,displayNameSnapshot:'测试鱼',entryMode:'individual',sequenceNo:2,weightGrams:500,remark:'',recordedAtClient:'2026-09-13T10:00:00Z',
        recordedAt:serverTimestamp(),recordedBy:'u1',voided:false,voidReason:null,voidedBy:null,voidedAt:null,revision:1,updatedBy:'u1',updatedAt:serverTimestamp(),lastActionId:'basket-create'}
      const write=async(type:string,patch:DocumentData,delta:number,countDelta=0,parentPatch:DocumentData={})=>{
        const parent=(await getDoc(ref)).data()!,old=(await getDoc(entryRef)).data()??null,actionId=`${type}-${parent.revision+1}`
        const next={...(old??initial),...patch,revision:old?old.revision+1:1,updatedAt:serverTimestamp(),lastActionId:actionId}
        const batch=writeBatch(ref.firestore)
        batch.set(entryRef,next)
        batch.update(ref,{revision:parent.revision+1,lastSequenceNo:2,fishHeadBasketCount:parent.fishHeadBasketCount+countDelta,
          fishHeadWeightGrams:parent.fishHeadWeightGrams+delta,totalWeightGrams:parent.totalWeightGrams+delta,updatedBy:'u1',updatedAt:serverTimestamp(),lastActionId:actionId,...parentPatch})
        batch.set(doc(ref,'actions',actionId),{type,sessionId:ref.id,entryId:entryRef.id,reason:'修正记录',performedBy:'u1',performedAt:serverTimestamp(),
          beforeSnapshot:old,afterSnapshot:next,clientOperationId:actionId})
        return batch.commit()
      }
      if(daysAgo===6) {
        await assertFails(write('entry_create',{weightGrams:-500},-500,1))
        await assertFails(write('entry_create',{},500,1,{totalWeightGrams:1}))
        await assertFails(write('entry_create',{},500,1,{completedAt:null,completedBy:null}))
        await assertFails(write('entry_create',{},500,1,{revision:2}))
        expect((await getDoc(entryRef)).exists()).toBe(false)
        expect((await getDoc(ref)).data()?.revision).toBe(2)
        await expect(write('entry_create',{},500,1)).resolves.toBeUndefined()
        expect((await getDoc(ref)).data()).toMatchObject({revision:3,totalWeightGrams:1500})
        await assertFails(write('entry_create',{},500,1))
        await assertFails(write('entry_update',{weightGrams:700},200,0,{completedAt:serverTimestamp()}))
        await assertFails(write('entry_update',{weightGrams:700},200,0,{vesselId:'v833'}))
        await assertFails(write('entry_update',{weightGrams:700},200,0,{revision:3}))
        expect((await getDoc(entryRef)).data()).toMatchObject({weightGrams:500,revision:1})
        await expect(write('entry_update',{weightGrams:700},200)).resolves.toBeUndefined()
        expect((await getDoc(ref)).data()).toMatchObject({revision:4,totalWeightGrams:1700})
        const speciesPatch={fishSpeciesId:'custom_other',fishSpeciesCodeSnapshot:'custom_other',fishSpeciesNameSnapshot:'其他鱼',displayNameSnapshot:'其他鱼'}
        await assertFails(write('entry_update',speciesPatch,0,0,{revision:4}))
        await expect(write('entry_update',speciesPatch,0)).resolves.toBeUndefined()
        expect((await getDoc(entryRef)).data()).toMatchObject({...speciesPatch,revision:3})
        expect((await getDoc(ref)).data()).toMatchObject({revision:5,totalWeightGrams:1700})
        await assertFails(write('entry_void',{voided:true,voidReason:'修正记录',voidedBy:'u1',voidedAt:serverTimestamp()},-700,-1,{revision:5}))
        expect((await getDoc(entryRef)).data()?.voided).toBe(false)
        await expect(write('entry_void',{voided:true,voidReason:'修正记录',voidedBy:'u1',voidedAt:serverTimestamp()},-700,-1)).resolves.toBeUndefined()
        expect((await getDoc(ref)).data()).toMatchObject({revision:6,totalWeightGrams:1000})
        expect((await getDoc(ref)).data()?.completedAt).toEqual((await getDoc(ref)).data()?.createdAt)
      } else {
        await assertFails(write('entry_create',{},500,1))
        await environment.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'weighingSessions',ref.id,'entries',entryRef.id),initial))
        await assertFails(write('entry_update',{weightGrams:700},200))
        await assertFails(write('entry_update',{weightGrams:700},200,0,{completedAt:serverTimestamp()}))
        await assertFails(write('entry_void',{voided:true,voidReason:'修正记录',voidedBy:'u1',voidedAt:serverTimestamp()},-500,-1))
      }
    }
  })

  it('still accepts a new weighing session and its first audited basket atomically',async()=>{
    const db=environment.authenticatedContext('u1').firestore(),ref=doc(db,'weighingSessions','new-weighing'),actionId='first-basket'
    await environment.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'vessels','initial-v978'),vessel))
    const first={clientEntryId:'first',sessionId:ref.id,productType:'fish_head',fishSpeciesId:'custom_test',fishSpeciesCodeSnapshot:'custom_test',fishSpeciesNameSnapshot:'测试鱼',
      fishMealQuality:null,displayNameSnapshot:'测试鱼',entryMode:'individual',sequenceNo:1,weightGrams:1000,remark:'',recordedAtClient:'2026-09-13T10:00:00Z',
      recordedAt:serverTimestamp(),recordedBy:'u1',voided:false,voidReason:null,voidedBy:null,voidedAt:null,revision:1,updatedBy:'u1',updatedAt:serverTimestamp(),lastActionId:actionId}
    const initial=weighingRecord(0,{status:'weighing',completedAt:null,completedBy:null,vesselId:'initial-v978',createdAt:serverTimestamp(),updatedAt:serverTimestamp(),lastActionId:actionId})
    const batch=writeBatch(db)
    batch.set(ref,initial);batch.set(doc(ref,'entries','first'),first)
    batch.set(doc(ref,'actions',actionId),{type:'entry_create',sessionId:ref.id,entryId:'first',reason:null,performedBy:'u1',performedAt:serverTimestamp(),beforeSnapshot:null,afterSnapshot:first,clientOperationId:actionId})
    await assertSucceeds(batch.commit())
  })

  it('enforces the deadline for audited metadata and void actions on both completed and reopened sessions',async()=>{
    await environment.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'vessels','window-v978'),vessel))
    for(const status of ['completed','weighing']) {
      const valid=await seedWeighing(`metadata-${status}`,weighingRecord(6,{status,vesselId:'window-v978'})),expired=await seedWeighing(`metadata-expired-${status}`,weighingRecord(8,{status,vesselId:'window-v978'}))
      for(const patch of [{sessionCode:''},{totalWeightGrams:1},{completedAt:serverTimestamp()},{dateSortKey:20260914},{vesselCodeSnapshot:'833'}]) {
        await assertFails(changeWeighing(valid,'session_update',patch))
      }
      await assertSucceeds(changeWeighing(valid,'session_update',{externalSlipNo:'FH-001',notes:'修正说明'}))
      await assertFails(changeWeighing(expired,'session_update',{externalSlipNo:'FH-001'}))
      await assertFails(changeWeighing(expired,'session_update',{externalSlipNo:'FH-001',completedAt:serverTimestamp()}))
      const voidPatch={status:'voided',voidReason:'修正记录',voidedBy:'u1',voidedAt:serverTimestamp()}
      await assertFails(changeWeighing(expired,'session_void',voidPatch))
      await assertSucceeds(changeWeighing(valid,'session_void',voidPatch))
    }
  })

  it('allows authenticated vessel creation but rejects vessel-code tampering and deletion', async () => {
    const db = environment.authenticatedContext('u1').firestore(), ref = doc(db, 'vessels', 'v978')
    await assertSucceeds(setDoc(ref, vessel))
    await assertFails(updateDoc(ref, { vesselCode: '833', updatedBy: 'u1', updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(ref))
  })

  it('rejects unauthenticated reads', async () => { await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'vessels', 'v978'))) })

  it('allows explicit worker departments and rejects unknown worker department values', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const worker = { name: '切鱼头工人', active: true, order: 0, workerCode: 'WK-00000001', phone: '', department: 'fish_head', workerDepartment: 'fish_head_cutting', employmentStartDate: '', employmentEndDate: '', notes: '', createdBy: 'u1', createdAt: serverTimestamp(), updatedBy: 'u1', updatedAt: serverTimestamp(), inactiveBy: null, inactiveAt: null }
    await assertSucceeds(setDoc(doc(db, 'workers', 'cutting-worker'), worker))
    await assertFails(setDoc(doc(db, 'workers', 'invalid-worker'), { ...worker, workerDepartment: 'vessel' }))
  })

  it('requires the complete wage business-date fields for new wage records', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const wage = { dateKey: '2026-07-31', businessDate: '31/07/2026', dateSortKey: 20260731, monthKey: '07/2026', monthSortKey: 202607, workerId: 'cutting-worker', workerName: '切鱼头工人', weightKg: 80, rateRm: '0.12', wageRm: '9.60', createdBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), deleted: false }
    await assertSucceeds(setDoc(doc(db, 'fishHeadWageEntries', 'dated-wage'), wage))
    const missingBusinessDate = Object.fromEntries(Object.entries(wage).filter(([key]) => key !== 'businessDate'))
    await assertFails(setDoc(doc(db, 'fishHeadWageEntries', 'missing-date-wage'), missingBusinessDate))
    await assertFails(setDoc(doc(db, 'fishHeadWageEntries', 'wrong-sort-wage'), { ...wage, dateSortKey: 20260801 }))
    await assertFails(setDoc(doc(db, 'fishHeadWageEntries', 'impossible-date-wage'), { ...wage, dateKey: '2026-02-29', businessDate: '29/02/2026', dateSortKey: 20260229, monthKey: '02/2026', monthSortKey: 202602 }))
    const legacyWage = { dateKey: '2026-07-30', workerId: 'cutting-worker', workerName: '旧工人', weightKg: 80, rateRm: '0.12', wageRm: '9.60', createdBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), deleted: false }
    const legacyRef = doc(db, 'fishHeadWageEntries', 'legacy-wage')
    await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'fishHeadWageEntries', 'legacy-wage'), legacyWage))
    await assertSucceeds(updateDoc(legacyRef, { deleted: true, updatedAt: serverTimestamp() }))
  })

  it('allows repeatable settlement drafts but rejects deletion and confirmation status', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const draftRef = doc(db, 'purchaseSettlementDrafts', 'fish_head_session_settlement-source')
    const line = { lineType: 'fish_head', nameSnapshot: '金线', totalWeightGrams: 160500, basketCount: 1, totalWeightEntryCount: 1,
      defaultUnitPriceCentsPerKg: 210, unitPriceCentsPerKg: 210, priceWasEdited: false, amountCents: 33705, sourceEntryIds: ['entry-1'],
      fishSpeciesId: 'jin_xian', fishSpeciesCodeSnapshot: 'jin_xian', fishSpeciesNameSnapshot: '金线' }
    await seedWeighing('settlement-source',weighingRecord(1,{weighingDate:'03/08/2026',monthKey:'08/2026',dateSortKey:20260803,monthSortKey:202608}))
    const draft = { productType: 'fish_head', businessDate: '03/08/2026', dateSortKey: 20260803, monthKey: '08/2026', monthSortKey: 202608,
      vesselId: 'v978', vesselCodeSnapshot: '978', receiptNo: '', status: 'settlement_draft', lines: [line], totalAmountCents: 33705,
      sourceEntryIds: ['entry-1'],sourceSessionId:'settlement-source',sourceSessionRevision:2, createdAt: serverTimestamp(), createdBy: 'u1', updatedAt: serverTimestamp(), updatedBy: 'u1', revision: 1, voided: false }
    const write=async(patch:DocumentData={},audit=true)=>{
      const existing=await getDoc(draftRef),before=existing.exists()?existing.data()!:null
      const next={...(before??draft),receiptNo:'FH-001',...patch,revision:before?before.revision+1:1,updatedAt:serverTimestamp()}
      const batch=writeBatch(db)
      batch.set(draftRef,next)
      const guardRef=doc(db,'purchaseSettlementSources','fish_head_session_settlement-source')
      if(!(await getDoc(guardRef)).exists())batch.set(guardRef,{productType:'fish_head',sourceSessionId:'settlement-source',draftId:draftRef.id,createdBy:'u1',createdAt:serverTimestamp()})
      if(audit)batch.set(doc(draftRef,'actions',String(next.revision)),{beforeSnapshot:before,afterSnapshot:next,performedBy:'u1',performedAt:serverTimestamp()})
      return batch.commit()
    }
    await assertFails(write({},false))
    await assertFails(write({sourceSessionRevision:1}))
    await assertFails(write({status:'settlement_confirmed'}))
    await assertFails(write({voided:true}))
    await assertFails(write({vesselId:'v833'}))
    await assertSucceeds(write())
    await assertSucceeds(write({receiptNo:'FH-002'}))
    expect((await getDoc(doc(draftRef,'actions','2'))).data()?.beforeSnapshot.receiptNo).toBe('FH-001')
    await assertFails(write({vesselId:'v833'}))
    await assertFails(write({},false))
    await assertFails(updateDoc(doc(draftRef,'actions','1'),{performedBy:'other'}))
    await assertFails(deleteDoc(doc(draftRef,'actions','1')))
    await assertFails(deleteDoc(draftRef))
    await seedWeighing('settlement-source',weighingRecord(8,{weighingDate:'03/08/2026'}))
    await assertFails(write())
    await assertSucceeds(getDoc(draftRef))
    await seedWeighing('settlement-source',weighingRecord(8,{status:'weighing',weighingDate:'03/08/2026'}))
    await assertFails(write())
    for(const status of ['processed','voided']) {
      await seedWeighing('settlement-source',weighingRecord(1,{status,weighingDate:'03/08/2026'}))
      await assertFails(write())
    }
  })

  it('allows an atomic draft record and immutable create action, but rejects action changes', async () => {
    const db = environment.authenticatedContext('u1').firestore(), record = createIceWorkRecord({ id: 'ice-1', workDate: '31/07/2026', vesselId: 'v978', vesselCodeSnapshot: '978', vesselNameSnapshot: '978', createdBy: 'u1', factoryIncomingWeightGrams: 1_000 })
    const recordRef = doc(db, 'iceWorkRecords', record.id), actionRef = doc(recordRef, 'actions', 'create-ice-1'), batch = writeBatch(db)
    batch.set(recordRef, { ...record, lastActionId: 'create-ice-1', updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    batch.set(actionRef, { type: 'create', recordId: record.id, reason: null, performedBy: 'u1', performedAt: serverTimestamp(), beforeSnapshot: null, afterSnapshot: { ...record, lastActionId: 'create-ice-1' }, revision: 1, clientOperationId: 'create-ice-1' })
    await assertSucceeds(batch.commit())
    await assertFails(updateDoc(actionRef, { reason: 'changed' }))
    await assertFails(deleteDoc(actionRef))

    const confirmActionRef = doc(recordRef, 'actions', 'confirm-ice-1'), confirmBatch = writeBatch(db)
    confirmBatch.update(recordRef, { status: 'confirmed', revision: 2, lastActionId: 'confirm-ice-1', confirmedBy: 'u1', confirmedAt: serverTimestamp(), updatedBy: 'u1', updatedAt: serverTimestamp() })
    confirmBatch.set(confirmActionRef, { type: 'confirm', recordId: record.id, reason: null, performedBy: 'u1', performedAt: serverTimestamp(), beforeSnapshot: { ...record, lastActionId: 'create-ice-1' }, afterSnapshot: { ...record, status: 'confirmed', revision: 2, lastActionId: 'confirm-ice-1' }, revision: 2, clientOperationId: 'confirm-ice-1' })
    await assertSucceeds(confirmBatch.commit())
  })

  it('rejects a record creation that is not paired with its audit action', async () => {
    const db = environment.authenticatedContext('u1').firestore(), record = createIceWorkRecord({ id: 'ice-without-action', workDate: '31/07/2026', vesselId: 'v978', vesselCodeSnapshot: '978', vesselNameSnapshot: '978', createdBy: 'u1' })
    await assertFails(setDoc(doc(db, 'iceWorkRecords', record.id), { ...record, lastActionId: 'missing-action', updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  })

  it('rejects an ice-work record whose month key disagrees with its work date', async () => {
    const db = environment.authenticatedContext('u1').firestore(), record = { ...createIceWorkRecord({ id: 'ice-wrong-month', workDate: '31/07/2026', vesselId: 'v978', vesselCodeSnapshot: '978', vesselNameSnapshot: '978', createdBy: 'u1' }), monthKey: '06/2026', monthSortKey: 202606, lastActionId: 'create-wrong-month', updatedBy: 'u1' }
    const recordRef = doc(db, 'iceWorkRecords', record.id), actionRef = doc(recordRef, 'actions', record.lastActionId), batch = writeBatch(db)
    batch.set(recordRef, { ...record, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    batch.set(actionRef, { type: 'create', recordId: record.id, reason: null, performedBy: 'u1', performedAt: serverTimestamp(), beforeSnapshot: null, afterSnapshot: record, revision: 1, clientOperationId: record.lastActionId })
    await assertFails(batch.commit())
  })

  it('rejects direct tampering with a confirmed ice-work amount', async () => {
    const db = environment.authenticatedContext('u1').firestore(), record = createIceWorkRecord({ id: 'ice-confirmed', workDate: '31/07/2026', vesselId: 'v978', vesselCodeSnapshot: '978', vesselNameSnapshot: '978', createdBy: 'u1', factoryIncomingWeightGrams: 1_000 }), ref = doc(db, 'iceWorkRecords', record.id)
    await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'iceWorkRecords', record.id), { ...record, status: 'confirmed', revision: 2, lastActionId: 'legacy-confirmed', updatedBy: 'u1', confirmedBy: 'u1', confirmedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(ref, { recordTotalCents: 999, revision: 3, updatedBy: 'u1', updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(ref))
  })

  it('rejects changing financial values while confirming an ice-work record', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const original = createIceWorkRecord({ id: 'ice-confirm-tamper', workDate: '31/07/2026', vesselId: 'v978', vesselCodeSnapshot: '978', vesselNameSnapshot: '978', createdBy: 'u1', factoryIncomingWeightGrams: 1_000 })
    const changed = createIceWorkRecord({ ...original, id: original.id, factoryIncomingWeightGrams: 2_000 })
    const recordRef = doc(db, 'iceWorkRecords', original.id), actionRef = doc(recordRef, 'actions', 'confirm-tamper')
    await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'iceWorkRecords', original.id), { ...original, lastActionId: 'create-tamper', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
    const batch = writeBatch(db)
    batch.update(recordRef, { ...changed, status: 'confirmed', revision: 2, lastActionId: 'confirm-tamper', confirmedBy: 'u1', confirmedAt: serverTimestamp(), updatedBy: 'u1', updatedAt: serverTimestamp() })
    batch.set(actionRef, { type: 'confirm', recordId: original.id, reason: null, performedBy: 'u1', performedAt: serverTimestamp(), beforeSnapshot: { ...original, lastActionId: 'create-tamper' }, afterSnapshot: { ...changed, status: 'confirmed', revision: 2, lastActionId: 'confirm-tamper' }, revision: 2, clientOperationId: 'confirm-tamper' })
    await assertFails(batch.commit())
  })

  it('rejects every client write to monthly settlements and their actions', async () => {
    const db = environment.authenticatedContext('u1').firestore(), settlement = createIceWorkSettlement({ vesselId: 'v978', vesselCodeSnapshot: '978', monthKey: '07/2026', createdBy: 'u1', records: [] })
    const settlementRef = doc(db, 'iceWorkMonthlySettlements', settlement.id), actionRef = doc(settlementRef, 'actions', 'settlement-create-1'), batch = writeBatch(db)
    const storedSettlement = Object.fromEntries(Object.entries(settlement).filter(([key]) => key !== 'id'))
    batch.set(settlementRef, { ...storedSettlement, lastActionId: 'settlement-create-1', updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    batch.set(actionRef, { type: 'create', settlementId: settlement.id, reason: null, performedBy: 'u1', performedAt: serverTimestamp(), beforeSnapshot: null, afterSnapshot: { ...settlement, lastActionId: 'settlement-create-1' }, revision: 1, clientOperationId: 'settlement-create-1' })
    await assertFails(batch.commit())
    await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'iceWorkMonthlySettlements', settlement.id), { ...storedSettlement, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(settlementRef, { revision: 2 }))
    await assertFails(setDoc(actionRef, { type: 'rebuild', settlementId: settlement.id, clientOperationId: 'settlement-create-1', performedBy: 'u1' }))
    await assertFails(updateDoc(actionRef, { reason: 'changed' }))
    await assertFails(deleteDoc(actionRef))
    await assertFails(deleteDoc(settlementRef))
  })

  it('rejects a monthly settlement creation that is not paired with its audit action', async () => {
    const db = environment.authenticatedContext('u1').firestore(), settlement = createIceWorkSettlement({ vesselId: 'v978', vesselCodeSnapshot: '978', monthKey: '06/2026', createdBy: 'u1', records: [] })
    await assertFails(setDoc(doc(db, 'iceWorkMonthlySettlements', settlement.id), { ...settlement, lastActionId: 'missing-action', updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  })

  it('rejects an audited monthly settlement whose financial totals are inconsistent', async () => {
    const db = environment.authenticatedContext('u1').firestore(), settlement = { ...createIceWorkSettlement({ vesselId: 'v978', vesselCodeSnapshot: '978', monthKey: '05/2026', createdBy: 'u1', records: [] }), finalTotalCents: 1, lastActionId: 'invalid-settlement-create' }
    const settlementRef = doc(db, 'iceWorkMonthlySettlements', settlement.id), actionRef = doc(settlementRef, 'actions', settlement.lastActionId), batch = writeBatch(db)
    batch.set(settlementRef, { ...settlement, updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    batch.set(actionRef, { type: 'create', settlementId: settlement.id, reason: null, performedBy: 'u1', performedAt: serverTimestamp(), beforeSnapshot: null, afterSnapshot: settlement, revision: 1, clientOperationId: settlement.lastActionId })
    await assertFails(batch.commit())
  })
})
