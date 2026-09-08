import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RetailReceipt, RetailReceiptActions } from './RetailReceipt'
import { createRetailInvoicePdf } from '../lib/retailInvoicePdf'
import type { RetailSale } from '../lib/retailSales'
import { formatRetailAuditTimestamp, formatRetailDate } from '../lib/retailDate'
import { readFileSync } from 'node:fs'

const retailCss = readFileSync('src/pages/retailSales.css', 'utf8')

vi.mock('../lib/retailInvoicePdf', () => ({ createRetailInvoicePdf: vi.fn() }))
const sale: RetailSale = { id: 'receipt-1', businessDate: '07/09/2026', dateSortKey: 20260907, vendorName: '阿明', totalAmountCents: 5840, lines: [{ fishId: 'fish', chineseName: '历史鱼名', malayName: 'old name', weightDeciKg: 73, unitPriceCents: 800, amountCents: 5840 }] }
const file = new File(['%PDF-1.4'], '门市现金结算单-07092026 星期一 Mon-阿明.pdf', { type: 'application/pdf' })
const generate = vi.mocked(createRetailInvoicePdf)
const share = vi.fn(), canShare = vi.fn(), createUrl = vi.fn(), revokeUrl = vi.fn()

async function ready() {
  render(<RetailReceiptActions sale={sale} />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' })).toBeEnabled())
}
beforeEach(() => {
  generate.mockReset().mockResolvedValue(file)
  share.mockReset().mockResolvedValue(undefined); canShare.mockReset().mockReturnValue(true)
  createUrl.mockReset().mockReturnValue('blob:receipt'); revokeUrl.mockReset()
  Object.defineProperties(navigator, { share: { value: share, configurable: true }, canShare: { value: canShare, configurable: true } })
  Object.defineProperties(URL, { createObjectURL: { value: createUrl, configurable: true }, revokeObjectURL: { value: revokeUrl, configurable: true } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Retail invoice output', () => {
  it('shares the prepared PDF File synchronously in the click and restores controls after completion', async () => {
    let complete!: () => void
    share.mockReturnValue(new Promise<void>(resolve => { complete = resolve }))
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' }))
    // No awaiting generation, timeout or popup before this assertion.
    expect(canShare).toHaveBeenCalledWith({ files: [file] })
    expect(share).toHaveBeenCalledWith({ files: [file], title: '门市现金结算单 · 阿明' })
    expect(screen.getByRole('status')).toHaveTextContent('正在分享 PDF')
    expect(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' })).toBeDisabled()
    expect(createUrl).not.toHaveBeenCalled()
    await act(async () => complete())
    expect(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' })).toBeEnabled()
  })
  it.each(['canShare false', 'share missing', 'canShare missing'])('shows explicit fallback when %s', async mode => {
    if (mode === 'canShare false') canShare.mockReturnValue(false)
    else Object.defineProperty(navigator, mode === 'share missing' ? 'share' : 'canShare', { value: undefined, configurable: true })
    await ready(); fireEvent.click(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' }))
    expect(screen.getByRole('button', { name: '打开 PDF Open PDF' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '下载 PDF Download PDF' })).toHaveAttribute('download', file.name)
    expect(screen.getByRole('status')).toHaveTextContent('不支持')
    expect(share).not.toHaveBeenCalled()
    expect(createUrl).toHaveBeenCalledWith(file)
  })
  it('does not report an error when the user cancels the Share Sheet', async () => {
    share.mockRejectedValue(new DOMException('Cancelled', 'AbortError'))
    await ready(); fireEvent.click(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' })).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开 PDF Open PDF' })).not.toBeInTheDocument()
  })
  it('also lets file-sharing browsers explicitly open or download their PDF', async () => {
    await ready(); fireEvent.click(screen.getByRole('button', { name: '其他 PDF 选项 More PDF Options' }))
    expect(screen.getByRole('button', { name: '打开 PDF Open PDF' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '下载 PDF Download PDF' })).toHaveAttribute('href', 'blob:receipt')
    expect(share).not.toHaveBeenCalled()
  })
  it.each(['share rejected', 'share threw', 'canShare threw'])('shows a Chinese error and fallback when %s', async mode => {
    if (mode === 'share rejected') share.mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'))
    else if (mode === 'share threw') share.mockImplementation(() => { throw new TypeError('Bad file') })
    else canShare.mockImplementation(() => { throw new TypeError('Unsupported') })
    await ready(); fireEvent.click(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF 分享失败')
    expect(screen.getByRole('button', { name: '打开 PDF Open PDF' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' })).toBeEnabled()
  })
  it('lets printing work during PDF generation and calls window.print without a popup', async () => {
    generate.mockReturnValue(new Promise(() => {}))
    const print = vi.spyOn(window, 'print').mockImplementation(() => {}), open = vi.spyOn(window, 'open')
    render(<RetailReceiptActions sale={sale} />)
    expect(screen.getByRole('status')).toHaveTextContent('正在准备 PDF')
    expect(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '打印 Print' }))
    expect(print).toHaveBeenCalledOnce(); expect(open).not.toHaveBeenCalled()
    expect(screen.getByText(/已请求系统打印/)).toBeInTheDocument()
  })
  it('reports print exceptions on the page', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => { throw new Error('Printing unavailable') })
    await ready(); fireEvent.click(screen.getByRole('button', { name: '打印 Print' }))
    expect(screen.getByRole('alert')).toHaveTextContent('无法打开系统打印界面')
  })
  it('offers retry after PDF generation failure', async () => {
    generate.mockRejectedValueOnce(new Error('Canvas unavailable'))
    render(<RetailReceiptActions sale={sale} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF 生成失败，请重试')
    fireEvent.click(screen.getByRole('button', { name: '重新生成 PDF Regenerate PDF' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' })).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('does not share a stale PDF when the invoice changes during preparation', async () => {
    let old!: (file: File) => void
    generate.mockReturnValueOnce(new Promise<File>(resolve => { old = resolve }))
    const next = { ...sale, id: 'next', vendorName: '阿华' }
    const nextFile = new File(['%PDF-1.4'], 'next.pdf', { type: 'application/pdf' })
    generate.mockResolvedValueOnce(nextFile)
    const view = render(<RetailReceiptActions sale={sale} />)
    view.rerender(<RetailReceiptActions sale={next} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' })).toBeEnabled())
    await act(async () => old(file))
    fireEvent.click(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' }))
    expect(share).toHaveBeenCalledWith({ files: [nextFile], title: '门市现金结算单 · 阿华' })
    await act(async () => {})
  })
  it('reports a blocked PDF popup, and retains an opened URL across receipt navigation', async () => {
    canShare.mockReturnValue(false)
    const replace = vi.fn(), viewer = { opener: window, location: { replace } }
    const open = vi.spyOn(window, 'open').mockReturnValueOnce(null).mockReturnValueOnce(viewer as unknown as Window)
    await ready(); fireEvent.click(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' }))
    fireEvent.click(screen.getByRole('button', { name: '打开 PDF Open PDF' }))
    expect(screen.getByRole('alert')).toHaveTextContent('PDF 打开被浏览器拦截')
    fireEvent.click(screen.getByRole('button', { name: '打开 PDF Open PDF' }))
    expect(open).toHaveBeenLastCalledWith('', '_blank')
    expect(replace).toHaveBeenCalledWith('blob:receipt'); expect(viewer.opener).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    cleanup(); expect(revokeUrl).not.toHaveBeenCalled()
  })
  it('releases unused fallback URLs and reports URL creation exceptions', async () => {
    canShare.mockReturnValue(false)
    await ready(); fireEvent.click(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' }))
    cleanup(); expect(revokeUrl).toHaveBeenCalledWith('blob:receipt')
    createUrl.mockImplementation(() => { throw new Error('URL unavailable') })
    await ready(); fireEvent.click(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' }))
    expect(screen.getByRole('alert')).toHaveTextContent('无法准备 PDF')
  })
  it('renders only stored invoice values and excludes controls from print layout', async () => {
    await ready(); render(<RetailReceipt sale={sale} />)
    expect(screen.getByRole('heading', { name: '门市现金结算单' })).toBeInTheDocument()
    expect(screen.queryByText(/CCM Fishery/)).not.toBeInTheDocument()
    expect(screen.getByText(`日期 Date：${formatRetailDate(sale.businessDate)}`)).toBeInTheDocument()
    expect(screen.getByText('单号 Invoice No.：receipt-1')).toBeInTheDocument()
    expect(screen.getByText('小贩 Vendor：阿明')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['鱼名 Fish', '重量 Weight (kg)', '单价 Unit Price (RM/kg)', '金额 Amount (RM)'])
    expect(screen.getByRole('cell', { name: '历史鱼名 old name' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '7.3' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '58.40' })).toBeInTheDocument()
    expect(screen.getByText('RM58.40')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打印 Print' }).closest('.retail-no-print')).not.toBeNull()
    const printRules = retailCss.slice(retailCss.indexOf('@media print'))
    expect(printRules).toContain('.retail-no-print,.retail-page>.retail-no-print{display:none!important}')
    expect(printRules).toContain('.retail-page:has(>.retail-receipt)>:not(.retail-receipt){display:none!important}')
    expect(printRules).toContain('break-inside:avoid')
  })

  it('renders the issued number and edited remark without substituting the document ID', () => {
    const createdAt = { toDate: () => new Date('2026-09-07T04:30:00Z') }
    render(<RetailReceipt sale={{ ...sale, invoiceNumber: '07092026001', createdAt, remark: '现金已收' }} />)
    expect(screen.getByText('单号 Invoice No.：07092026001')).toBeInTheDocument()
    expect(screen.queryByText(/receipt-1/)).not.toBeInTheDocument()
    expect(screen.getByText('备注 Remark：现金已收')).toBeInTheDocument()
    expect(screen.getByText(`结算时间 Checkout Time：${formatRetailAuditTimestamp(createdAt)}`)).toBeInTheDocument()
    expect(screen.getByText(`日期 Date：${formatRetailDate(sale.businessDate)}`)).toBeInTheDocument()
  })
})
