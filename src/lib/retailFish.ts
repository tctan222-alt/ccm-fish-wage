import type { RetailFish, RetailFishInput } from './retailSales'

const key = (value: string) => value.trim().toLocaleLowerCase()
const identities = (fish: RetailFishInput) => [fish.chineseName, ...(fish.aliases ?? [])].map(key)
export const retailFishOrder = (fish: RetailFishInput) => fish.sortOrder ?? 0
export function sortRetailFish(items: RetailFish[]): RetailFish[] {
  return [...items].sort((a, b) => retailFishOrder(a) - retailFishOrder(b)
    || a.chineseName.localeCompare(b.chineseName, 'zh-Hans-CN') || a.id.localeCompare(b.id))
}
export function nextRetailFishOrder(items: RetailFish[]): number {
  const next = Math.max(0, ...items.map(retailFishOrder)) + 1
  if (next > 1_000_000) throw new Error('排序已达上限，请在鱼种管理调整。 Order limit reached; adjust Master Data.')
  return next
}
export function exactRetailFishIdentity(items: RetailFish[], query: string): RetailFish[] {
  return items.filter(item => identities(item).includes(key(query)))
}
export function assertRetailFishUnique(id: string | null, input: RetailFishInput, items: RetailFish[]) {
  const names = identities(input)
  const malay = key(input.malayName)
  const duplicate = items.find(item => item.id !== id && (
    identities(item).some(name => names.includes(name) || !!malay && name === malay)
    || !!item.malayName.trim() && names.includes(key(item.malayName))))
  if (duplicate) throw new Error(duplicate.active
    ? `鱼名或别名重复：${duplicate.chineseName}。请选择已有鱼种。 Duplicate fish identity; use the existing fish.`
    : `鱼种已停用：${duplicate.chineseName}。请到鱼种管理重新启用，不要重复新增。 Fish is inactive; reactivate it in Master Data.`)
}
export function exactRetailSearchMatches(items: RetailFish[], query: string): RetailFish[] {
  const keyword = key(query)
  return keyword ? items.filter(item => item.active && [...identities(item), key(item.malayName)].includes(keyword)) : []
}
export function searchRetailFish(items: RetailFish[], query: string): RetailFish[] {
  const keyword = key(query)
  if (keyword === '黑昌') return []
  const rank = (fish: RetailFish) => {
    const names = [fish.chineseName, fish.malayName, ...(fish.aliases ?? [])].map(key).filter(Boolean)
    if (!keyword) return 0
    if (key(fish.chineseName) === keyword) return 0
    if (fish.malayName && key(fish.malayName) === keyword) return 1
    if ((fish.aliases ?? []).some(alias => key(alias) === keyword)) return 2
    if (names.some(name => name.startsWith(keyword))) return 3
    return names.some(name => name.includes(keyword)) ? 4 : 5
  }
  return sortRetailFish(items.filter(item => item.active && item.chineseName !== '黑昌' && rank(item) < 5))
    .sort((a, b) => rank(a) - rank(b))
}
