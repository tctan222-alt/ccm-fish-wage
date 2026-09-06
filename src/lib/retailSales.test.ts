import { describe, expect, it } from 'vitest'
import { makeRetailLine, MAX_RETAIL_LINES, normalizeRetailFish, prepareRetailSale, retailPriceCents, type RetailFish } from './retailSales'

const fish: RetailFish = { id: 'fish', chineseName: '甘丰', malayName: 'kembung', suggestedPriceCents: 600, active: true }
describe('retail cash calculations and snapshots', () => {
  it('uses exact integer cents and actual price, independently of future defaults', () => {
    const line = makeRetailLine(fish, '3', '6.15')
    const sale = prepareRetailSale({ businessDate: '06/09/2026', vendorName: ' 阿明 ', lines: [line, makeRetailLine(fish, '2', '8')] })
    expect(sale).toMatchObject({ vendorName: '阿明', dateSortKey: 20260906, totalAmountCents: 3445 })
    const changed = { ...fish, chineseName: '新鱼名', malayName: 'new', suggestedPriceCents: 900 }
    expect(makeRetailLine(changed, '1', '9').chineseName).toBe('新鱼名')
    expect(sale.lines[0]).toMatchObject({ chineseName: '甘丰', malayName: 'kembung', unitPriceCents: 615, amountCents: 1845 })
    line.amountCents = 0
    expect(sale.lines[0].amountCents).toBe(1845)
  })
  it('allows manual prices without a suggested price and an empty Malay translation', () => {
    expect(makeRetailLine({ ...fish, malayName: '', suggestedPriceCents: null }, '300', '0.01').amountCents).toBe(300)
    expect(normalizeRetailFish({ ...fish, suggestedPriceCents: null }).suggestedPriceCents).toBeNull()
  })
  it.each(['', '0', '-1', '0.001', '1e2', 'Infinity', '10000.01'])('rejects invalid price %s', value => {
    expect(() => retailPriceCents(value)).toThrow()
  })
  it.each(['0', '-1', '301', '1.5', '', '1e2'])('rejects invalid kg %s', value => {
    expect(() => makeRetailLine(fish, value, '6')).toThrow()
  })
  it('rejects inactive fish, invalid dates, missing vendor, empty and oversized sales, and tampered amounts', () => {
    const line = makeRetailLine(fish, '2', '6')
    const input = { businessDate: '06/09/2026', vendorName: '阿明', lines: [line] }
    expect(() => makeRetailLine({ ...fish, active: false }, '2', '6')).toThrow()
    expect(() => prepareRetailSale({ ...input, businessDate: '29/02/2026' })).toThrow()
    expect(() => prepareRetailSale({ ...input, vendorName: ' ' })).toThrow()
    expect(() => prepareRetailSale({ ...input, lines: [] })).toThrow()
    expect(() => prepareRetailSale({ ...input, lines: Array(MAX_RETAIL_LINES + 1).fill(line) })).toThrow()
    expect(() => prepareRetailSale({ ...input, lines: [{ ...line, amountCents: 1 }] })).toThrow()
  })
})
