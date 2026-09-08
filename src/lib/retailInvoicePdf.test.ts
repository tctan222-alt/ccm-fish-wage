import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRetailInvoicePdf } from './retailInvoicePdf'
import type { RetailSale } from './retailSales'
import { formatRetailDate, formatRetailAuditTimestamp } from './retailDate'

const sample: RetailSale = {
  id: 'retail-sample', businessDate: '07/09/2026', dateSortKey: 20260907, vendorName: '小贩阿明',
  lines: [{ fishId: 'fish', chineseName: '金线', malayName: 'Ikan kerisi', weightDeciKg: 805, unitPriceCents: 600, amountCents: 48300 }],
  totalAmountCents: 48300,
}
const pixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4XmP4DwQACfsD/YcUtbcAAAAASUVORK5CYII='
type DrawnText = { text: string; x: number; y: number; page: number }
let drawn: DrawnText[], pageSizes: Array<[number, number]>

function readPdf(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new TextDecoder('latin1').decode(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

beforeEach(() => {
  drawn = []; pageSizes = []
  let canvasCount = 0
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    const page = canvasCount++
    const context = {
      font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textBaseline: 'top', textAlign: 'left',
      scale: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      measureText(text: string) {
        const fontSize = Number(/(\d+)px/.exec(context.font)?.[1] ?? 18)
        return { width: Array.from(text).reduce((sum, char) => sum + fontSize * (char.charCodeAt(0) > 255 ? 1 : 0.55), 0) }
      },
      fillText(text: string, x: number, y: number) { drawn.push({ text, x, y, page }) },
    }
    return context as unknown as CanvasRenderingContext2D
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
    pageSizes.push([this.width, this.height])
    return pixelPng
  })
})
afterEach(() => vi.restoreAllMocks())

describe('retail invoice PDF', () => {
  it('produces a real PDF File with application/pdf MIME and a .pdf name', async () => {
    const file = await createRetailInvoicePdf(sample)
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('application/pdf')
    expect(file.name).toBe('门市现金结算单-07092026 星期一 Mon-小贩阿明.pdf')
    const pdf = await readPdf(file)
    expect(pdf.startsWith('%PDF-')).toBe(true)
    expect(pdf).toContain('/Type /Page')
    expect(pdf).toContain('%%EOF')
    expect(pdf).not.toContain('CCM')
    expect(pageSizes).toEqual([[1588, 2246]])
    expect(drawn.map(item => item.text)).toEqual(expect.arrayContaining(['门市现金结算单', `日期 Date：${formatRetailDate(sample.businessDate)}`, '小贩 Vendor：小贩阿明', '单号 Invoice No.：retail-sample', '鱼名 Fish', '重量 Weight (kg)', '单价 Price/kg', '金额 Amount (RM)', '现金合计 Cash Total']))
    expect(drawn.some(item => item.text.includes('CCM'))).toBe(false)
    expect(drawn.map(item => item.text)).toEqual(expect.arrayContaining(['金线', 'Ikan kerisi', '80.5', '6.00', '483.00', 'RM483.00']))
  })

  it('removes filename path/control characters while retaining the vendor and PDF extension', async () => {
    const file = await createRetailInvoicePdf({ ...sample, vendorName: '阿明/鱼档:*?\n' })
    expect(file.name).toMatch(/^门市现金结算单-07092026 星期一 Mon-阿明-鱼档-+\.pdf$/)
    expect(file.name).not.toMatch(/[\\/:*?<>|\n]/)
  })

  it('prints the stored amount and total without recalculation or mutation', async () => {
    const sale = { ...sample, lines: [{ ...sample.lines[0], amountCents: 7777 }], totalAmountCents: 9999 }
    const before = JSON.stringify(sale)
    Object.freeze(sale.lines[0]); Object.freeze(sale.lines); Object.freeze(sale)
    await createRetailInvoicePdf(sale)
    expect(drawn.map(item => item.text)).toEqual(expect.arrayContaining(['77.77', 'RM99.99']))
    expect(JSON.stringify(sale)).toBe(before)
  })

  it('renders the immutable invoice number, saved remark and shared timestamp format', async () => {
    const createdAt = { toDate: () => new Date('2026-09-07T04:30:00Z') }
    await createRetailInvoicePdf({ ...sample, invoiceNumber: '07092026001', createdAt, remark: '现金已收' })
    expect(drawn.map(item => item.text)).toEqual(expect.arrayContaining([
      '单号 Invoice No.：07092026001', '备注 Remark：现金已收',
      `日期 Date：${formatRetailDate(sample.businessDate)}`,
      `结算时间 Checkout Time：${formatRetailAuditTimestamp(createdAt)}`,
    ]))
    expect(drawn.some(item => item.text.includes('retail-sample'))).toBe(false)
  })

  it('keeps a long saved remark inside the page boundaries', async () => {
    await createRetailInvoicePdf({ ...sample, remark: '备注内容'.repeat(250) })
    expect(drawn.map(item => item.text).join('')).toContain('备注 Remark：')
    expect(drawn.filter(item => item.text.includes('备注内容')).map(item => item.text).join('').match(/备注内容/g)).toHaveLength(250)
    expect(drawn.every(item => item.y >= 0 && item.y < 1100)).toBe(true)
  })

  it('wraps long names and paginates all 20 rows, with the total kept on the final page', async () => {
    const sale = { ...sample, vendorName: '长'.repeat(100), lines: Array.from({ length: 20 }, (_, index) => ({
      ...sample.lines[0], fishId: `fish-${index}`, chineseName: String(index).padStart(2, '0') + '鱼'.repeat(98),
      malayName: 'Ikan panjang '.repeat(7) + 'sembilan',
    })) }
    const pdf = await readPdf(await createRetailInvoicePdf(sale))
    expect(pageSizes.length).toBeGreaterThan(1)
    expect((pdf.match(/\/Type \/Page\b/g) ?? []).length).toBe(pageSizes.length)
    for (let index = 0; index < 20; index++) {
      expect(drawn.some(item => item.text.startsWith(`${String(index).padStart(2, '0')}鱼`))).toBe(true)
    }
    expect(drawn.filter(item => item.text === '80.5')).toHaveLength(20)
    expect(drawn.every(item => item.y >= 0 && item.y < 1100)).toBe(true)
    expect(drawn.find(item => item.text === 'RM483.00')?.page).toBe(pageSizes.length - 1)
  })

  it('rejects an unavailable canvas so the caller can show a generation error', async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
    await expect(createRetailInvoicePdf(sample)).rejects.toThrow('无法创建 PDF 画布')
  })

  it('treats embedded whitespace as display spacing so a historical name cannot create an oversized row', async () => {
    await createRetailInvoicePdf({ ...sample, vendorName: '阿\n'.repeat(50), lines: [{
      ...sample.lines[0], chineseName: '鱼\n'.repeat(50), malayName: 'I\n'.repeat(50),
    }] })
    expect(pageSizes).toHaveLength(1)
    expect(drawn.every(item => item.y < 1100)).toBe(true)
    expect(drawn.map(item => item.text).join('')).toContain('鱼 鱼 鱼')
  })
})
