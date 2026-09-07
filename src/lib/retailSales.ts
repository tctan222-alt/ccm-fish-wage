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
  weightDeciKg: number
  unitPriceCents: number
  amountCents: number
}
// Legacy snapshots are read and normalized in memory; persisted history is immutable.
export type RetailLineInput = RetailLine | (Omit<RetailLine, 'weightDeciKg'> & { weightKg: number; weightDeciKg?: never })
export interface RetailSaleInput {
  businessDate: string
  vendorName: string
  lines: RetailLineInput[]
}
export interface RetailSale extends Omit<RetailSaleInput, 'lines'> {
  id: string
  lines: RetailLine[]
  dateSortKey: number
  totalAmountCents: number
  createdAt?: { toDate: () => Date }
}

export function retailPriceCents(value: string): number {
  const clean = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) throw new Error('售价须为正数，最多两位小数。 Enter a positive price with up to two decimal places.')
  const [whole, fraction = ''] = clean.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > MAX_RETAIL_PRICE_CENTS) throw new Error('售价须在 RM0.01 至 RM10,000.00 之间。 Price must be between RM0.01 and RM10,000.00.')
  return cents
}

export function retailMoney(cents: number): string {
  return `RM${(cents / 100).toFixed(2)}`
}

export function normalizeRetailFish(input: RetailFishInput): RetailFishInput {
  const chineseName = input.chineseName.trim(), malayName = input.malayName.trim()
  if (!chineseName || chineseName.length > 100) throw new Error('请输入中文鱼名（最多 100 字）。 Enter a Chinese fish name (up to 100 characters).')
  if (malayName.length > 100) throw new Error('马来文名称最多 100 字。 Malay name must be no longer than 100 characters.')
  if (typeof input.active !== 'boolean') throw new Error('鱼种状态无效。 Invalid fish status.')
  if (input.suggestedPriceCents !== null && (!Number.isSafeInteger(input.suggestedPriceCents)
    || input.suggestedPriceCents < 1 || input.suggestedPriceCents > MAX_RETAIL_PRICE_CENTS)) throw new Error('建议售价无效。 Invalid suggested price.')
  return { chineseName, malayName, suggestedPriceCents: input.suggestedPriceCents, active: input.active }
}

export function makeRetailLine(fish: RetailFish, weight: string, price: string): RetailLine {
  if (!fish.active) throw new Error('此鱼种已停用，请选择其他鱼种。 This fish is inactive. Please select another fish.')
  const cleanWeight = weight.trim()
  if (!/^\d+(\.\d)?$/.test(cleanWeight)) throw new Error('重量须为 0.1–300 kg，最多一位小数。 Weight must be 0.1–300 kg with up to one decimal place.')
  const [whole, fraction = '0'] = cleanWeight.split('.')
  const weightDeciKg = Number(whole) * 10 + Number(fraction)
  if (!Number.isSafeInteger(weightDeciKg) || weightDeciKg < 1 || weightDeciKg > 3000) throw new Error('重量须为 0.1–300 kg，最多一位小数。 Weight must be 0.1–300 kg with up to one decimal place.')
  const unitPriceCents = retailPriceCents(price)
  return { fishId: fish.id, chineseName: fish.chineseName, malayName: fish.malayName, weightDeciKg, unitPriceCents, amountCents: Math.floor((weightDeciKg * unitPriceCents + 5) / 10) }
}

export function retailWeightKg(line: RetailLine): string {
  const fraction = line.weightDeciKg % 10
  return `${Math.floor(line.weightDeciKg / 10)}${fraction ? `.${fraction}` : ''}`
}

export function normalizeRetailLine(line: RetailLineInput): RetailLine {
  const weightDeciKg = 'weightKg' in line
    ? (line.weightDeciKg === undefined && Number.isInteger(line.weightKg) ? line.weightKg * 10 : NaN)
    : line.weightDeciKg
  if (!line.fishId || line.fishId.length > 100 || !line.chineseName.trim() || line.chineseName.length > 100 || line.malayName.length > 100
    || !Number.isSafeInteger(weightDeciKg) || weightDeciKg < 1 || weightDeciKg > 3000
    || !Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents < 1 || line.unitPriceCents > MAX_RETAIL_PRICE_CENTS
    || line.amountCents !== Math.floor((weightDeciKg * line.unitPriceCents + 5) / 10)) throw new Error('销售明细或金额无效，请重新录入。 Invalid sale details or amount. Please enter them again.')
  return { fishId: line.fishId, chineseName: line.chineseName, malayName: line.malayName, weightDeciKg, unitPriceCents: line.unitPriceCents, amountCents: line.amountCents }
}

export function prepareRetailSale(input: RetailSaleInput): Omit<RetailSale, 'id' | 'createdAt'> {
  const businessDate = input.businessDate.trim(), vendorName = input.vendorName.trim()
  assertBusinessDate(businessDate)
  if (!vendorName || vendorName.length > 100) throw new Error('请输入小贩名（最多 100 字）。 Enter a vendor name (up to 100 characters).')
  if (!input.lines.length || input.lines.length > MAX_RETAIL_LINES) throw new Error(`每单须有 1–${MAX_RETAIL_LINES} 条明细。 Each sale must have 1–${MAX_RETAIL_LINES} lines.`)
  const lines = input.lines.map(normalizeRetailLine)
  return { businessDate, vendorName, lines, dateSortKey: sortKeyFromBusinessDate(businessDate), totalAmountCents: lines.reduce((sum, line) => sum + line.amountCents, 0) }
}

export const retailToday = () => malaysiaBusinessDate()
