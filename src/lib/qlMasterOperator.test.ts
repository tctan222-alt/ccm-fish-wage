import { webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  applyQlMasterManifest, buildQlMasterManifest, buildQlMasterRollbackApproval, qlMasterCanonicalJson,
  rollbackQlMasterManifest, validateQlMasterManifest, QL_MASTER_MAX_DOCUMENTS,
  type MasterDocument, type QlMasterJournal, type QlMasterManifest, type QlMasterOperatorContext, type QlMasterTransaction,
} from './qlMasterOperator'
import { QL_SEED_VERSION } from './qlPrices'

beforeAll(() => { vi.stubGlobal('crypto', webcrypto) })
const clone = <T>(value: T): T => JSON.parse(qlMasterCanonicalJson(value)) as T
const actorEmail = 'approved-operator@example.com'
const projectId = 'demo-ccm-rules'
const timestamp = { seconds: 100, nanoseconds: 123456789 }
const doc = (id: string, displayName: string, extra: Record<string, unknown> = {}): MasterDocument => ({
  id, version: '1:000000001', data: { speciesCode: id, displayName, active: true, order: 1, notes: '',
    createdBy: 'prior', createdAt: { seconds: 1, nanoseconds: 1 }, updatedBy: 'prior', updatedAt: { seconds: 1, nanoseconds: 1 },
    inactiveBy: null, inactiveAt: null, ...extra },
})
const context = (manifest: QlMasterManifest): QlMasterOperatorContext => ({ projectId, actorEmail,
  approvedHash: manifest.sha256, approvedAction: 'apply', now: () => timestamp })

class Database {
  documents = new Map<string, MasterDocument>()
  journals = new Map<string, QlMasterJournal>()
  writes = 0
  version = 1
  setAttempts = 0
  failSetAt = 0
  constructor(items: MasterDocument[] = []) { items.forEach(item => this.documents.set(item.id, clone(item))) }
  snapshot() { return clone([...this.documents.values()]) }
  async transact<T>(action: (transaction: QlMasterTransaction) => Promise<T>, options: { retry?: boolean; lostResponse?: boolean; beforeRetry?: () => void } = {}): Promise<T> {
    let result!: T
    for (let attempt = 0; attempt < (options.retry ? 2 : 1); attempt++) {
      const docs = new Map([...this.documents].map(([id, value]) => [id, clone(value)]))
      const journals = new Map([...this.journals].map(([id, value]) => [id, clone(value)]))
      const queued: { id: string; data: Record<string, unknown> }[] = []
      const queuedJournals: { hash: string; journal: QlMasterJournal }[] = []
      let startedWriting = false
      const transaction: QlMasterTransaction = {
        readAll: async () => { if (startedWriting) throw new Error('read after write'); return clone([...docs.values()]) },
        readJournal: async hash => { if (startedWriting) throw new Error('read after write'); return clone(journals.get(hash) ?? null) },
        setSpecies: (id, data) => {
          startedWriting = true
          this.setAttempts++
          if (this.setAttempts === this.failSetAt) throw new Error('injected write failure')
          queued.push({ id, data: clone(data) })
        },
        setJournal: (hash, journal) => { startedWriting = true; queuedJournals.push({ hash, journal: clone(journal) }) },
      }
      result = await action(transaction)
      if (options.retry && attempt === 0) { options.beforeRetry?.(); continue }
      for (const item of queued) this.documents.set(item.id, { ...item, version: `${++this.version}:000000001` })
      for (const item of queuedJournals) this.journals.set(item.hash, item.journal)
      this.writes += queued.length
    }
    if (options.lostResponse) throw new Error('commit response lost')
    return result
  }
}

