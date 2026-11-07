import { describe, expect, it } from 'vitest'
import { buildRetailDailyReport } from './retailDailyReport'
import { makeRetailLine, type RetailSale } from './retailSales'

const fish = { id: 'fish', chineseName: '金线', malayName: 'Kerisi', suggestedPriceCents: 600, active: true }
const sale = (id: string, changes: Partial<RetailSale> = {}): RetailSale => ({ id, businessDate: '07/11/2026', dateSortKey: 20261107, vendorName: '阿明', lines: [makeRetailLine(fish, '0.1', '0.05', '次')], totalAmountCents: 1, revision: 1, ...changes })

describe('daily Retail print snapshots', () => {
  it('filters saved business dates and vessel IDs, preserves missing vessels, and sums integer amounts and weights', () => {
    const items = [sale('a', { vesselId: 'v833', vesselCodeSnapshot: '833' }), sale('b', { vesselId: 'v978', vesselCodeSnapshot: '978' }), sale('missing'), sale('old-day', { businessDate: '06/11/2026' })]
    const original = structuredClone(items)
    const all = buildRetailDailyReport(items, '07/11/2026')
    expect(all).toMatchObject({ invoiceCount: 3, totalWeightDeciKg: 3, totalAmountCents: 3 })
    expect(all.vesselTotals.map(row => row.invoiceCount)).toEqual([1, 1, 1])
    expect(all.vessels).toContainEqual({ key: 'missing', label: '未记录船号 Missing Vessel' })
    expect(buildRetailDailyReport(items, '07/11/2026', 'id:v978')).toMatchObject({ invoiceCount: 1, totalWeightDeciKg: 1, totalAmountCents: 1, vesselLabel: '978' })
    expect(buildRetailDailyReport(items, '07/11/2026', 'missing').sales[0].id).toBe('missing')
    expect(items).toEqual(original)
  })
  it('deduplicates one invoice, chooses its newer revision and rejects conflicting copies at one revision', () => {
    const old = sale('a'), newer = sale('a', { revision: 2, vendorName: '修改小贩' })
    expect(buildRetailDailyReport([old, newer, newer], '07/11/2026')).toMatchObject({ invoiceCount: 1, totalAmountCents: 1, sales: [{ vendorName: '修改小贩' }] })
    expect(() => buildRetailDailyReport([old, sale('a', { vendorName: '冲突' })], '07/11/2026')).toThrow('冲突')
  })
  it('groups by saved identity while distinguishing legacy codes and missing identities', () => {
    const items = [sale('a', { vesselId: 'stable', vesselCodeSnapshot: '旧船名' }), sale('b', { vesselId: 'stable', vesselCodeSnapshot: '新船名' }), sale('c', { vesselCodeSnapshot: '旧船名' })]
    const report = buildRetailDailyReport(items, '07/11/2026')
    expect(report.vessels).toHaveLength(2)
    expect(report.vesselTotals.find(row => row.key === 'id:stable')).toMatchObject({ invoiceCount: 2, totalAmountCents: 2 })
    expect(report.vessels.find(row => row.key === 'id:stable')?.label).toContain('旧船名')
    expect(report.vessels.find(row => row.key === 'id:stable')?.label).toContain('新船名')
    expect(report.vessels.find(row => row.key === 'legacy:旧船名')?.label).toContain('旧单无船号ID')
  })
  it('does not print tampered amounts or a partial total and keeps saved line remarks', () => {
    expect(buildRetailDailyReport([sale('ok')], '07/11/2026').sales[0].lines[0].remark).toBe('次')
    expect(() => buildRetailDailyReport([sale('bad', { totalAmountCents: 2 })], '07/11/2026')).toThrow('总额与明细不一致')
    const tampered = sale('bad-line'); tampered.lines[0].amountCents = 100
    expect(() => buildRetailDailyReport([tampered], '07/11/2026')).toThrow('明细或金额无效')
  })
})
