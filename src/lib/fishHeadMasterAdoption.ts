import { previewFishHeadMasterImport, type FishHeadMasterImportRecord, type FishHeadMasterProposedRecord } from './fishHeadMasterImport'
import { QL_SEED_VERSION, type QlPriceRow } from './qlPrices'

/** Stable versioned foreign key: aliases, fishing method and original row remain in the immutable QL source. */
export function qlMasterSourceRef(row: QlPriceRow): string {
  return `${QL_SEED_VERSION.version}|${row.groupKey}:${row.method}`
}

export function sourceFromQlMasterRef(ref: string | undefined): QlPriceRow | null {
  if (!ref) return null
  return QL_SEED_VERSION.rows.find(row => qlMasterSourceRef(row) === ref) ?? null
}

export type QlMasterWriteEntry = {
  action: 'create' | 'update' | 'unchanged'
  sourceKey: string
  sourceRef: string
  before: FishHeadMasterImportRecord | null
  proposed: FishHeadMasterProposedRecord
}

export type QlMasterAdoptionPlan = {
  sourceVersion: string
  entries: QlMasterWriteEntry[]
  blocked: { sourceKey: string; label: string; reason: string }[]
  creates: number
  updates: number
  unchanged: number
}

/** Fail-closed planner. Ambiguous legacy names are never overwritten or silently reclassified. */
export function prepareQlMasterAdoption(
  existing: readonly FishHeadMasterImportRecord[],
  createSeparateFor: readonly string[] = [],
): QlMasterAdoptionPlan {
  const preview = previewFishHeadMasterImport(existing)
  const acceptedSeparate = new Set(createSeparateFor)
  const validKeys = new Set(preview.proposals.filter(p => p.status === 'conflict').map(p => p.proposalKey))
  if (acceptedSeparate.size !== createSeparateFor.length || [...acceptedSeparate].some(k => !validKeys.has(k))) {
    throw new Error('独立组选择无效或重复，请重新检查36组映射。')
  }
  const entries: QlMasterWriteEntry[] = []
  const blocked: QlMasterAdoptionPlan['blocked'] = []
  const usedIds = new Set<string>(), usedCodes = new Set<string>()
  const sourceRefs = new Set<string>()
  const recordById = new Map(existing.map(item => [item.id, item]))
  const recordByCode = new Map(existing.map(item => [item.speciesCode, item]))
  for (const proposal of preview.proposals) {
    const sourceRef = qlMasterSourceRef(proposal.source)
    let proposed = proposal.proposed
    let before = proposal.status === 'matched' ? proposal.matches[0] : null
    let action: QlMasterWriteEntry['action'] =
      proposal.change === 'create' ? 'create' : proposal.change === 'unchanged' ? 'unchanged' : 'update'
    if (proposal.status === 'conflict') {
      if (acceptedSeparate.has(proposal.proposalKey)) {
        // A conflict may be resolved only by explicitly creating a *separate* grouped identity.
        // Existing generic species, prior snapshots and unrelated aliases are preserved.
        const id = `ql_${proposal.source.groupKey.replace(/-/g, '_')}_${proposal.source.method}`.slice(0, 40)
        if (recordById.has(id) || recordByCode.has(id)) {
          blocked.push({ sourceKey: proposal.proposalKey, label: proposal.source.label,
            reason: '独立组代码与现有 Master 记录冲突，不能建立。' })
          continue
        }
        proposed = { id, speciesCode: id, displayName: proposal.source.label,
          aliases: [...proposal.source.aliases], method: proposal.source.method,
          basePriceCentsPerKg: proposal.source.priceCentsPerKg, sourceGroupKey: proposal.source.groupKey,
          sourceVersion: QL_SEED_VERSION.version, sourceEffectiveDate: QL_SEED_VERSION.effectiveDate,
          sourceRow: proposal.source.sourceRow }
        before = null
        action = 'create'
      } else {
        blocked.push({ sourceKey: proposal.proposalKey, label: proposal.source.label, reason: proposal.reason })
        continue
      }
    }
    if (!proposed || sourceRefs.has(sourceRef) || usedIds.has(proposed.id) || usedCodes.has(proposed.speciesCode)
      || (action === 'create' && (recordById.has(proposed.id) || recordByCode.has(proposed.speciesCode)))) {
      blocked.push({ sourceKey: proposal.proposalKey, label: proposal.source.label,
        reason: '拟议组的来源、ID 或内部代码重复，必须人工核对。' })
      continue
    }
    const previousOwner = existing.find(item => item.qlSourceRef === sourceRef && item.id !== proposed.id)
    if (previousOwner) {
      blocked.push({ sourceKey: proposal.proposalKey, label: proposal.source.label,
        reason: '该来源组已被另一条 Master 记录认领，不能重复导入。' })
      continue
    }
    sourceRefs.add(sourceRef)
    usedIds.add(proposed.id)
    usedCodes.add(proposed.speciesCode)
    entries.push({ action, sourceKey: proposal.proposalKey, sourceRef, before, proposed })
  }
  if (entries.length + blocked.length !== 36) throw new Error('QL 36组处理不完整，禁止继续。')
  return { sourceVersion: QL_SEED_VERSION.version, entries, blocked,
    creates: entries.filter(row => row.action === 'create').length,
    updates: entries.filter(row => row.action === 'update').length,
    unchanged: entries.filter(row => row.action === 'unchanged').length }
}

function timestampIdentity(value:unknown):unknown {
  if(value instanceof Date)return ['date',value.toISOString()]
  if(value&&typeof value==='object'&&'seconds' in value){
    const stamp=value as {seconds:unknown;nanoseconds?:unknown}
    return ['timestamp',stamp.seconds,stamp.nanoseconds??0]
  }
  return value??null
}

/** Preserve absence/null and full timestamp precision: both change approval meaning. */
export function qlMasterFingerprint(items: readonly FishHeadMasterImportRecord[]): string {
  return JSON.stringify([...items].sort((a,b) => a.id.localeCompare(b.id)).map(item => [
    item.id,item.speciesCode,item.displayName,item.active,item.order,item.notes,
    [Object.prototype.hasOwnProperty.call(item,'basePriceCentsPerKg'),item.basePriceCentsPerKg??null],
    [Object.prototype.hasOwnProperty.call(item,'qlSourceRef'),item.qlSourceRef??null],
    item.createdBy??null,timestampIdentity(item.createdAt),item.updatedBy??null,timestampIdentity(item.updatedAt),
    item.inactiveBy??null,timestampIdentity(item.inactiveAt),
  ]))
}
