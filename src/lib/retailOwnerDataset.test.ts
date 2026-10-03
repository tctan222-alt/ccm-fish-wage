import { expect, it } from 'vitest'
import { missingRetailOwnerDataset, planDeprecatedRetailNames, retailOwnerDataset, validateRetailOwnerDataset } from './retailOwnerDataset'

it('blocks an import when the OWNER literal batch is unavailable, including the three-starter substitution', () => {
  expect(retailOwnerDataset).toBeNull()
  expect(() => validateRetailOwnerDataset(retailOwnerDataset)).toThrow(missingRetailOwnerDataset)
})
it('only proposes deactivation and alias removal, retaining IDs and source objects', () => {
  const item = { id: 'legacy', chineseName: '黑昌', malayName: '', suggestedPriceCents: null, active: true, aliases: ['旧称'] }
  const other = { ...item, id: 'other', chineseName: '乌昌', aliases: ['黑昌', '旧称'] }
  expect(planDeprecatedRetailNames([item, other])).toEqual([
    { id: 'legacy', chineseName: '黑昌', before: { active: true, aliases: ['旧称'] }, after: { active: false, aliases: ['旧称'] } },
    { id: 'other', chineseName: '乌昌', before: { active: true, aliases: ['黑昌', '旧称'] }, after: { active: true, aliases: ['旧称'] } },
  ])
  expect(item.active).toBe(true)
  expect(other.aliases).toEqual(['黑昌', '旧称'])
})