describe('approved QL operator transactions', () => {
  it('builds a complete auditable manifest directly from all 36 validated source groups', async () => {
    const manifest = await buildQlMasterManifest({ projectId, actorEmail, snapshot: [] })
    expect(manifest.entries).toHaveLength(36)
    expect(manifest.entries.map(entry => entry.after.basePriceCentsPerKg)).toEqual(QL_SEED_VERSION.rows.map(row => row.priceCentsPerKg))
    expect(manifest.entries.map(entry => entry.sourceRef)).toHaveLength(36)
    expect(new Set(manifest.entries.map(entry => entry.id)).size).toBe(36)
    expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/)
    await expect(validateQlMasterManifest(manifest)).resolves.toBeUndefined()
  })

  it('binds exact actor, project, action and content hash before any transaction reads', async () => {
    const manifest = await buildQlMasterManifest({ projectId, actorEmail, snapshot: [] })
    const database = new Database()
    for (const wrong of [{ actorEmail: 'other@example.com' }, { projectId: 'ccm-fishery-os-4490d' }, { approvedHash: 'f'.repeat(64) }, { approvedAction: 'rollback' as const }]) {
      await expect(database.transact(tx => applyQlMasterManifest(tx, manifest, { ...context(manifest), ...wrong }))).rejects.toThrow()
    }
    const changed = clone(manifest)
    changed.entries[0].after.basePriceCentsPerKg = 999
    await expect(validateQlMasterManifest(changed)).rejects.toThrow('changed after review')
    expect(database.writes).toBe(0)
    expect(database.journals.size).toBe(0)
  })

  it('rejects changed source versions, duplicate IDs, unsupported fields and incomplete review limits', async () => {
    await expect(buildQlMasterManifest({ projectId: 'wrong', actorEmail, snapshot: [] })).rejects.toThrow()
    const first = doc('first', '金线')
    await expect(buildQlMasterManifest({ projectId, actorEmail, snapshot: [first, first] })).rejects.toThrow('duplicate')
    await expect(buildQlMasterManifest({ projectId, actorEmail, snapshot: [doc('first', '金线', { extra: 'will not be dropped' })] })).rejects.toThrow('schema')
    await expect(buildQlMasterManifest({ projectId, actorEmail, snapshot: [doc('first', '金线', { qlSourceRef: 'unknown-version' })] })).rejects.toThrow('schema')
    await expect(buildQlMasterManifest({ projectId, actorEmail, snapshot: Array.from({ length: 1001 }, (_, i) => doc(`id_${i}`, '旧鱼')) })).rejects.toThrow('limit')
  })

  it('retains context-specific identities and never chooses a price for a generic alias', async () => {
    const generic = doc('ding_wen', '丁温', { basePriceCentsPerKg: 190 })
    await expect(buildQlMasterManifest({ projectId, actorEmail, snapshot: [generic] })).rejects.toThrow('Resolve every')
    const manifest = await buildQlMasterManifest({ projectId, actorEmail, snapshot: [generic], createSeparateFor: ['jiasai-dingwen-mukong:trawl', 'dingwen-mukong-jiaxi:bottom'] })
    const database = new Database([generic])
    await database.transact(tx => applyQlMasterManifest(tx, manifest, context(manifest)))
    expect(database.documents.get('ding_wen')).toEqual(generic)
    expect(manifest.entries.find(entry => entry.sourceRef.endsWith(':trawl'))?.after.basePriceCentsPerKg).toBe(200)
    expect(manifest.entries.find(entry => entry.sourceRef.includes('dingwen-mukong-jiaxi'))?.after.basePriceCentsPerKg).toBe(210)
  })

  it('rejects an otherwise valid 990-record snapshot when 36 creates would exceed the complete-read cap', async () => {
    const snapshot = Array.from({ length: 990 }, (_, index) => doc(`legacy_${index}`, '旧鱼'))
    await expect(buildQlMasterManifest({ projectId, actorEmail, snapshot })).rejects.toThrow('Resulting Master exceeds')
  })

  it('accepts exactly 1000 resulting records and keeps status snapshots and rollback within the same cap', async () => {
    const database = new Database(Array.from({ length: 964 }, (_, index) => doc(`legacy_${index}`, '旧鱼')))
    const manifest = await buildQlMasterManifest({ projectId, actorEmail, snapshot: database.snapshot() })
    expect(manifest.entries.filter(entry => entry.kind === 'create')).toHaveLength(36)
    await database.transact(tx => applyQlMasterManifest(tx, manifest, context(manifest)))
    const after = database.snapshot()
    expect(after).toHaveLength(QL_MASTER_MAX_DOCUMENTS)
    const approval = await buildQlMasterRollbackApproval(manifest, database.journals.get(manifest.sha256)!, after)
    await expect(database.transact(tx => rollbackQlMasterManifest(tx, manifest, {
      ...context(manifest), approvedAction: 'rollback', approvedHash: approval.hash, rollbackApproval: approval,
    }))).resolves.toMatchObject({ status: 'rolled-back', writes: 36 })
    expect(database.snapshot()).toHaveLength(QL_MASTER_MAX_DOCUMENTS)
    expect([...database.documents.values()].filter(item => !item.data.active)).toHaveLength(36)
  })

  it('allows price updates at the 1000-record cap when all 36 source groups already exist', async () => {
    const empty = await buildQlMasterManifest({ projectId, actorEmail, snapshot: [] })
    const sourceRecords = empty.entries.map(entry => doc(entry.id, String(entry.after.displayName), { ...entry.after, basePriceCentsPerKg: 1 }))
    const snapshot = [...Array.from({ length: 964 }, (_, index) => doc(`legacy_${index}`, '旧鱼')), ...sourceRecords]
    const manifest = await buildQlMasterManifest({ projectId, actorEmail, snapshot })
    expect(manifest.snapshot).toHaveLength(QL_MASTER_MAX_DOCUMENTS)
    expect(manifest.entries.every(entry => entry.kind === 'price-update')).toBe(true)
    await expect(validateQlMasterManifest(manifest)).resolves.toBeUndefined()
  })

  it('detects a non-target concurrent duplicate and exact field-presence/nanosecond changes', async () => {
    const original = doc('jin_xian', '金线')
    const manifest = await buildQlMasterManifest({ projectId, actorEmail, snapshot: [original] })
    for (const changed of [
      [original, doc('other', '其他鱼', { speciesCode: 'jin_xian' })],
      [doc('jin_xian', '金线', { basePriceCentsPerKg: null })],
      [{ ...original, version: '1:000000002' }],
      [doc('jin_xian', '金线', { updatedAt: { seconds: 1, nanoseconds: 2 } })],
    ]) {
      const database = new Database(changed)
      await expect(database.transact(tx => applyQlMasterManifest(tx, manifest, context(manifest)))).rejects.toThrow(/snapshot changed|Duplicate Master/)
      expect(database.writes).toBe(0)
    }
  })

  it('uses a complete fresh collection on every callback retry and never commits stale queued writes', async () => {
    const manifest = await buildQlMasterManifest({ projectId, actorEmail, snapshot: [] })
    const database = new Database()
    await expect(database.transact(tx => applyQlMasterManifest(tx, manifest, context(manifest)), {
      retry: true, beforeRetry: () => database.documents.set('concurrent', doc('concurrent', '新的鱼')),
    })).rejects.toThrow('snapshot changed')
    expect(database.snapshot()).toEqual([doc('concurrent', '新的鱼')])
    expect(database.journals.size).toBe(0)
  })

  it('atomically rolls back a callback failure and journals successful retries only once', async () => {
    const manifest = await buildQlMasterManifest({ projectId, actorEmail, snapshot: [] })
    const failed = new Database()
    failed.failSetAt = 5
    await expect(failed.transact(tx => applyQlMasterManifest(tx, manifest, context(manifest)))).rejects.toThrow('injected')
    expect(failed.documents.size).toBe(0)
    expect(failed.journals.size).toBe(0)
    const database = new Database()
    expect(await database.transact(tx => applyQlMasterManifest(tx, manifest, context(manifest)), { retry: true })).toMatchObject({ status: 'applied', writes: 36 })
    expect(database.documents.size).toBe(36)
    expect(database.writes).toBe(36)
    expect(database.journals.size).toBe(1)
    const after = database.snapshot()
    expect(await database.transact(tx => applyQlMasterManifest(tx, manifest, context(manifest)))).toMatchObject({ status: 'already-applied', writes: 0 })
    expect(database.snapshot()).toEqual(after)
  })

  it('resolves an unknown commit response from its atomic journal without repeating writes', async () => {
    const manifest = await buildQlMasterManifest({ projectId, actorEmail, snapshot: [] })
    const database = new Database()
    await expect(database.transact(tx => applyQlMasterManifest(tx, manifest, context(manifest)), { lostResponse: true })).rejects.toThrow('response lost')
    const after = database.snapshot()
    expect(await database.transact(tx => applyQlMasterManifest(tx, manifest, context(manifest)))).toMatchObject({ status: 'already-applied', writes: 0 })
    expect(database.writes).toBe(36)
    expect(database.snapshot()).toEqual(after)
  })

  it('does not rewrite equal-price/equal-source records and counts first source attachment as metadata', async () => {
    const first = await buildQlMasterManifest({ projectId, actorEmail, snapshot: [doc('hong_mu_lin', '红目林', { basePriceCentsPerKg: 275 })] })
    expect(first.entries.find(entry => entry.id === 'hong_mu_lin')?.kind).toBe('metadata-update')
    const database = new Database(first.snapshot)
    await database.transact(tx => applyQlMasterManifest(tx, first, context(first)))
    const repeat = await buildQlMasterManifest({ projectId, actorEmail, snapshot: database.snapshot() })
    expect(repeat.entries.every(entry => entry.kind === 'unchanged')).toBe(true)
    const writes = database.writes
    const after = database.snapshot()
    expect(await database.transact(tx => applyQlMasterManifest(tx, repeat, context(repeat)))).toMatchObject({ writes: 0 })
    expect(database.writes).toBe(writes)
    expect(database.snapshot()).toEqual(after)
  })

  it('requires a distinct rollback approval and restores field absence while deactivating new IDs', async () => {
    const original = doc('jin_xian', '金线')
    const database = new Database([original])
    const manifest = await buildQlMasterManifest({ projectId, actorEmail, snapshot: database.snapshot() })
    await database.transact(tx => applyQlMasterManifest(tx, manifest, context(manifest)))
    const journal = database.journals.get(manifest.sha256)!
    const approval = await buildQlMasterRollbackApproval(manifest, journal, database.snapshot())
    await expect(database.transact(tx => rollbackQlMasterManifest(tx, manifest, { ...context(manifest), approvedAction: 'rollback' }))).rejects.toThrow('separate rollback')
    const rollbackContext: QlMasterOperatorContext = { ...context(manifest), approvedAction: 'rollback', approvedHash: approval.hash, rollbackApproval: approval,
      now: () => ({ seconds: 101, nanoseconds: 2 }) }
    expect(await database.transact(tx => rollbackQlMasterManifest(tx, manifest, rollbackContext))).toMatchObject({ status: 'rolled-back', writes: 36 })
    const restored = database.documents.get('jin_xian')!.data
    expect(restored).not.toHaveProperty('basePriceCentsPerKg')
    expect(restored).not.toHaveProperty('qlSourceRef')
    expect(restored.createdBy).toBe('prior')
    expect(restored.createdAt).toEqual(original.data.createdAt)
    const newlyCreated = manifest.entries.find(entry => entry.kind === 'create')!
    expect(database.documents.get(newlyCreated.id)!.data).toMatchObject({ active: false, qlSourceRef: newlyCreated.sourceRef })
    expect(database.documents.size).toBe(36)
    expect(await database.transact(tx => rollbackQlMasterManifest(tx, manifest, rollbackContext))).toMatchObject({ status: 'already-rolled-back', writes: 0 })
    await expect(database.transact(tx => applyQlMasterManifest(tx, manifest, context(manifest)))).rejects.toThrow('rolled back')
  })

  it('rejects rollback after any data or full server version change without any partial restoration', async () => {
    for (const identicalRewrite of [false, true]) {
      const database = new Database()
      const manifest = await buildQlMasterManifest({ projectId, actorEmail, snapshot: [] })
      await database.transact(tx => applyQlMasterManifest(tx, manifest, context(manifest)))
      const approval = await buildQlMasterRollbackApproval(manifest, database.journals.get(manifest.sha256)!, database.snapshot())
      const first = database.documents.get(manifest.entries[0].id)!
      database.documents.set(first.id, { ...first, version: '999:000000001', data: identicalRewrite ? first.data : { ...first.data, notes: 'later user change' } })
      const after = database.snapshot(), writes = database.writes
      await expect(database.transact(tx => rollbackQlMasterManifest(tx, manifest, { ...context(manifest), approvedAction: 'rollback', approvedHash: approval.hash, rollbackApproval: approval }))).rejects.toThrow('changed after adoption')
      expect(database.snapshot()).toEqual(after)
      expect(database.writes).toBe(writes)
      expect(database.journals.get(manifest.sha256)?.state).toBe('applied')
    }
  })

  it('rejects corrupted journal images rather than using them as rollback instructions', async () => {
    const database = new Database()
    const manifest = await buildQlMasterManifest({ projectId, actorEmail, snapshot: [] })
    await database.transact(tx => applyQlMasterManifest(tx, manifest, context(manifest)))
    const journal = database.journals.get(manifest.sha256)!
    journal.entries[0].after.basePriceCentsPerKg = 999
    await expect(buildQlMasterRollbackApproval(manifest, journal, database.snapshot())).rejects.toThrow('before/after images')
  })
})
