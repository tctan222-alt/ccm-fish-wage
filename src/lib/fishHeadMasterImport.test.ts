import { describe, expect, it } from 'vitest'
import { fishHeadMasterProposalKey, isQlMarketPriceRow, QL_FISH_HEAD_MASTER_ROWS, previewFishHeadMasterImport, type FishHeadMasterImportRecord } from './fishHeadMasterImport'
import { QL_SEED_VERSION } from './qlPrices'

const species = (displayName: string, changes: Partial<FishHeadMasterImportRecord> = {}): FishHeadMasterImportRecord => ({
  id: 'existing', speciesCode: 'existing', displayName, active: true, order: 1, notes: '', ...changes,
})
const row = (label: string, existing: readonly FishHeadMasterImportRecord[] = []) => {
  const proposal = previewFishHeadMasterImport(existing).proposals.find(item => item.source.label === label)
  if (!proposal) throw new Error(`Missing non-bottom source row: ${label}`)
  return proposal
}

describe('Fish Head Master QL non-bottom adoption preview', () => {
  it('keeps the original 36 QL customer references intact but proposes only 34 non-bottom Master groups', () => {
    expect(QL_SEED_VERSION.rows).toHaveLength(36)
    expect(QL_FISH_HEAD_MASTER_ROWS).toHaveLength(34)
    expect(QL_SEED_VERSION.rows.filter(item => item.method === 'bottom')).toHaveLength(2)
    const preview = previewFishHeadMasterImport([])
    expect(preview.proposals).toHaveLength(34)
    expect(preview.newCount).toBe(34)
    expect(preview.conflictCount).toBe(0)
    expect(preview.sourceVersion).toBe(QL_SEED_VERSION.version)
    expect(preview.sourceEffectiveDate).toBe(QL_SEED_VERSION.effectiveDate)
    expect(new Set(preview.proposals.map(item => item.proposed?.id)).size).toBe(34)
    expect(preview.proposals.every(item => item.source.method !== 'bottom')).toBe(true)
    preview.proposals.forEach((item, index) => {
      const source = QL_FISH_HEAD_MASTER_ROWS[index]
      expect(item.source).toBe(source)
      expect(fishHeadMasterProposalKey(item)).toBe(`${source.groupKey}:${source.method}`)
      expect(item.proposed).toMatchObject({
        displayName: source.label, aliases: source.aliases, method: source.method,
        basePriceCentsPerKg: isQlMarketPriceRow(source) ? null : source.priceCentsPerKg,
        sourceGroupKey: source.groupKey, sourceVersion: QL_SEED_VERSION.version,
      })
    })
  })

  it('leaves cross-method market prices explicitly null rather than treating them as zero or bottom prices', () => {
    const market = QL_FISH_HEAD_MASTER_ROWS.filter(isQlMarketPriceRow)
    expect(market.map(item => item.sourceRow)).toEqual([28, 34]) // source sheet rows #25 and #31
    expect(row('加晒/丁温/目孔(拖网)').proposed?.basePriceCentsPerKg).toBeNull()
    expect(row('朱力/拉仔/色拉/青兰/大目').proposed?.basePriceCentsPerKg).toBeNull()
    expect(row('大目力').proposed?.basePriceCentsPerKg).toBe(315)
    expect(previewFishHeadMasterImport([]).proposals.some(item => item.source.method === 'bottom')).toBe(false)
  })

  it('preserves exact existing fish ID and alias when the source is unambiguous', () => {
    const existing = species('金线', { id: 'jin_xian', speciesCode: 'jin_xian', aliases: ['旧本地称呼'] })
    const item = row('红丁/金线/大眼金鱼/红加', [existing])
    expect(item).toMatchObject({ status: 'matched', change: 'update', beforePriceCentsPerKg: 205 })
    expect(item.proposed).toMatchObject({ id: 'jin_xian', speciesCode: 'jin_xian', displayName: '金线', basePriceCentsPerKg: 210 })
    expect(item.proposed?.aliases).toEqual(expect.arrayContaining(['旧本地称呼','红丁','金线','大眼金鱼','红加']))
  })

  it.each(['丁温','目孔','青兰'])('protects existing generic %s from being assigned a conflicting source price', name => {
    const original = species(name, { basePriceCentsPerKg: 190 })
    const preview = previewFishHeadMasterImport([original])
    const matches = preview.proposals.filter(item => item.matches.length > 0)
    expect(matches).toHaveLength(1)
    expect(matches[0].status).toBe('conflict')
    expect(matches[0].proposed).toBeNull()
    expect(preview.retainedLegacyCount).toBe(1)
    expect(original.basePriceCentsPerKg).toBe(190)
  })

  it('allows an exact source-linked existing fish to keep an unset market price', () => {
    const market = QL_FISH_HEAD_MASTER_ROWS.find(item => item.method === 'trawl')!
    const old = species(market.label, { id: 'ql_trawl', speciesCode: 'ql_trawl',
      qlSourceRef: `${QL_SEED_VERSION.version}|${market.groupKey}:${market.method}`,
      basePriceCentsPerKg: null })
    const proposal = row(market.label, [old])
    expect(proposal.status).toBe('matched')
    expect(proposal.change).toBe('unchanged')
    expect(proposal.proposed?.basePriceCentsPerKg).toBeNull()
  })

  it('never maps bottom 加西 or expands slash abbreviations into unapproved aliases', () => {
    const existing = [species('加晒', { id:'jiasai',speciesCode:'jiasai' }),
      species('加西', {id:'jiaxi',speciesCode:'jiaxi'}),
      species('红', {id:'red',speciesCode:'red'}),
      species('中', {id:'middle',speciesCode:'middle'})]
    const preview = previewFishHeadMasterImport(existing)
    expect(preview.proposals.find(item=>item.source.method==='trawl')?.status).toBe('conflict')
    expect(preview.proposals.some(item=>item.source.label.includes('加西'))).toBe(false)
    expect(row('红/乌目林仔',existing).status).toBe('new')
    expect(row('中/白月仔/牛南',existing).status).toBe('new')
    expect(preview.retainedLegacyCount).toBe(4)
  })

  it('exposes duplicate aliases, codes and IDs without overwriting existing Master records', () => {
    const duplicates=[species('戈里仔/黄线仔/记仔',{id:'group',speciesCode:'group'}),
      species('黄线仔',{id:'alias',speciesCode:'alias'})]
    expect(row('戈里仔/黄线仔/记仔', duplicates)).toMatchObject({status:'conflict',change:'blocked',proposed:null})
    expect(previewFishHeadMasterImport(duplicates).retainedLegacyCount).toBe(2)
    for(const collision of [{id:'other',speciesCode:'same'},{id:'same',speciesCode:'other'}]){
      const item=row('大目力',[species('大目力',{id:'same',speciesCode:'same'}),species('旧品种',collision)])
      expect(item.status).toBe('conflict')
      expect(item.matches).toHaveLength(2)
    }
    const generated=row('大目力').proposed!
    expect(row('大目力',[species('旧品种',{id:generated.id,speciesCode:'other'})]).status).toBe('conflict')
  })

  it('does not reactivate disabled fish or mutate unrelated legacy entries', () => {
    const existing = [species('大目力',{active:false}),
      species('未列入QL的鱼',{id:'legacy',speciesCode:'legacy',basePriceCentsPerKg:999})]
    const original = structuredClone(existing)
    expect(row('大目力',existing).status).toBe('conflict')
    expect(previewFishHeadMasterImport(existing).retainedLegacyCount).toBe(2)
    expect(existing).toEqual(original)
  })

  it('is idempotent for 34 linked records, with unset defaults retained', () => {
    const first=previewFishHeadMasterImport([])
    const adopted=first.proposals.map((proposal,index)=>species(proposal.source.label,{
      ...proposal.proposed!,order:index+1,
      qlSourceRef:`${first.sourceVersion}|${proposal.proposalKey}`,
    }))
    const preview=previewFishHeadMasterImport(adopted)
    expect(preview).toEqual(previewFishHeadMasterImport(adopted))
    expect(preview).toMatchObject({matchedCount:34,newCount:0,changedCount:0,unchangedCount:34,conflictCount:0,retainedLegacyCount:0})
    expect(preview.proposals.map(item=>item.proposed)).toEqual(first.proposals.map(item=>item.proposed))
  })

  it('preserves a real explicit unset default on unrelated ordinary fish', () => {
    const existing=Object.freeze(species('大目力',{basePriceCentsPerKg:null}))
    expect(row('大目力',Object.freeze([existing]))).toMatchObject({
      beforePriceCentsPerKg:null,change:'update',proposed:{basePriceCentsPerKg:315}
    })
  })
})
