import { businessDateFromLegacy } from './businessDate'
import { normalizeRetailLine, type RetailSale } from './retailSales'

export interface RetailVesselTotal {
  key: string
  label: string
  invoiceCount: number
  totalWeightDeciKg: number
  totalAmountCents: number
}
export interface RetailDailyReport {
  businessDate: string
  sales: RetailSale[]
  vessels: { key: string; label: string }[]
  vesselLabel: string
  invoiceCount: number
  totalWeightDeciKg: number
  totalAmountCents: number
  vesselTotals: RetailVesselTotal[]
}

const vesselKey = (sale: RetailSale) => sale.vesselId ? `id:${sale.vesselId}` : sale.vesselCodeSnapshot ? `legacy:${sale.vesselCodeSnapshot}` : 'missing'
const vesselName = (sale: RetailSale) => sale.vesselCodeSnapshot || (sale.vesselId ? `未命名船号 (${sale.vesselId})` : '未记录船号 Missing Vessel')
const signature = (sale: RetailSale) => JSON.stringify([sale.businessDate, sale.vendorName, sale.vesselId ?? '', sale.vesselCodeSnapshot ?? '', sale.invoiceNumber ?? '', sale.lines, sale.remark ?? '', sale.totalAmountCents])
function sum(a: number, b: number) {
  const value = a + b
  if (!Number.isSafeInteger(value)) throw new Error('销售汇总超出安全金额/重量范围，不能打印。 Report exceeds the safe numeric range.')
  return value
}
export function retailTotalWeight(deciKg: number): string {
  return `${Math.floor(deciKg / 10)}${deciKg % 10 ? `.${deciKg % 10}` : ''}`
}

/** Derived entirely from saved invoice snapshots; no master lookups or data writes. */
export function buildRetailDailyReport(input: readonly RetailSale[], date: string, selectedVessel = 'all'): RetailDailyReport {
  const businessDate = businessDateFromLegacy(date), unique = new Map<string, RetailSale>()
  for (const original of input) {
    if (businessDateFromLegacy(original.businessDate) !== businessDate) continue
    if (!original.id) throw new Error('销售单缺少身份，无法防止重复打印。 Missing invoice identity.')
    const lines = original.lines.map(normalizeRetailLine)
    const lineTotal = lines.reduce((total, line) => sum(total, line.amountCents), 0)
    if (!Number.isSafeInteger(original.totalAmountCents) || lineTotal !== original.totalAmountCents) throw new Error(`单据 ${original.invoiceNumber ?? original.id} 的总额与明细不一致，不能打印。 Invoice total does not match its saved lines.`)
    const sale = { ...original, businessDate, lines }, previous = unique.get(sale.id)
    if (previous && (previous.revision ?? 1) === (sale.revision ?? 1) && signature(previous) !== signature(sale)) throw new Error('同一单据版本存在冲突，刷新服务器记录后再打印。 Conflicting copies of an invoice.')
    if (!previous || (sale.revision ?? 1) > (previous.revision ?? 1)) unique.set(sale.id, sale)
  }
  const all = [...unique.values()].sort((a, b) => (a.invoiceNumber ?? a.id).localeCompare(b.invoiceNumber ?? b.id) || a.id.localeCompare(b.id))
  const labels = new Map<string, Set<string>>()
  for (const sale of all) {
    const key = vesselKey(sale), names = labels.get(key) ?? new Set<string>()
    names.add(vesselName(sale)); labels.set(key, names)
  }
  const vessels = [...labels].map(([key, names]) => ({ key, label: [...names].sort().join(' / ') + (key.startsWith('legacy:') ? '（旧单无船号ID）' : '') })).sort((a, b) => a.label.localeCompare(b.label))
  const selected = selectedVessel === 'all' ? all : all.filter(sale => vesselKey(sale) === selectedVessel)
  const vesselTotals = new Map<string, RetailVesselTotal>()
  let totalWeightDeciKg = 0, totalAmountCents = 0
  for (const sale of selected) {
    const key = vesselKey(sale), label = vessels.find(v => v.key === key)!.label
    const weight = sale.lines.reduce((total, line) => sum(total, line.weightDeciKg), 0)
    const total = vesselTotals.get(key) ?? { key, label, invoiceCount: 0, totalWeightDeciKg: 0, totalAmountCents: 0 }
    total.invoiceCount += 1; total.totalWeightDeciKg = sum(total.totalWeightDeciKg, weight); total.totalAmountCents = sum(total.totalAmountCents, sale.totalAmountCents)
    vesselTotals.set(key, total); totalWeightDeciKg = sum(totalWeightDeciKg, weight); totalAmountCents = sum(totalAmountCents, sale.totalAmountCents)
  }
  return { businessDate, sales: selected, vessels, vesselLabel: selectedVessel === 'all' ? '全部船号 All Vessels' : vessels.find(v => v.key === selectedVessel)?.label ?? '所选船号（本日无销售）', invoiceCount: selected.length, totalWeightDeciKg, totalAmountCents, vesselTotals: [...vesselTotals.values()] }
}
