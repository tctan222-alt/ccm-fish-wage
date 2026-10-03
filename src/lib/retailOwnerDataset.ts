import { normalizeRetailFish, type RetailFish, type RetailFishInput } from './retailSales'
import { assertRetailFishUnique } from './retailFish'
import seed from '../data/retailFishSeed.json'

// OWNER batch confirmed 2026-10-03. Only existing Retail Malay names are retained.
export const retailOwnerDataset: readonly RetailFishInput[] = [...seed].sort((a, b) => a.sortOrder - b.sortOrder)
export const missingRetailOwnerDataset = 'OWNER dataset is empty; no import can be planned.'

/** Pure dry-run only. No Firestore dependency and no production write path. */
export function validateRetailOwnerDataset(rows: readonly RetailFishInput[] | null): RetailFishInput[] {
  if (!rows?.length) throw new Error(missingRetailOwnerDataset)
  const checked: RetailFish[] = []
  rows.forEach((row, index) => {
    if (row.chineseName.trim() === '黑昌') throw new Error('OWNER dataset 不可包含黑昌。 Dataset cannot contain 黑昌.')
    const clean = normalizeRetailFish(row)
    assertRetailFishUnique(null, clean, checked)
    checked.push({ ...clean, id: String(index) })
  })
  return checked.map(normalizeRetailFish)
}

export function planDeprecatedRetailNames(items: readonly RetailFish[]) {
  return items.filter(item => item.chineseName === '黑昌' && item.active || item.aliases?.includes('黑昌'))
    .map(item => ({ id: item.id, chineseName: item.chineseName,
      before: { active: item.active, aliases: item.aliases ?? [] },
      after: { active: item.chineseName === '黑昌' ? false : item.active, aliases: (item.aliases ?? []).filter(alias => alias !== '黑昌') } }))
}

/** Reviewable reconciliation proposal only; never writes to Firestore. */
export function planRetailOwnerReconciliation(items: readonly RetailFish[]) {
  const changes = [...seed].sort((a, b) => a.sortOrder - b.sortOrder).map(row => {
    const matches = items.filter(item => item.chineseName.trim() === row.chineseName)
    if (matches.length > 1) throw new Error(`鱼名重复，请先核对 Duplicate Retail fish: ${row.chineseName}`)
    const current = matches[0]
    if (!current && items.some(item => item.id === row.id)) throw new Error(`Seed ID conflict: ${row.id}`)
    const after = normalizeRetailFish({ ...row, malayName: current?.malayName ?? row.malayName, aliases: current?.aliases ?? [], active: true })
    return { id: current?.id ?? row.id, before: current ? normalizeRetailFish(current) : null, after }
  })
  const proposed = items.filter(item => !changes.some(change => change.id === item.id))
  for (const change of changes) {
    assertRetailFishUnique(change.id, change.after, proposed)
    proposed.push({ ...change.after, id: change.id })
  }
  return changes.filter(change => JSON.stringify(change.before) !== JSON.stringify(change.after))
}
