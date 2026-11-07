import { fishHeadMasterBasePriceCents } from './fishHeadMasterPrice'
import { QL_SEED_VERSION, type QlMethod, type QlPriceRow } from './qlPrices'
import type { FishSpeciesRecord } from './weighing'

/** Proposed metadata only: the current Firestore schema does not persist these fields. */
export type FishHeadMasterImportRecord = FishSpeciesRecord & {
  aliases?: readonly string[]
  method?: QlMethod
  sourceGroupKey?: string
  sourceVersion?: string
  sourceEffectiveDate?: string
  sourceRow?: number
}

export type FishHeadMasterProposedRecord = {
  id: string
  speciesCode: string
  displayName: string
  aliases: readonly string[]
  method: QlMethod
  basePriceCentsPerKg: number
  sourceGroupKey: string
  sourceVersion: string
  sourceEffectiveDate: string
  sourceRow: number
}

export type FishHeadMasterProposal = {
  proposalKey: string
  source: QlPriceRow
  status: 'matched' | 'new' | 'conflict'
  change: 'update' | 'unchanged' | 'create' | 'blocked'
  matches: readonly FishHeadMasterImportRecord[]
  beforePriceCentsPerKg: number | null
  proposed: FishHeadMasterProposedRecord | null
  reason: string
}

export type FishHeadMasterImportPreview = {
  sourceVersion: string
  sourceEffectiveDate: string
  proposals: FishHeadMasterProposal[]
  matchedCount: number
  newCount: number
  conflictCount: number
  changedCount: number
  unchangedCount: number
  retainedLegacyCount: number
}

const rowKey = (row: QlPriceRow) => `${row.groupKey}:${row.method}`
const sourceNames = (row: QlPriceRow) => new Set([row.label, ...row.aliases].map(name => name.trim()))
const recordNames = (record: FishHeadMasterImportRecord) => [record.displayName, ...(record.aliases ?? [])].map(name => name.trim())
const proposedId = (row: QlPriceRow) => `ql_${row.groupKey.replace(/-/g, '_')}_${row.method}`.slice(0, 40)

export function fishHeadMasterProposalKey(proposal: FishHeadMasterProposal): string {
  return proposal.proposalKey
}

/**
 * Pure, non-persisting adoption plan. It never changes the live defaults or saved documents.
 * All overlapping references stay visible; an exact group label cannot conceal an alias duplicate.
 */
export function previewFishHeadMasterImport(existing: readonly FishHeadMasterImportRecord[]): FishHeadMasterImportPreview {
  const rows = QL_SEED_VERSION.rows
  const matchesByRow = rows.map(row => {
    const names = sourceNames(row)
    const sourceRef = `${QL_SEED_VERSION.version}|${row.groupKey}:${row.method}`
    // A persisted exact source key takes precedence over unclassified legacy aliases:
    // after an owner explicitly creates separate trawl/bottom groups, reruns must not
    // reattach an old generic 丁温/青兰 record to both groups.
    const linked = existing.flatMap((record,index) => record.qlSourceRef === sourceRef ? [index] : [])
    if (linked.length) return linked
    return existing.flatMap((record, index) => {
      if (record.qlSourceRef && record.qlSourceRef !== sourceRef) return []
      if (record.method !== undefined && record.method !== row.method) return []
      if (record.sourceGroupKey !== undefined && record.sourceGroupKey !== row.groupKey) return []
      return recordNames(record).some(name => names.has(name)) ? [index] : []
    })
  })
  const rowCountByRecord = existing.map((_, index) => matchesByRow.filter(indices => indices.includes(index)).length)
  const usedIndices = new Set<number>()
  const proposals = rows.map((source, sourceIndex): FishHeadMasterProposal => {
    const matchedIndices = matchesByRow[sourceIndex]
    const matches = matchedIndices.map(index => existing[index])
    const id = matches[0]?.id ?? proposedId(source)
    const speciesCode = matches[0]?.speciesCode ?? id
    const identityIndices = existing.flatMap((record, index) => record.id === id || record.speciesCode === speciesCode ? [index] : [])
    const allIndices = [...new Set([...matchedIndices, ...identityIndices])]
    const conflicts = allIndices.map(index => existing[index])
    const blocked = (reason: string): FishHeadMasterProposal => ({
      proposalKey: rowKey(source), source, status: 'conflict', change: 'blocked', matches: conflicts,
      beforePriceCentsPerKg: null, proposed: null, reason,
    })
    if (matchedIndices.length > 1) return blocked('多个现有 Master 鱼名或别名对应同一来源组，须先确认映射；不会合并或覆盖现有 ID。')
    if (matchedIndices.some(index => rowCountByRecord[index] > 1)) return blocked('现有鱼名对应多个来源组或作业方式，缺少明确上下文；须先选择组别。')
    if (identityIndices.some(index => !matchedIndices.includes(index))) return blocked('拟议 ID 或内部代码已被其他 Master 记录使用，不能按新增或覆盖处理。')
    if (!/^[a-z0-9_]{1,40}$/.test(speciesCode) || !id) return blocked('现有 Master 标识无效，须先复核内部代码。')
    const match = matches[0]
    if (match && !match.active) return blocked('匹配记录已停用；保留原状态，须先确认是否采用。')
    matchedIndices.forEach(index => usedIndices.add(index))
    const beforePriceCentsPerKg = match ? fishHeadMasterBasePriceCents(match) : null
    const unchanged = !!match && beforePriceCentsPerKg === source.priceCentsPerKg
    return {
      proposalKey: rowKey(source), source, status: match ? 'matched' : 'new',
      change: match ? unchanged ? 'unchanged' : 'update' : 'create', matches, beforePriceCentsPerKg,
      proposed: {
        id, speciesCode, displayName: match?.displayName ?? source.label,
        aliases: [...new Set([...(match?.aliases ?? []), ...source.aliases])], method: source.method,
        basePriceCentsPerKg: source.priceCentsPerKg, sourceGroupKey: source.groupKey,
        sourceVersion: QL_SEED_VERSION.version, sourceEffectiveDate: QL_SEED_VERSION.effectiveDate, sourceRow: source.sourceRow,
      },
      reason: match ? unchanged ? '基础价与来源相同；保留现有 ID、名称及引用。' : '拟议更新未来默认价；保留现有 ID、名称及引用。' : '拟议新增来源组；尚未写入 Master。',
    }
  })
  return {
    sourceVersion: QL_SEED_VERSION.version,
    sourceEffectiveDate: QL_SEED_VERSION.effectiveDate,
    proposals,
    matchedCount: proposals.filter(row => row.status === 'matched').length,
    newCount: proposals.filter(row => row.status === 'new').length,
    conflictCount: proposals.filter(row => row.status === 'conflict').length,
    changedCount: proposals.filter(row => row.change === 'update').length,
    unchangedCount: proposals.filter(row => row.change === 'unchanged').length,
    // Blocked matches are untouched too; the UI must describe this as unchanged records.
    retainedLegacyCount: existing.filter((_, index) => !usedIndices.has(index)).length,
  }
}
