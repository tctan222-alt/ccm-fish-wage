import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch, type DocumentData, type DocumentReference } from 'firebase/firestore'
import { createIceWorkRecord, createIceWorkSettlement } from './lib/iceWork'
import { makeRetailLine, MAX_RETAIL_LINES, prepareRetailSale } from './lib/retailSales'
import retailSeed from './data/retailFishSeed.json'

let environment: RulesTestEnvironment
const vessel = { vesselCode: '978', displayName: '978', defaultSupplierId: '', defaultSupplierNameSnapshot: '', active: true, order: 0, notes: '', createdBy: 'u1', createdAt: serverTimestamp(), updatedBy: 'u1', updatedAt: serverTimestamp(), inactiveBy: null, inactiveAt: null }

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: 'demo-ccm-rules', firestore: { rules: await readFile('firestore.rules', 'utf8') } }) })
afterAll(async () => { if (environment) await environment.cleanup() })

describe('Firestore Rules: retail cash sales', () => {
  const line = makeRetailLine(retailSeed[0], '2', '6.15')
  function sale(lines = [line]) {
    return { ...prepareRetailSale({ businessDate: '06/09/2026', vendorName: '阿明', lines }), createdBy: 'u1', updatedBy: 'u1', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
  }
  async function finalizeSale(ref: DocumentReference, header: DocumentData, uid = 'u1') {
    const counterRef = doc(ref.firestore, 'retailInvoiceCounters', String(header.dateSortKey))
    return runTransaction(ref.firestore, async transaction => {
      await transaction.get(ref)
      await transaction.get(doc(ref, 'actions', ref.id))
      const counter = await transaction.get(counterRef)
      const invoiceSequence = (counter.data()?.lastSequence ?? 0) + 1
      const data = { remark: '', ...header, invoiceSequence, invoiceNumber: header.businessDate.replaceAll('/', '') + String(invoiceSequence).padStart(3, '0'), revision: 1, groupSetId: 'initial', lastActionId: ref.id }
      transaction.set(ref, data)
      transaction.set(counterRef, { dateSortKey: header.dateSortKey, lastSequence: invoiceSequence, lastSaleId: ref.id, updatedBy: uid, updatedAt: serverTimestamp() })
      transaction.set(doc(ref, 'actions', ref.id), { type: 'create', saleId: ref.id, clientOperationId: ref.id, performedBy: uid, performedAt: serverTimestamp(), revision: 1, beforeSnapshot: null, afterSnapshot: data })
    })
  }
  async function writeSale(ref: DocumentReference, input: Omit<ReturnType<typeof sale>, 'createdAt'> & { createdAt: unknown }) {
    const { lines, ...header } = input
    const lineGroups = { first: lines.slice(0, 5), second: lines.slice(5, 10), third: lines.slice(10, 15), fourth: lines.slice(15) }
    for (const [key, items] of Object.entries(lineGroups)) await setDoc(doc(ref, 'groups', key), { lines: items, totalAmountCents: items.reduce<number>((sum, item) => sum + item.amountCents, 0), createdBy: 'u1', createdAt: serverTimestamp() })
    return finalizeSale(ref, { ...header, lineGroups })
  }
  async function prepareEdit(ref: DocumentReference, operationId: string, changes: DocumentData = {}, uid = 'u1') {
    const old = (await getDoc(ref)).data()!
    const lineGroups = changes.lineGroups ?? old.lineGroups
    for (const [key, items] of Object.entries(lineGroups) as [string, typeof line[]][]) {
      await setDoc(doc(ref, 'groups', operationId + '_' + key), { lines: items, totalAmountCents: items.reduce<number>((sum, item) => sum + item.amountCents, 0), createdBy: uid, createdAt: serverTimestamp() })
    }
    const next = { ...old, remark: '', ...changes, lineGroups, revision: (old.revision ?? 1) + 1, groupSetId: operationId, lastActionId: operationId, updatedBy: uid, updatedAt: serverTimestamp() }
    const action = { type: 'update', saleId: ref.id, clientOperationId: operationId, performedBy: uid, performedAt: serverTimestamp(), revision: next.revision, beforeSnapshot: old, afterSnapshot: next }
    return { old, next, action, actionRef: doc(ref, 'actions', operationId) }
  }
  async function writeEdit(ref: DocumentReference, operationId: string, changes: DocumentData = {}) {
    const { next, action, actionRef } = await prepareEdit(ref, operationId, changes)
    const batch = writeBatch(ref.firestore)
    batch.set(ref, next)
    batch.set(actionRef, action)
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
  it('rejects anonymous reads/writes, unaudited updates and hard deletion', async () => {
    const db = environment.authenticatedContext('u1').firestore(), ref = doc(db, 'retailSales', 'retail-immutable')
    await assertSucceeds(writeSale(ref, sale()))
    await assertFails(updateDoc(ref, { vendorName: 'changed', updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(ref))
    await assertFails(updateDoc(doc(ref, 'groups', 'first'), { totalAmountCents: 1 }))
    await assertFails(deleteDoc(doc(ref, 'groups', 'first')))
    const anonymous = environment.unauthenticatedContext().firestore()
    for (const collection of ['retailFish', 'retailSales', 'retailInvoiceCounters']) {
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
    await assertFails(setDoc(doc(environment.authenticatedContext('other').firestore(), 'retailSales', ref.id), { ...header, createdBy: 'other', updatedBy: 'other' }))
    await assertFails(setDoc(ref, { ...header, lineGroups: { ...header.lineGroups, first: [line] } }))
    await assertSucceeds(finalizeSale(ref, header))
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
  it('allocates the first, second and next-day numbers with a transactional daily counter', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const cases = [['daily-first', '08/09/2026', 20260908, '08092026001'], ['daily-second', '08/09/2026', 20260908, '08092026002'], ['daily-next', '09/09/2026', 20260909, '09092026001']] as const
    for (const [id, businessDate, dateSortKey, invoiceNumber] of cases) {
      const ref = doc(db, 'retailSales', id)
      await assertSucceeds(writeSale(ref, { ...sale(), businessDate, dateSortKey }))
      expect((await getDoc(ref)).data()).toMatchObject({ invoiceNumber, revision: 1 })
      expect((await getDoc(doc(ref, 'actions', id))).data()).toMatchObject({ type: 'create', revision: 1, beforeSnapshot: null })
    }
  })
  it('keeps at least three sequence digits and continues past 999 without rollover', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'retailInvoiceCounters', '20260913'), {
      dateSortKey: 20260913, lastSequence: 998, lastSaleId: 'older-sale', updatedBy: 'u1', updatedAt: serverTimestamp(),
    }))
    for (const sequence of [999, 1000]) {
      const ref = doc(db, 'retailSales', 'sequence-' + sequence)
      await assertSucceeds(writeSale(ref, { ...sale(), businessDate: '13/09/2026', dateSortKey: 20260913 }))
      expect((await getDoc(ref)).data()?.invoiceNumber).toBe('13092026' + sequence)
    }
  })
  it('concurrent devices receive distinct invoice numbers and the counter cannot be advanced alone', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const refs = ['concurrent-a', 'concurrent-b'].map(id => doc(environment.authenticatedContext('u1').firestore(), 'retailSales', id))
    await assertSucceeds(Promise.all(refs.map(ref => writeSale(ref, { ...sale(), businessDate: '10/09/2026', dateSortKey: 20260910 }))))
    const numbers = await Promise.all(refs.map(async ref => (await getDoc(ref)).data()?.invoiceNumber))
    expect(numbers.sort()).toEqual(['10092026001', '10092026002'])
    const counter = doc(db, 'retailInvoiceCounters', '20260910')
    await assertFails(updateDoc(counter, { lastSequence: 3, updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(counter))
    await assertFails(setDoc(doc(db, 'retailInvoiceCounters', '20260911'), { dateSortKey: 20260911, lastSequence: 1, lastSaleId: 'missing-invoice', updatedBy: 'u1', updatedAt: serverTimestamp() }))
    expect((await getDoc(counter)).data()?.lastSequence).toBe(2)
  })
  it('rejects a duplicate or malformed number and rolls back the header, counter and audit together', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const source = doc(db, 'retailSales', 'counter-source')
    await assertSucceeds(writeSale(source, { ...sale(), businessDate: '12/09/2026', dateSortKey: 20260912 }))
    const old = (await getDoc(source)).data()!
    const counterRef = doc(db, 'retailInvoiceCounters', '20260912')
    for (const [index, invoiceNumber] of ['12092026001', '120920262', '13092026002'].entries()) {
      const id = 'bad-number-' + index, ref = doc(db, 'retailSales', id)
      for (const [key, items] of Object.entries(old.lineGroups) as [string, typeof line[]][]) {
        await setDoc(doc(ref, 'groups', key), { lines: items, totalAmountCents: items.reduce<number>((sum, item) => sum + item.amountCents, 0), createdBy: 'u1', createdAt: serverTimestamp() })
      }
      const data = { ...old, invoiceNumber, invoiceSequence: 2, lastActionId: id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
      const batch = writeBatch(db)
      batch.set(ref, data)
      batch.set(counterRef, { dateSortKey: 20260912, lastSequence: 2, lastSaleId: id, updatedBy: 'u1', updatedAt: serverTimestamp() })
      batch.set(doc(ref, 'actions', id), { type: 'create', saleId: id, clientOperationId: id, performedBy: 'u1', performedAt: serverTimestamp(), revision: 1, beforeSnapshot: null, afterSnapshot: data })
      await assertFails(batch.commit())
      expect((await getDoc(ref)).exists()).toBe(false)
      expect((await getDoc(doc(ref, 'actions', id))).exists()).toBe(false)
      expect((await getDoc(counterRef)).data()?.lastSequence).toBe(1)
    }
  })
  it('updates the existing invoice within 72h, retaining number/date/createdAt with a full immutable audit', async () => {
    const db = environment.authenticatedContext('u1').firestore(), ref = doc(db, 'retailSales', 'editable-invoice')
    await assertSucceeds(writeSale(ref, sale()))
    const before = (await getDoc(ref)).data()!
    const changed = makeRetailLine({ ...retailSeed[0], chineseName: '金线', malayName: 'Kerisi' }, '80.5', '2.05')
    await assertSucceeds(writeEdit(ref, 'edit-once', { vendorName: 'Ah Seng', remark: '现金 Cash', lineGroups: { first: [changed], second: [], third: [], fourth: [] }, totalAmountCents: changed.amountCents }))
    const after = (await getDoc(ref)).data()!
    expect(after).toMatchObject({ vendorName: 'Ah Seng', remark: '现金 Cash', revision: 2, invoiceNumber: before.invoiceNumber, businessDate: before.businessDate, totalAmountCents: 16503 })
    expect(after.createdAt.isEqual(before.createdAt)).toBe(true)
    expect(after.updatedAt.toMillis()).toBeGreaterThanOrEqual(before.updatedAt.toMillis())
    const actionRef = doc(ref, 'actions', 'edit-once'), action = (await getDoc(actionRef)).data()!
    expect(action.beforeSnapshot).toEqual(before)
    expect(action.afterSnapshot).toEqual(after)
    await assertFails(updateDoc(actionRef, { type: 'create' }))
    await assertFails(deleteDoc(actionRef))
    await assertFails(deleteDoc(ref))
    await assertSucceeds(writeEdit(ref, 'edit-twice', { remark: '修订 Revision' }))
    expect((await getDoc(ref)).data()?.revision).toBe(3)
  })
  it('accepts a maximum-size 20-line edit and checks the last prepared line without exceeding the Rules budget', async () => {
    const db = environment.authenticatedContext('u1').firestore(), ref = doc(db, 'retailSales', 'edit-max-lines')
    const lines = Array.from({ length: MAX_RETAIL_LINES }, (_, index) => ({ ...line, chineseName: '鱼' + index }))
    await assertSucceeds(writeSale(ref, sale(lines)))
    const edited = lines.map(item => ({ ...item, malayName: 'Edited Malay' }))
    const lineGroups = { first: edited.slice(0, 5), second: edited.slice(5, 10), third: edited.slice(10, 15), fourth: edited.slice(15) }
    await assertSucceeds(writeEdit(ref, 'max-edit', { lineGroups, remark: '全部二十行 All twenty lines' }))
    expect((await getDoc(ref)).data()).toMatchObject({ revision: 2, lineGroups })
    const badFourth = lineGroups.fourth.map((item, index) => index === 4 ? { ...item, amountCents: item.amountCents + 1 } : item)
    await assertFails(writeEdit(ref, 'max-tampered', { lineGroups: { ...lineGroups, fourth: badFourth } }))
    expect((await getDoc(ref)).data()?.revision).toBe(2)
  })
  it('allows another authenticated operator to edit while preserving the original creator', async () => {
    const ref = doc(environment.authenticatedContext('u1').firestore(), 'retailSales', 'editable-other-operator')
    await assertSucceeds(writeSale(ref, sale()))
    const otherRef = doc(environment.authenticatedContext('u2').firestore(), 'retailSales', ref.id)
    const { next, action, actionRef } = await prepareEdit(otherRef, 'operator-edit', { vendorName: '第二位操作员' }, 'u2')
    const batch = writeBatch(otherRef.firestore)
    batch.set(otherRef, next); batch.set(actionRef, action)
    await assertSucceeds(batch.commit())
    expect((await getDoc(ref)).data()).toMatchObject({ createdBy: 'u1', updatedBy: 'u2', revision: 2 })
  })
  it('enforces 72h using the stored timestamp, independently of business date and client time', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    const cases = [['inside', 71 * 3600000, true], ['boundary', 72 * 3600000, false], ['expired', 73 * 3600000, false], ['future', -3600000, false]] as const
    for (const [id, elapsed, allowed] of cases) {
      const ref = doc(db, 'retailSales', 'window-' + id)
      await writeSale(ref, { ...sale(), businessDate: '01/01/2020', dateSortKey: 20200101 })
      await environment.withSecurityRulesDisabled(async context => updateDoc(doc(context.firestore(), 'retailSales', ref.id), { createdAt: Timestamp.fromMillis(Date.now() - elapsed) }))
      if (allowed) await assertSucceeds(writeEdit(ref, id + '-edit', { vendorName: '编辑后' }))
      else await assertFails(writeEdit(ref, id + '-edit', { vendorName: '不可编辑' }))
      await assertSucceeds(getDoc(ref))
    }
  })
  it('locks missing legacy timestamps and preserves absent legacy invoice numbers when editing', async () => {
    const db = environment.authenticatedContext('u1').firestore()
    for (const timestamp of [Timestamp.now(), null]) {
      const ref = doc(db, 'retailSales', timestamp ? 'legacy-editable' : 'legacy-no-time')
      const { lines, ...header } = sale()
      const legacy = { ...header, createdAt: timestamp, lineGroups: { first: lines, second: [], third: [], fourth: [] } }
      await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'retailSales', ref.id), legacy))
      if (timestamp) {
        await assertSucceeds(writeEdit(ref, 'legacy-update', { vendorName: '旧单编辑' }))
        const updated = (await getDoc(ref)).data()!
        expect(updated.revision).toBe(2)
        expect(updated).not.toHaveProperty('invoiceNumber')
        expect(updated).not.toHaveProperty('invoiceSequence')
      } else await assertFails(writeEdit(ref, 'legacy-update', { vendorName: '没有可信时间' }))
    }
  })
  it('rejects changes to number, date, creator, createdAt and skipped revision even with matching audit', async () => {
    const db = environment.authenticatedContext('u1').firestore(), ref = doc(db, 'retailSales', 'edit-immutable-fields')
    await writeSale(ref, sale())
    const mutations: DocumentData[] = [{ invoiceNumber: '06092026999' }, { invoiceSequence: 999 }, { businessDate: '07/09/2026', dateSortKey: 20260907 }, { createdAt: serverTimestamp() }, { createdBy: 'other' }, { remark: 'x'.repeat(501) }]
    for (const [index, mutation] of mutations.entries()) await assertFails(writeEdit(ref, 'immutable-' + index, mutation))
    const { next, action, actionRef } = await prepareEdit(ref, 'skip-revision')
    next.revision = 3; action.revision = 3
    const batch = writeBatch(db)
    batch.set(ref, next); batch.set(actionRef, action)
    await assertFails(batch.commit())
    expect((await getDoc(ref)).data()?.revision).toBe(1)
  })
  it('requires an atomic action for every edit and rejects fabricated before/after snapshots', async () => {
    const db = environment.authenticatedContext('u1').firestore(), ref = doc(db, 'retailSales', 'edit-audit-required')
    await writeSale(ref, sale())
    const { next, action, actionRef } = await prepareEdit(ref, 'audit-edit', { vendorName: '新小贩' })
    await assertFails(setDoc(ref, next))
    await assertFails(setDoc(actionRef, action))
    for (const tamper of [{ beforeSnapshot: null }, { afterSnapshot: { ...next, vendorName: '伪造' } }, { performedBy: 'other' }, { revision: 1 }]) {
      const batch = writeBatch(db)
      batch.set(ref, next); batch.set(actionRef, { ...action, ...tamper })
      await assertFails(batch.commit())
    }
    const batch = writeBatch(db)
    batch.set(ref, next); batch.set(actionRef, action)
    await assertSucceeds(batch.commit())
  })
})
describe('Firestore Rules: vessels and ice-work audit', () => {
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
    const draftRef = doc(db, 'purchaseSettlementDrafts', 'fish_head_20260803_v978')
    const line = { lineType: 'fish_head', nameSnapshot: '金线', totalWeightGrams: 160500, basketCount: 1, totalWeightEntryCount: 1,
      defaultUnitPriceCentsPerKg: 210, unitPriceCentsPerKg: 210, priceWasEdited: false, amountCents: 33705, sourceEntryIds: ['entry-1'],
      fishSpeciesId: 'jin_xian', fishSpeciesCodeSnapshot: 'jin_xian', fishSpeciesNameSnapshot: '金线' }
    const draft = { productType: 'fish_head', businessDate: '03/08/2026', dateSortKey: 20260803, monthKey: '08/2026', monthSortKey: 202608,
      vesselId: 'v978', vesselCodeSnapshot: '978', receiptNo: '', status: 'settlement_draft', lines: [line], totalAmountCents: 33705,
      sourceEntryIds: ['entry-1'], createdAt: serverTimestamp(), createdBy: 'u1', updatedAt: serverTimestamp(), updatedBy: 'u1', revision: 1, voided: false }
    await assertSucceeds(setDoc(draftRef, draft))
    await assertSucceeds(updateDoc(draftRef, { receiptNo: 'FH-001', totalAmountCents: 33705, revision: 2, updatedBy: 'u1', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(draftRef, { vesselId: 'v833', monthKey: '08/2026', monthSortKey: 202608, revision: 3, updatedBy: 'u1', updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(draftRef))
    await assertFails(setDoc(doc(db, 'purchaseSettlementDrafts', 'invalid-settlement'), { ...draft, status: 'settlement_confirmed' }))
    await assertFails(setDoc(doc(db, 'purchaseSettlementDrafts', 'voided-settlement'), { ...draft, voided: true }))
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
