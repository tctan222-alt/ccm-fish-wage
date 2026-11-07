import { describe, expect, it } from 'vitest'
import { fishHeadMasterProposalKey, previewFishHeadMasterImport, type FishHeadMasterImportRecord } from './fishHeadMasterImport'
import { QL_SEED_VERSION } from './qlPrices'

const species = (displayName: string, changes: Partial<FishHeadMasterImportRecord> = {}): FishHeadMasterImportRecord => ({
  id: 'existing', speciesCode: 'existing', displayName, active: true, order: 1, notes: '', ...changes,
})
const row = (label: string, existing: readonly FishHeadMasterImportRecord[]) => {
  const proposal = previewFishHeadMasterImport(existing).proposals.find(item => item.source.label === label)
  if (!proposal) throw new Error(`Missing source row: ${label}`)
  return proposal
}

describe('Fish Head Master QL adoption preview', () => {
  it('uses every validated source row and exact new integer-cent price without manually copying prices', () => {
    const preview = previewFishHeadMasterImport([])
    expect(preview.proposals).toHaveLength(36)
    expect(preview.sourceVersion).toBe(QL_SEED_VERSION.version)
    expect(preview.sourceEffectiveDate).toBe(QL_SEED_VERSION.effectiveDate)
    expect(preview.newCount).toBe(36)
    expect(preview.conflictCount).toBe(0)
    expect(new Set(preview.proposals.map(item => item.proposed?.id)).size).toBe(36)
    preview.proposals.forEach((item, index) => {
      const source = QL_SEED_VERSION.rows[index]
      expect(item.source).toBe(source)
      expect(item.proposalKey).toBe(`${source.groupKey}:${source.method}`)
      expect(fishHeadMasterProposalKey(item)).toBe(item.proposalKey)
      expect(item.proposed).toMatchObject({
        displayName: source.label, aliases: source.aliases, method: source.method,
        basePriceCentsPerKg: source.priceCentsPerKg, sourceGroupKey: source.groupKey,
        sourceVersion: 'ql-foods-2026-10-10', sourceEffectiveDate: '2026-10-10', sourceRow: source.sourceRow,
      })
      expect(item.proposed?.speciesCode).toMatch(/^[a-z0-9_]{1,40}$/)
      expect(Number.isSafeInteger(item.proposed?.basePriceCentsPerKg)).toBe(true)
    })
  })

  it('retains an existing alias name, ID, code and aliases and shows effective legacy old price', () => {
    const existing = species('金线', { id: 'jin_xian', speciesCode: 'jin_xian', aliases: ['旧本地称呼'] })
    const item = row('红丁/金线/大眼金鱼/红加', [existing])
    expect(item).toMatchObject({ status: 'matched', change: 'update', beforePriceCentsPerKg: 205 })
    expect(item.proposed).toMatchObject({ id: 'jin_xian', speciesCode: 'jin_xian', displayName: '金线', basePriceCentsPerKg: 210 })
    expect(item.proposed?.aliases).toEqual(expect.arrayContaining(['旧本地称呼', '红丁', '金线', '大眼金鱼', '红加']))
    expect(existing.basePriceCentsPerKg).toBeUndefined()
  })

  it.each(['丁温', '目孔', '青兰'])('blocks generic %s when fishing context is missing', name => {
    const preview = previewFishHeadMasterImport([species(name)])
    const matches = preview.proposals.filter(item => item.matches.length)
    expect(matches).toHaveLength(2)
    expect(matches.every(item => item.status === 'conflict' && item.proposed === null)).toBe(true)
    expect(preview.retainedLegacyCount).toBe(1)
  })

  it('keeps trawl/bottom and general/bottom prices distinct with explicit context', () => {
    const cases = [
      ['丁温', 'trawl', 200], ['丁温', 'bottom', 210], ['目孔', 'trawl', 200],
      ['目孔', 'bottom', 210], ['青兰', 'general', 90], ['青兰', 'bottom', 110],
    ] as const
    for (const [name, method, price] of cases) {
      const preview = previewFishHeadMasterImport([species(name, { method })])
      const matched = preview.proposals.filter(item => item.status === 'matched')
      expect(matched).toHaveLength(1)
      expect(matched[0].proposed).toMatchObject({ method, basePriceCentsPerKg: price })
      expect(preview.conflictCount).toBe(0)
    }
  })

  it('does not silently merge 加晒 with 加西 or expand ambiguous slash abbreviations', () => {
    const preview = previewFishHeadMasterImport([
      species('加晒', { id: 'jiasai', speciesCode: 'jiasai' }),
      species('加西', { id: 'jiaxi', speciesCode: 'jiaxi' }),
      species('红', { id: 'red', speciesCode: 'red' }),
      species('中', { id: 'middle', speciesCode: 'middle' }),
    ])
    expect(preview.proposals.find(item => item.source.method === 'trawl')?.proposed?.id).toBe('jiasai')
    expect(row('丁温/目孔/加西（底船）', [species('加西')]).proposed?.basePriceCentsPerKg).toBe(210)
    expect(row('红/乌目林仔', [species('红')]).status).toBe('new')
    expect(row('中/白月仔/牛南', [species('中')]).status).toBe('new')
    expect(preview.retainedLegacyCount).toBe(2)
  })

  it('surfaces alias duplicates even when another record exactly equals the group label', () => {
    const existing = [species('戈里仔/黄线仔/记仔', { id: 'group', speciesCode: 'group' }), species('黄线仔', { id: 'alias', speciesCode: 'alias' })]
    const item = row('戈里仔/黄线仔/记仔', existing)
    expect(item.status).toBe('conflict')
    expect(item.matches.map(match => match.id)).toEqual(['group', 'alias'])
    expect(item.proposed).toBeNull()
    expect(previewFishHeadMasterImport(existing).retainedLegacyCount).toBe(2)
  })

  it('surfaces duplicate codes and duplicate IDs instead of silently choosing or overwriting', () => {
    for (const collision of [{ id: 'other', speciesCode: 'same' }, { id: 'same', speciesCode: 'other' }]) {
      const item = row('大目力', [species('大目力', { id: 'same', speciesCode: 'same' }), species('旧品种', collision)])
      expect(item.status).toBe('conflict')
      expect(item.matches).toHaveLength(2)
      expect(item.proposed).toBeNull()
    }
  })

  it('blocks a create whose generated ID or code belongs to an unrelated legacy record', () => {
    const proposed = row('大目力', []).proposed!
    for (const collision of [{ id: proposed.id, speciesCode: 'other' }, { id: 'other', speciesCode: proposed.speciesCode }]) {
      const existing = [species('旧品种', collision)]
      expect(row('大目力', existing)).toMatchObject({ status: 'conflict', change: 'blocked', proposed: null })
      expect(previewFishHeadMasterImport(existing).retainedLegacyCount).toBe(1)
    }
  })

  it('does not reactivate an inactive match or mutate unrelated legacy entries', () => {
    const existing = [species('大目力', { active: false }), species('未列入QL的鱼', { id: 'legacy', speciesCode: 'legacy', basePriceCentsPerKg: 999 })]
    const before = structuredClone(existing)
    const preview = previewFishHeadMasterImport(existing)
    expect(row('大目力', existing).status).toBe('conflict')
    expect(preview.retainedLegacyCount).toBe(2)
    expect(existing).toEqual(before)
  })

  it('is deterministic and proposes no new records or price changes after all 36 proposals are adopted in memory', () => {
    const first = previewFishHeadMasterImport([])
    const adopted = first.proposals.map((item, index) => species(item.source.label, { ...item.proposed!, order: index + 1 }))
    const before = structuredClone(adopted)
    const second = previewFishHeadMasterImport(adopted)
    expect(second).toEqual(previewFishHeadMasterImport(adopted))
    expect(second).toMatchObject({ matchedCount: 36, newCount: 0, changedCount: 0, unchangedCount: 36, conflictCount: 0, retainedLegacyCount: 0 })
    expect(second.proposals.map(item => item.proposed)).toEqual(first.proposals.map(item => item.proposed))
    expect(adopted).toEqual(before)
  })

  it('preserves explicit unset defaults in the before/after preview without applying them', () => {
    const existing = Object.freeze(species('大目力', { basePriceCentsPerKg: null }))
    const item = row('大目力', Object.freeze([existing]))
    expect(item).toMatchObject({ beforePriceCentsPerKg: null, change: 'update', proposed: { basePriceCentsPerKg: 315 } })
    expect(existing.basePriceCentsPerKg).toBeNull()
  })
})
