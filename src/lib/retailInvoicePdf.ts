import { formatAuditTimestamp } from './businessDate'
import { retailMoney, retailWeightKg, type RetailSale } from './retailSales'

const PAGE_WIDTH = 794, PAGE_HEIGHT = 1123, SCALE = 2
const MARGIN = 40, RIGHT = PAGE_WIDTH - MARGIN, CONTENT_BOTTOM = PAGE_HEIGHT - 70
const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif'
const FISH_WIDTH = 330

function filenamePart(value: string): string {
  return Array.from(value).filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join('').replace(/[<>:"/\\|?*]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 100)
}

function wrapText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  // Names remain unchanged in the sale; embedded whitespace is spacing in the invoice.
  for (const character of Array.from(text.replace(/\s+/g, ' ').trim())) {
    if (line && context.measureText(line + character).width > width) {
      const space = line.lastIndexOf(' ')
      if (space > line.length / 2) {
        lines.push(line.slice(0, space))
        line = line.slice(space + 1) + character
      } else {
        lines.push(line.trimEnd())
        line = character.trimStart()
      }
    } else line += character
  }
  if (line || !lines.length) lines.push(line)
  return lines
}

/** Precompute before the share click, so file sharing retains Safari's user activation.
 * System fonts are rasterized locally to keep Chinese/Malay glyphs without remote font requests.
 * The resulting A4 PDF has 192 dpi page images; its text is not selectable.
 */
export async function createRetailInvoicePdf(sale: RetailSale): Promise<File> {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  pdf.setProperties({ title: `CCM 门市现金结算单 ${sale.businessDate}`, author: 'CCM Fishery' })
  // beginPage initializes both before any drawing; subsequent pages replace them together.
  let canvas!: HTMLCanvasElement, context!: CanvasRenderingContext2D
  let y = MARGIN, page = 0

  function font(size = 18, bold = false) {
    context.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`
  }

  function text(value: string, x: number, top: number, align: CanvasTextAlign = 'left') {
    context.textAlign = align
    context.fillText(value, x, top)
  }

  function paragraph(value: string, size = 18, lineHeight = 26) {
    font(size)
    for (const line of wrapText(context, value, RIGHT - MARGIN)) {
      text(line, MARGIN, y)
      y += lineHeight
    }
  }

  function rule(top: number) {
    context.beginPath(); context.moveTo(MARGIN, top); context.lineTo(RIGHT, top); context.stroke()
  }

  function tableHeader() {
    font(16, true)
    text('品名', MARGIN, y); text('kg', 463, y, 'right')
    text('RM/kg', 591, y, 'right'); text('金额 RM', RIGHT, y, 'right')
    y += 28
    rule(y); y += 12
  }

  function beginPage() {
    canvas = document.createElement('canvas')
    canvas.width = PAGE_WIDTH * SCALE; canvas.height = PAGE_HEIGHT * SCALE
    const canvasContext = canvas.getContext('2d')
    if (!canvasContext) throw new Error('无法创建 PDF 画布')
    context = canvasContext
    context.scale(SCALE, SCALE)
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)
    context.fillStyle = '#000000'; context.strokeStyle = '#a0a0a0'; context.lineWidth = 0.7
    context.textBaseline = 'top'
    y = MARGIN
    font(25, true); text('CCM Fishery 门市现金结算单', MARGIN, y); y += 42
    paragraph(`日期：${sale.businessDate}`)
    paragraph(`小贩：${sale.vendorName}`)
    if (sale.createdAt) paragraph(`结算时间：${formatAuditTimestamp(sale.createdAt)}`, 14, 22)
    paragraph(`单号：${sale.id}`, 13, 20)
    y += 12
    tableHeader()
  }

  function finishPage() {
    font(12)
    text(`内部 / 门市现金结算单 · 第 ${page + 1} 页`, MARGIN, PAGE_HEIGHT - MARGIN)
    if (page > 0) pdf.addPage()
    // JPEG keeps multi-page invoices small enough for phone sharing; no blob URL is involved.
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 210, 297)
    // Release each raster before allocating another page on memory-constrained phones.
    canvas.width = 1; canvas.height = 1
    page++
  }

  beginPage()
  for (const line of sale.lines) {
    font(18)
    const chinese = wrapText(context, line.chineseName, FISH_WIDTH)
    font(15)
    const malay = line.malayName ? wrapText(context, line.malayName, FISH_WIDTH) : []
    const rowHeight = Math.max(32, chinese.length * 25 + malay.length * 21 + 18)
    if (y + rowHeight > CONTENT_BOTTOM) { finishPage(); beginPage() }
    let fishY = y
    font(18)
    for (const value of chinese) { text(value, MARGIN, fishY); fishY += 25 }
    font(15)
    for (const value of malay) { text(value, MARGIN, fishY); fishY += 21 }
    font(17)
    text(retailWeightKg(line), 463, y, 'right')
    text((line.unitPriceCents / 100).toFixed(2), 591, y, 'right')
    text((line.amountCents / 100).toFixed(2), RIGHT, y, 'right')
    y += rowHeight
    rule(y - 8)
  }
  if (y + 70 > CONTENT_BOTTOM) { finishPage(); beginPage() }
  y += 16
  font(23, true)
  text('现金合计', MARGIN, y); text(retailMoney(sale.totalAmountCents), RIGHT, y, 'right')
  finishPage()
  const pdfBlob = pdf.output('blob')
  const filename = `CCM-Retail-${filenamePart(sale.businessDate)}-${filenamePart(sale.vendorName) || '未命名小贩'}.pdf`
  return new File([pdfBlob], filename, { type: 'application/pdf' })
}
