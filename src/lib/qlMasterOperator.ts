import { prepareQlMasterAdoption, sourceFromQlMasterRef } from './fishHeadMasterAdoption'
import type { FishHeadMasterImportRecord } from './fishHeadMasterImport'
import { QL_SEED_VERSION } from './qlPrices'

export const QL_MASTER_COLLECTION = 'fishSpecies'
export const QL_MASTER_JOURNAL_COLLECTION = 'fishSpeciesAdoptions'
export const QL_MASTER_MAX_DOCUMENTS = 1000
const MAX_ARCHIVE_BYTES = 900 * 1024

export type MasterDocument = { id: string; data: Record<string, unknown>; version: string }
export type OperatorTimestamp = { seconds: number; nanoseconds: number }
export type QlMasterManifestEntry = {
  id: string
  sourceRef: string
  sourceLabel: string
  kind: 'create' | 'price-update' | 'metadata-update' | 'unchanged'
  before: MasterDocument | null
  /** Complete proposed document before operator/time audit stamps are applied. */
  after: Record<string, unknown>
}
export type QlMasterManifest = {
  schemaVersion: 1
  projectId: string
  actorEmail: string
  sourceVersion: string
  collection: typeof QL_MASTER_COLLECTION
  journalCollection: typeof QL_MASTER_JOURNAL_COLLECTION
  snapshot: MasterDocument[]
  createSeparateFor: string[]
  entries: QlMasterManifestEntry[]
  sha256: string
}
export type QlMasterJournalEntry = { id: string; before: MasterDocument | null; after: Record<string, unknown> }
export type QlMasterJournal = {
  schemaVersion: 1
  projectId: string
  actorEmail: string
  manifestHash: string
  state: 'applied' | 'rolled-back'
  appliedAt: OperatorTimestamp
  entries: QlMasterJournalEntry[]
  rolledBackAt?: OperatorTimestamp
}
export type QlMasterTransaction = {
  /** Must be a complete collection query inside the same server transaction. */
  readAll(): Promise<MasterDocument[]>
  readJournal(hash: string): Promise<QlMasterJournal | null>
  setSpecies(id: string, data: Record<string, unknown>): void
  setJournal(hash: string, journal: QlMasterJournal): void
}
export type QlMasterOperatorContext = {
  projectId: string
  /** Must be independently verified from the authenticated IAM identity by the adapter. */
  actorEmail: string
  approvedHash: string
  approvedAction: 'apply' | 'rollback'
  rollbackApproval?: QlMasterRollbackApproval
  now(): OperatorTimestamp
}
export type QlMasterRollbackApproval = {
  schemaVersion: 1
  manifestHash: string
  projectId: string
  actorEmail: string
  afterVersions: Record<string, string>
  hash: string
}
export type QlMasterOperationResult = { status: 'applied' | 'already-applied' | 'rolled-back' | 'already-rolled-back'; writes: number; manifestHash: string }

