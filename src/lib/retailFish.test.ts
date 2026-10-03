import { describe, expect, it } from 'vitest'
import { normalizeRetailFish, type RetailFish } from './retailSales'
import { assertRetailFishUnique, nextRetailFishOrder, searchRetailFish, sortRetailFish } from './retailFish'

const fish: RetailFish = { id: 'one', chineseName: '金线', malayName: 'Kerisi', suggestedPriceCents: 205, active: true }
describe('Retail Master compatibility and identity', () => {
  it.each([
    ['金线', ['one']], ['金', ['one']], ['线', ['one']], ['Kerisi', ['one']], ['KERI', ['one']],
    ['risi', ['one']], ['金仙', ['one']], ['仙', ['one']], ['', ['one']], ['不存在', []],
  ])('searches %s without inventing an identity', (query, ids) => {
    expect(searchRetailFish([{ ...fish, aliases: ['金仙'] }], query).map(item => item.id)).toEqual(ids)
  })
  it('normalizes old documents without requiring a migration', () => {
    expect(normalizeRetailFish(fish)).toMatchObject({ aliases: [], sortOrder: 0 })
    expect(fish).not.toHaveProperty('aliases')
  })
  it('trims and deduplicates aliases and permits optional Malay/price', () => {
    expect(normalizeRetailFish({ ...fish, malayName: '', suggestedPriceCents: null, aliases: [' 金仙 ', '', '金仙'], sortOrder: 3 })).toMatchObject({ aliases: ['金仙'], malayName: '', suggestedPriceCents: null, sortOrder: 3 })
  })
  it.each([{ aliases: ['金线'] }, { aliases: ['黑昌'] }, { aliases: ['x'.repeat(101)] }, { aliases: Array.from({ length: 6 }, (_, i) => String(i)) }])('rejects invalid aliases %j', ({ aliases }) => {
    expect(() => normalizeRetailFish({ ...fish, aliases })).toThrow()
  })
  it.each([-1, 0.5, 1000001, NaN])('rejects invalid order %s', sortOrder => {
    expect(() => normalizeRetailFish({ ...fish, sortOrder })).toThrow()
  })
  it('rejects 黑昌 without collapsing any 乌昌 variant', () => {
    expect(() => normalizeRetailFish({ ...fish, chineseName: '黑昌' })).toThrow()
    for (const chineseName of ['大乌昌', '乌昌', '大中乌昌', '中乌昌', '乌昌仔', '小乌昌仔']) expect(normalizeRetailFish({ ...fish, chineseName }).chineseName).toBe(chineseName)
  })
  it('sorts deterministically and allocates the next order', () => {
    const items = [{ ...fish, id: 'z', sortOrder: 2 }, { ...fish, id: 'a' }]
    expect(sortRetailFish(items).map(item => item.id)).toEqual(['a', 'z'])
    expect(nextRetailFishOrder(items)).toBe(3)
  })
  it('blocks official/alias identity collisions, including inactive identities, but allows shared Malay names', () => {
    expect(() => assertRetailFishUnique(null, { ...fish, chineseName: '金仙' }, [{ ...fish, active: false, aliases: ['金仙'] }])).toThrow(/停用/)
    expect(() => assertRetailFishUnique(null, { ...fish, chineseName: '新鱼', aliases: ['金线'] }, [fish])).toThrow(/重复/)
    expect(() => assertRetailFishUnique('one', fish, [fish])).not.toThrow()
    expect(() => assertRetailFishUnique(null, { ...fish, chineseName: '另鱼' }, [fish])).not.toThrow()
  })
  it('blocks official/alias versus Malay cross-field collisions while permitting shared Malay names', () => {
    expect(() => assertRetailFishUnique(null, { ...fish, chineseName: '新鱼', aliases: ['Kerisi'] }, [fish])).toThrow(/重复/)
    expect(() => assertRetailFishUnique(null, { ...fish, chineseName: 'Kerisi', malayName: '' }, [fish])).toThrow(/重复/)
    expect(() => assertRetailFishUnique(null, { ...fish, chineseName: '新鱼', malayName: '金线' }, [fish])).toThrow(/重复/)
    expect(() => assertRetailFishUnique(null, { ...fish, chineseName: '新鱼', malayName: 'Kerisi' }, [fish])).not.toThrow()
  })
  it('matches Chinese, Malay and aliases in ranked order with stable order ties', () => {
    const items = [{ ...fish, id: 'alias', chineseName: '另一鱼', malayName: '', aliases: ['金线'] }, fish, { ...fish, id: 'prefix', chineseName: '金线仔' }]
    expect(searchRetailFish(items, '金线').map(item => item.id)).toEqual(['one', 'alias', 'prefix'])
    expect(searchRetailFish([fish], 'kerisi')).toEqual([fish])
    expect(searchRetailFish([{ ...fish, aliases: ['金仙'] }], '金仙')[0].chineseName).toBe('金线')
    expect(searchRetailFish([{ ...fish, active: false }], '金线')).toEqual([])
  })
})
