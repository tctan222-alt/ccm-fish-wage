import { assertBusinessDate, malaysiaBusinessDate, sortKeyFromBusinessDate } from './businessDate'

export const MAX_RETAIL_LINES = 20
export const MAX_RETAIL_PRICE_CENTS = 1_000_000

export interface RetailFishInput {
  chineseName: string
  malayName: string
  suggestedPriceCents: number | null
  active: boolean
}
export interface RetailFish extends RetailFishInput { id: string }
export interface RetailLine {
  fishId: string
  chineseName: string
  malayName: string
  weightKg: number
  unitPriceCents: number
  amountCents: number
}
export interface RetailSaleInput {
  businessDate: string
  vendorName: string
  lines: RetailLine[]
}
export interface RetailSale extends RetailSaleInput {
  id: string
  dateSortKey: number
  totalAmountCents: number
  createdAt?: { toDate: () => Date }
}

export function retailPriceCents(value: string): number {
  const clean = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) throw new Error('售价须为正数，最多两位小数。')
  const [whole, fraction = ''] = clean.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > MAX_RETAIL_PRICE_CENTS) throw new Error('售价须在 RM0.01 至 RM10,000.00 之间。')
  return cents
}

export function retailMoney(cents: number): string {
  return `RM${(cents / 100).toFixed(2)}`
}

export function normalizeRetailFish(input: RetailFishInput): RetailFishInput {
  const chineseName = input.chineseName.trim(), malayName = input.malayName.trim()
  if (!chineseName || chineseName.length > 100) throw new Error('请输入中文鱼名（最多 100 字）。')
  if (malayName.length > 100) throw new Error('马来文名称最多 100 字。')
  if (typeof input.active !== 'boolean') throw new Error('鱼种状态无效。')
  if (input.suggestedPriceCents !== null && (!Number.isSafeInteger(input.suggestedPriceCents)
    || input.suggestedPriceCents < 1 || input.suggestedPriceCents > MAX_RETAIL_PRICE_CENTS)) throw new Error('建议售价无效。')
  return { chineseName, malayName, suggestedPriceCents: input.suggestedPriceCents, active: input.active }
}

export function makeRetailLine(fish: RetailFish, weight: string, price: string): RetailLine {
  if (!fish.active) throw new Error('此鱼种已停用，请选择其他鱼种。')
  if (!/^\d+$/.test(weight.trim()) || Number(weight) < 1 || Number(weight) > 300) throw new Error('重量须为 1–300 整数 kg。')
  const unitPriceCents = retailPriceCents(price), weightKg = Number(weight)
  return { fishId: fish.id, chineseName: fish.chineseName, malayName: fish.malayName, weightKg, unitPriceCents, amountCents: weightKg * unitPriceCents }
}

export function prepareRetailSale(input: RetailSaleInput): Omit<RetailSale, 'id' | 'createdAt'> {
  const businessDate = input.businessDate.trim(), vendorName = input.vendorName.trim()
  assertBusinessDate(businessDate)
  if (!vendorName || vendorName.length > 100) throw new Error('请输入小贩名（最多 100 字）。')
  if (!input.lines.length || input.lines.length > MAX_RETAIL_LINES) throw new Error(`每单须有 1–${MAX_RETAIL_LINES} 条明细。`)
  const lines = input.lines.map(line => {
    if (!line.fishId || line.fishId.length > 100 || !line.chineseName.trim() || line.chineseName.length > 100 || line.malayName.length > 100
      || !Number.isInteger(line.weightKg) || line.weightKg < 1 || line.weightKg > 300
      || !Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents < 1 || line.unitPriceCents > MAX_RETAIL_PRICE_CENTS
      || line.amountCents !== line.weightKg * line.unitPriceCents) throw new Error('销售明细或金额无效，请重新录入。')
    return { fishId: line.fishId, chineseName: line.chineseName, malayName: line.malayName, weightKg: line.weightKg, unitPriceCents: line.unitPriceCents, amountCents: line.amountCents }
  })
  return { businessDate, vendorName, lines, dateSortKey: sortKeyFromBusinessDate(businessDate), totalAmountCents: lines.reduce((sum, line) => sum + line.amountCents, 0) }
}

export const retailToday = () => malaysiaBusinessDate()
