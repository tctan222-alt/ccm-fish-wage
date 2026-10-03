import { expect, it } from 'vitest'
import { planDeprecatedRetailNames, planRetailOwnerReconciliation, retailOwnerDataset, validateRetailOwnerDataset } from './retailOwnerDataset'

it('provides all 31 OWNER names, only the three confirmed Retail prices and six distinct 乌昌 names', () => {
  const rows = validateRetailOwnerDataset(retailOwnerDataset)
  expect(rows.map(row => row.chineseName)).toEqual(['来戈','金线','朱力','什鱼','戈里','肉江','丁温','成鱼','目力','代仔','红目林','白月','白竹占','大目','甘丰','马丰','上过','红介','白皂','红皂','竹加','马加','文冬','长里','水昌','大乌昌','乌昌','大中乌昌','中乌昌','乌昌仔','小乌昌仔'])
  expect(rows.filter(row => row.suggestedPriceCents !== null).map(row => [row.chineseName, row.suggestedPriceCents])).toEqual([['甘丰',600],['马丰',800],['上过',3300]])
  expect(rows.filter(row => row.chineseName.includes('乌昌'))).toHaveLength(6)
  expect(rows.some(row => ['黑昌','青兰'].includes(row.chineseName))).toBe(false)
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
it('plans 31 reviewable records, preserves existing Retail Malay/aliases/IDs, and is idempotent', () => {
  const existing = { id: 'production-id', chineseName: '金线', malayName: 'Retail Kerisi', suggestedPriceCents: 99999, active: true, aliases: ['金仙'] }
  const changes = planRetailOwnerReconciliation([existing])
  expect(changes).toHaveLength(31)
  expect(changes.find(change => change.id === existing.id)?.after).toMatchObject({ chineseName: '金线', malayName: 'Retail Kerisi', aliases: ['金仙'], suggestedPriceCents: null })
  expect(existing.suggestedPriceCents).toBe(99999)
  expect(planRetailOwnerReconciliation(changes.map(change => ({ ...change.after, id: change.id })))).toEqual([])
})
it('rejects ambiguous existing names and seed ID conflicts instead of overwriting another fish', () => {
  const row = { id: 'one', chineseName: '金线', malayName: '', suggestedPriceCents: null, active: true }
  expect(() => planRetailOwnerReconciliation([row, { ...row, id: 'two' }])).toThrow('重复')
  expect(() => planRetailOwnerReconciliation([{ ...row, id: 'initial-kembung', chineseName: '别鱼' }])).toThrow('conflict')
})
