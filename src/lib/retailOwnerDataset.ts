import { normalizeRetailFish, type RetailFish, type RetailFishInput } from './retailSales'
import { assertRetailFishUnique } from './retailFish'

// No OWNER literal batch is present in the repository or supplied attachments.
// Existing three starter rows are not a substitute for that batch.
export const retailOwnerDataset: readonly RetailFishInput[] | null = null
export const missingRetailOwnerDataset = 'Retail Master implementation completed; owner literal dataset source is unavailable, therefore no guessed seed was created.'

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