/** Canonical JSON keeps optional-field presence and timestamp nanoseconds intact. */
export function qlMasterCanonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(qlMasterCanonicalJson).join(',')}]`
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${qlMasterCanonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  throw new Error('Manifest contains a non-JSON value; normalize server timestamps before approval.')
}
const copy = <T>(value: T): T => JSON.parse(qlMasterCanonicalJson(value)) as T
const same = (a: unknown, b: unknown) => qlMasterCanonicalJson(a) === qlMasterCanonicalJson(b)
const bytes = (value: unknown) => new TextEncoder().encode(qlMasterCanonicalJson(value)).byteLength

function validateScope(projectId: string, actorEmail: string) {
  if (projectId !== 'ccm-fishery-os-4490d' && projectId !== 'demo-ccm-rules') throw new Error('Unexpected Firestore project.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actorEmail)) throw new Error('An explicitly approved IAM operator email is required.')
}

function validateSnapshot(snapshot: readonly MasterDocument[]): MasterDocument[] {
  if (!Array.isArray(snapshot) || snapshot.length > QL_MASTER_MAX_DOCUMENTS) throw new Error('Complete Master snapshot exceeds the review limit.')
  const ids = new Set<string>()
  const codes = new Set<string>(), sourceRefs = new Set<string>()
  const allowed = new Set(['speciesCode', 'displayName', 'active', 'order', 'notes', 'basePriceCentsPerKg', 'qlSourceRef', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt', 'inactiveBy', 'inactiveAt'])
  for (const item of snapshot) {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.includes('/') || ids.has(item.id)
      || typeof item.version !== 'string' || !item.version || !item.data || Array.isArray(item.data)) throw new Error('Invalid or duplicate Master document identity/version.')
    ids.add(item.id)
    const d = item.data
    if (Object.keys(d).some(key => !allowed.has(key)) || typeof d.speciesCode !== 'string' || !/^[a-z0-9_]{1,40}$/.test(d.speciesCode)
      || typeof d.displayName !== 'string' || !d.displayName.trim() || d.displayName.length > 80
      || typeof d.active !== 'boolean' || !Number.isInteger(d.order) || Number(d.order) < 1 || typeof d.notes !== 'string' || d.notes.length > 500
      || ('basePriceCentsPerKg' in d && d.basePriceCentsPerKg !== null && (!Number.isSafeInteger(d.basePriceCentsPerKg) || Number(d.basePriceCentsPerKg) < 1 || Number(d.basePriceCentsPerKg) > 9999995))
      || ('qlSourceRef' in d && (typeof d.qlSourceRef !== 'string' || !sourceFromQlMasterRef(d.qlSourceRef)))) throw new Error('Unexpected Master schema; no field will be silently dropped.')
    if (codes.has(d.speciesCode) || (typeof d.qlSourceRef === 'string' && sourceRefs.has(d.qlSourceRef))) throw new Error('Duplicate Master code or QL source ownership in the complete snapshot.')
    codes.add(d.speciesCode)
    if (typeof d.qlSourceRef === 'string') sourceRefs.add(d.qlSourceRef)
    qlMasterCanonicalJson(d)
  }
  return copy([...snapshot].sort((a, b) => a.id.localeCompare(b.id)))
}

async function digest(value: unknown): Promise<string> {
  const result = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(qlMasterCanonicalJson(value)))
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function buildQlMasterManifest(input: {
  projectId: string; actorEmail: string; snapshot: readonly MasterDocument[]; createSeparateFor?: readonly string[]
}): Promise<QlMasterManifest> {
  validateScope(input.projectId, input.actorEmail)
  const snapshot = validateSnapshot(input.snapshot)
  const records = snapshot.map(item => ({ ...item.data, id: item.id }) as FishHeadMasterImportRecord)
  const createSeparateFor = [...(input.createSeparateFor ?? [])].sort()
  const plan = prepareQlMasterAdoption(records, createSeparateFor)
  if (plan.blocked.length || plan.entries.length !== 36) throw new Error(`Resolve every source group before approval (${plan.blocked.length} blocked).`)
  const byId = new Map(snapshot.map(item => [item.id, item]))
  const nextOrder = Math.max(0, ...snapshot.map(item => Number(item.data.order)))
  const entries = plan.entries.map((entry): QlMasterManifestEntry => {
    const before = byId.get(entry.proposed.id) ?? null
    const after: Record<string, unknown> = before ? { ...before.data } : {
      speciesCode: entry.proposed.speciesCode, displayName: entry.proposed.displayName, active: true,
      order: nextOrder + entry.proposed.sourceRow - 3, notes: '', inactiveBy: null, inactiveAt: null,
    }
    after.basePriceCentsPerKg = entry.proposed.basePriceCentsPerKg
    after.qlSourceRef = entry.sourceRef
    const kind = !before ? 'create' : same(before.data, after) ? 'unchanged'
      : before.data.basePriceCentsPerKg === after.basePriceCentsPerKg ? 'metadata-update' : 'price-update'
    return { id: entry.proposed.id, sourceRef: entry.sourceRef, sourceLabel: sourceFromQlMasterRef(entry.sourceRef)!.label, kind, before, after }
  })
  const body: Omit<QlMasterManifest, 'sha256'> = {
    schemaVersion: 1 as const, projectId: input.projectId, actorEmail: input.actorEmail,
    sourceVersion: QL_SEED_VERSION.version, collection: QL_MASTER_COLLECTION, journalCollection: QL_MASTER_JOURNAL_COLLECTION,
    snapshot, createSeparateFor, entries,
  }
  if (bytes(body) > MAX_ARCHIVE_BYTES) throw new Error('Approval manifest exceeds the safe archive size.')
  return { ...body, sha256: await digest(body) }
}

export async function validateQlMasterManifest(manifest: QlMasterManifest): Promise<void> {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.collection !== QL_MASTER_COLLECTION
    || manifest.journalCollection !== QL_MASTER_JOURNAL_COLLECTION || manifest.sourceVersion !== QL_SEED_VERSION.version) throw new Error('Unsupported manifest scope or source version.')
  const rebuilt = await buildQlMasterManifest(manifest)
  if (!same(rebuilt, manifest)) throw new Error('Manifest contents or SHA-256 changed after review.')
}

/** Offline validation: call before credentials, network or any production read. */
export async function validateQlMasterOperationApproval(manifest: QlMasterManifest, context: QlMasterOperatorContext, action: 'apply' | 'rollback'): Promise<void> {
  await validateQlMasterManifest(manifest)
  if (context.projectId !== manifest.projectId || context.actorEmail !== manifest.actorEmail
    || context.approvedAction !== action) throw new Error('Project, authenticated actor, action and approved manifest hash must all match.')
  if (action === 'apply') {
    if (context.approvedHash !== manifest.sha256) throw new Error('Approved apply hash does not match the manifest.')
  } else {
    const approval = context.rollbackApproval
    if (!approval || approval.schemaVersion !== 1 || approval.manifestHash !== manifest.sha256
      || approval.projectId !== manifest.projectId || approval.actorEmail !== manifest.actorEmail) throw new Error('A separate rollback approval is required.')
    const { hash, ...body } = approval
    if (hash !== context.approvedHash || await digest(body) !== hash) throw new Error('Approved rollback hash does not match its after-image versions.')
  }
}
function stamp(context: QlMasterOperatorContext): OperatorTimestamp {
  const time = context.now()
  if (!Number.isSafeInteger(time.seconds) || !Number.isInteger(time.nanoseconds) || time.nanoseconds < 0 || time.nanoseconds > 999999999) throw new Error('Invalid full-precision operation timestamp.')
  return copy(time)
}
function validateJournal(journal: QlMasterJournal, manifest: QlMasterManifest) {
  if (journal.schemaVersion !== 1 || journal.manifestHash !== manifest.sha256 || journal.actorEmail !== manifest.actorEmail || journal.projectId !== manifest.projectId
    || !['applied', 'rolled-back'].includes(journal.state)) throw new Error('Existing operation journal does not match this approval.')
  const expectedEntries = appliedEntries(manifest, journal.appliedAt)
  if (!same(journal.entries, expectedEntries)) throw new Error('Operation journal before/after images do not match the approved manifest.')
}
function appliedEntries(manifest: QlMasterManifest, time: OperatorTimestamp): QlMasterJournalEntry[] {
  if (!time || !Number.isSafeInteger(time.seconds) || !Number.isInteger(time.nanoseconds) || time.nanoseconds < 0 || time.nanoseconds > 999999999) throw new Error('Journal operation timestamp is invalid.')
  return manifest.entries.filter(entry => entry.kind !== 'unchanged').map(entry => ({
    id: entry.id, before: copy(entry.before), after: {
      ...copy(entry.after), ...(entry.before ? {} : { createdBy: manifest.actorEmail, createdAt: time }),
      updatedBy: manifest.actorEmail, updatedAt: time,
    },
  }))
}

/** Run only against an explicitly authorized server after-image snapshot; this does not write. */
export async function buildQlMasterRollbackApproval(manifest: QlMasterManifest, journal: QlMasterJournal, currentSnapshot: readonly MasterDocument[]): Promise<QlMasterRollbackApproval> {
  await validateQlMasterManifest(manifest)
  validateJournal(journal, manifest)
  if (journal.state !== 'applied') throw new Error('Only a committed, not-yet-rolled-back operation can be approved for rollback.')
  const byId = new Map(validateSnapshot(currentSnapshot).map(item => [item.id, item]))
  const afterVersions: Record<string, string> = {}
  for (const entry of journal.entries) {
    const current = byId.get(entry.id)
    if (!current || !same(current.data, entry.after)) throw new Error(`Master ${entry.id} no longer equals the committed after-image.`)
    afterVersions[entry.id] = current.version
  }
  const body = { schemaVersion: 1 as const, manifestHash: manifest.sha256, projectId: manifest.projectId, actorEmail: manifest.actorEmail, afterVersions }
  return { ...body, hash: await digest(body) }
}

/** Adapter must execute this callback in a server SDK serializable transaction. */
export async function applyQlMasterManifest(transaction: QlMasterTransaction, manifest: QlMasterManifest, context: QlMasterOperatorContext): Promise<QlMasterOperationResult> {
  await validateQlMasterOperationApproval(manifest, context, 'apply')
  const current = validateSnapshot(await transaction.readAll())
  const journal = await transaction.readJournal(manifest.sha256)
  if (journal) {
    validateJournal(journal, manifest)
    if (journal.state === 'rolled-back') throw new Error('This operation was rolled back; a fresh snapshot and approval are required.')
    return { status: 'already-applied', writes: 0, manifestHash: manifest.sha256 }
  }
  if (!same(current, manifest.snapshot)) throw new Error('Master snapshot changed; regenerate the complete approval manifest.')
  const appliedAt = stamp(context)
  const entries = appliedEntries(manifest, appliedAt)
  const nextJournal: QlMasterJournal = { schemaVersion: 1, projectId: manifest.projectId, actorEmail: context.actorEmail,
    manifestHash: manifest.sha256, state: 'applied', appliedAt, entries }
  if (bytes(nextJournal) > MAX_ARCHIVE_BYTES) throw new Error('Operation journal exceeds the safe document size.')
  // No write is queued until every scope, snapshot, timestamp and archive check passes.
  entries.forEach(entry => transaction.setSpecies(entry.id, entry.after))
  transaction.setJournal(manifest.sha256, nextJournal)
  return { status: 'applied', writes: entries.length, manifestHash: manifest.sha256 }
}

/** A separately approved rollback never deletes a species or edits historical documents. */
export async function rollbackQlMasterManifest(transaction: QlMasterTransaction, manifest: QlMasterManifest, context: QlMasterOperatorContext): Promise<QlMasterOperationResult> {
  await validateQlMasterOperationApproval(manifest, context, 'rollback')
  const current = validateSnapshot(await transaction.readAll())
  const journal = await transaction.readJournal(manifest.sha256)
  if (!journal) throw new Error('No committed operation exists for this rollback.')
  validateJournal(journal, manifest)
  if (journal.state === 'rolled-back') return { status: 'already-rolled-back', writes: 0, manifestHash: manifest.sha256 }
  const byId = new Map(current.map(item => [item.id, item]))
  const changedIds = manifest.entries.filter(entry => entry.kind !== 'unchanged').map(entry => entry.id)
  if (!same([...journal.entries.map(entry => entry.id)].sort(), [...changedIds].sort()) || new Set(changedIds).size !== changedIds.length) throw new Error('Journal target set differs from the approved manifest.')
  if (!same(Object.keys(context.rollbackApproval!.afterVersions).sort(), [...changedIds].sort())) throw new Error('Rollback approval must include every changed document version.')
  for (const entry of journal.entries) {
    const found = byId.get(entry.id)
    if (!found || !same(found.data, entry.after) || found.version !== context.rollbackApproval!.afterVersions[entry.id]) throw new Error(`Master ${entry.id} changed after adoption; rollback cancelled in full.`)
  }
  const rolledBackAt = stamp(context)
  const restores = journal.entries.map(entry => ({ id: entry.id, data: entry.before ? {
    ...copy(entry.before.data), updatedBy: context.actorEmail, updatedAt: rolledBackAt,
  } : { ...copy(entry.after), active: false, inactiveBy: context.actorEmail, inactiveAt: rolledBackAt,
    updatedBy: context.actorEmail, updatedAt: rolledBackAt } }))
  restores.forEach(entry => transaction.setSpecies(entry.id, entry.data))
  transaction.setJournal(manifest.sha256, { ...journal, state: 'rolled-back', rolledBackAt })
  return { status: 'rolled-back', writes: restores.length, manifestHash: manifest.sha256 }
}
