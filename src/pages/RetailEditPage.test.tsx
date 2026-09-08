import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RetailEditPage, RetailHistoryPage, RetailReceiptPage, RetailSalesPage } from './RetailSalesPage'
import { makeRetailLine, prepareRetailSale, type RetailFish, type RetailSale } from '../lib/retailSales'
import { RETAIL_EDIT_WINDOW_MS } from '../lib/retailInvoice'

const service = vi.hoisted(() => ({ detail: vi.fn(), update: vi.fn(), create: vi.fn(), saveFish: vi.fn(), quickAdd: vi.fn(), watchFish: vi.fn(), watchSales: vi.fn(), id: vi.fn() }))
vi.mock('../services/retailSales', () => ({
  loadRetailSale: service.detail, updateRetailSale: service.update, saveRetailSale: service.create,
  saveRetailFish: service.saveFish, quickAddRetailFish: service.quickAdd, watchRetailFish: service.watchFish, watchRetailSales: service.watchSales,
  newRetailSaleId: service.id, loadPendingRetailSale: vi.fn(() => null), rememberPendingRetailSale: vi.fn(), clearPendingRetailSale: vi.fn(), initializeRetailFish: vi.fn(),
}))
vi.mock('../lib/retailInvoicePdf', () => ({ createRetailInvoicePdf: vi.fn(async () => new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' })) }))
const now = Date.parse('2026-09-08T04:00:00Z')
const fish: RetailFish[] = [{ id: 'fish', chineseName: '金线', malayName: 'Kerisi', suggestedPriceCents: 600, active: true }, { id: 'other', chineseName: '马丰', malayName: 'Mabong', suggestedPriceCents: 800, active: true }]
let invoice: RetailSale
function mount(path = '/retail-sales/history/invoice/edit') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/retail-sales" element={<RetailSalesPage />} /><Route path="/retail-sales/history" element={<RetailHistoryPage />} />
    <Route path="/retail-sales/history/:saleId" element={<RetailReceiptPage />} /><Route path="/retail-sales/history/:saleId/edit" element={<RetailEditPage />} />
  </Routes></MemoryRouter>)
}
function fill(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now)
  invoice = { id: 'invoice', invoiceNumber: '08092026001', businessDate: '08/09/2026', dateSortKey: 20260908, vendorName: '阿明', remark: '原备注', totalAmountCents: 1200, revision: 1, createdAt: { toDate: () => new Date(now - 60 * 60 * 1000) }, lines: [makeRetailLine(fish[0], '2', '6')] }
  service.detail.mockImplementation(async () => invoice)
  service.watchFish.mockImplementation(next => { next(fish); return vi.fn() })
  service.watchSales.mockImplementation((_range, next) => { next({ sales: [invoice], fromCache: false }); return vi.fn() })
  service.id.mockReturnValue('operation-1')
  service.update.mockImplementation(async (id, input, revision) => { invoice = { ...invoice, ...prepareRetailSale(input), id, revision: revision + 1 }; return invoice })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('saved Retail invoice editing', () => {
  it('loads the original snapshots with immutable saved date and invoice number', async () => {
    invoice.lines[0] = { ...invoice.lines[0], chineseName: '旧金线', malayName: 'Old Kerisi', unitPriceCents: 700, amountCents: 1400 }
    mount()
    expect(await screen.findByLabelText('中文鱼名 Chinese Fish Name 1')).toHaveValue('旧金线')
    expect(screen.getByLabelText('马来文名 Malay Name 1')).toHaveValue('Old Kerisi')
    expect(screen.getByLabelText('单价 Unit Price (RM/kg) 1')).toHaveValue('7.00')
    expect(screen.getByText('08092026001')).toBeInTheDocument()
    expect(screen.getByText('日期 Date：08092026 星期二 Tue')).toBeInTheDocument()
    expect(screen.queryByLabelText('日期 Date')).not.toBeInTheDocument()
    expect(document.querySelector('input[type=date]')).toBeNull()
  })
  it('updates the existing invoice, recalculates amounts, increments revision and leaves Master Data unchanged', async () => {
    const initialCreatedAt = invoice.createdAt
    mount(); await screen.findByLabelText('小贩 Vendor')
    fill('小贩 Vendor', '阿华'); fill('中文鱼名 Chinese Fish Name 1', '当天金线'); fill('马来文名 Malay Name 1', 'Kerisi baru')
    fill('重量 Weight (kg) 1', '7.3'); fill('单价 Unit Price (RM/kg) 1', '8'); fill('备注 Remark', '更正重量')
    expect(screen.getAllByText('RM58.40')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '保存修改 Save Changes' }))
    expect(await screen.findByText('修改已保存。 Changes saved.')).toBeInTheDocument()
    expect(service.update).toHaveBeenCalledWith('invoice', expect.objectContaining({ businessDate: '08/09/2026', vendorName: '阿华', remark: '更正重量', lines: [expect.objectContaining({ chineseName: '当天金线', malayName: 'Kerisi baru', weightDeciKg: 73, unitPriceCents: 800, amountCents: 5840 })] }), 1, 'operation-1')
    expect(invoice).toMatchObject({ id: 'invoice', invoiceNumber: '08092026001', revision: 2 }); expect(invoice.createdAt).toBe(initialCreatedAt)
    expect(service.create).not.toHaveBeenCalled(); expect(service.saveFish).not.toHaveBeenCalled(); expect(service.quickAdd).not.toHaveBeenCalled()
    expect(fish[0].chineseName).toBe('金线')
    fireEvent.click(screen.getByRole('link', { name: '返回销售历史 Back to Sales History' }))
    expect(await screen.findByRole('link', { name: /View Invoice.*阿华 RM58.40/ })).toBeInTheDocument()
  })
  it('can change species, add and remove items while retaining current-invoice snapshot overrides', async () => {
    mount(); const species = await screen.findByLabelText('鱼种 Fish Species 1')
    await within(species).findByRole('option', { name: '马丰 · Mabong' })
    fill('鱼种 Fish Species 1', 'other')
    expect(screen.getByLabelText('中文鱼名 Chinese Fish Name 1')).toHaveValue('马丰')
    expect(screen.getByLabelText('马来文名 Malay Name 1')).toHaveValue('Mabong')
    expect(screen.getByLabelText('单价 Unit Price (RM/kg) 1')).toHaveValue('8.00')
    fill('加入鱼种 Add Fish', 'fish'); fireEvent.click(screen.getByRole('button', { name: '加入明细 Add Item' }))
    fill('重量 Weight (kg) 2', '12.5'); fill('单价 Unit Price (RM/kg) 2', '6.15')
    fireEvent.click(screen.getByRole('button', { name: '移除第 1 条明细 Remove Item 1' }))
    expect(screen.getByLabelText('重量 Weight (kg) 1')).toHaveValue('12.5')
    fireEvent.click(screen.getByRole('button', { name: '保存修改 Save Changes' }))
    await screen.findByText('修改已保存。 Changes saved.')
    expect(service.update.mock.calls[0][1].lines).toEqual([expect.objectContaining({ fishId: 'fish', weightDeciKg: 125, unitPriceCents: 615, amountCents: 7688 })])
  })
  it('keeps invalid decimal weights editable and prevents update until corrected', async () => {
    mount(); await screen.findByLabelText('重量 Weight (kg) 1')
    fill('重量 Weight (kg) 1', '80.55'); fireEvent.click(screen.getByRole('button', { name: '保存修改 Save Changes' }))
    expect(screen.getByRole('alert')).toHaveTextContent('最多一位小数')
    expect(service.update).not.toHaveBeenCalled()
    expect(screen.getByLabelText('重量 Weight (kg) 1')).toBeEnabled()
    fill('重量 Weight (kg) 1', '80.5'); fireEvent.click(screen.getByRole('button', { name: '保存修改 Save Changes' }))
    await screen.findByText('修改已保存。 Changes saved.')
  })
  it('retries an uncertain update with the same operation, input and revision without duplicate submit', async () => {
    let reject: (error: Error) => void = () => {}
    service.update.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    mount(); await screen.findByLabelText('小贩 Vendor'); fill('小贩 Vendor', '阿华')
    fireEvent.click(screen.getByRole('button', { name: '保存修改 Save Changes' }))
    expect(screen.getByRole('button', { name: '正在保存… Saving…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '正在保存… Saving…' }))
    expect(service.update).toHaveBeenCalledOnce()
    await act(async () => reject(new Error('连接中断，请重试。 Connection interrupted.')))
    expect(screen.getByRole('alert')).toHaveTextContent('连接中断')
    expect(screen.getByLabelText('小贩 Vendor')).toBeDisabled()
    const first = service.update.mock.calls[0]
    fireEvent.click(screen.getByRole('button', { name: '重试修改 Retry Update' }))
    await screen.findByText('修改已保存。 Changes saved.')
    expect(service.update.mock.calls[1]).toEqual(first)
    expect(service.id).toHaveBeenCalledOnce()
  })
  it('shows a revision conflict and explicitly reloads the latest invoice before another edit', async () => {
    service.update.mockRejectedValueOnce(Object.assign(new Error('结算单已被其他人修改，请重新载入。 Invoice changed. Reload.'), { code: 'retail/conflict' }))
    mount(); await screen.findByLabelText('小贩 Vendor'); fill('小贩 Vendor', '未保存名字')
    fireEvent.click(screen.getByRole('button', { name: '保存修改 Save Changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('已被其他人修改')
    invoice = { ...invoice, vendorName: '另一台设备', revision: 2 }
    fireEvent.click(screen.getByRole('button', { name: '重新载入（放弃未保存修改） Reload Invoice (Discard Unsaved Changes)' }))
    await waitFor(() => expect(screen.getByLabelText('小贩 Vendor')).toHaveValue('另一台设备'))
    expect(screen.getByLabelText('小贩 Vendor')).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '保存修改 Save Changes' }))
    await screen.findByText('修改已保存。 Changes saved.')
    expect(service.update.mock.calls[1][2]).toBe(2)
  })
  it.each([RETAIL_EDIT_WINDOW_MS, RETAIL_EDIT_WINDOW_MS + 1])('locks at creation age %i ms and retains native print and PDF actions', async age => {
    invoice.createdAt = { toDate: () => new Date(now - age) }
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    mount()
    expect(await screen.findByText('已超过 3 天编辑期限 / Editing period expired')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存修改 Save Changes' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '门市现金结算单' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '打印 Print' })); expect(print).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' })).toBeInTheDocument()
    expect(service.update).not.toHaveBeenCalled()
  })
  it('uses createdAt rather than the selected business date, and hides Edit for unverifiable legacy time', async () => {
    invoice.businessDate = '01/01/2020'; invoice.createdAt = { toDate: () => new Date(now - 1) }
    const view = mount('/retail-sales/history/invoice')
    expect(await screen.findByRole('link', { name: '编辑 Edit' })).toBeInTheDocument()
    view.unmount(); invoice.createdAt = undefined
    mount('/retail-sales/history/invoice')
    expect(await screen.findByText(/无法确认首次保存时间/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '编辑 Edit' })).not.toBeInTheDocument()
  })
  it('removes history Edit at the actual deadline while still mounted', async () => {
    vi.useRealTimers(); vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(now)
    invoice.createdAt = { toDate: () => new Date(now - RETAIL_EDIT_WINDOW_MS + 1000) }
    mount('/retail-sales/history')
    expect(screen.getByRole('link', { name: '编辑 Edit 08092026001 阿明' })).toBeInTheDocument()
    await act(async () => vi.advanceTimersByTime(1000))
    expect(screen.queryByRole('link', { name: /编辑 Edit/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /查看结算单 View Invoice/ })).toBeInTheDocument()
  })
  it('locks an open edit form after foreground resume at expiry and makes no request', async () => {
    mount(); await screen.findByLabelText('小贩 Vendor')
    vi.setSystemTime(now + RETAIL_EDIT_WINDOW_MS)
    fireEvent(window, new Event('focus'))
    expect(screen.getByText('已超过 3 天编辑期限 / Editing period expired')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存修改 Save Changes' })).not.toBeInTheDocument()
    expect(service.update).not.toHaveBeenCalled()
  })
  it('shows new-invoice and range dates through the same visible formatter', () => {
    const view = mount('/retail-sales')
    expect(screen.getByText('08092026 星期二 Tue')).toBeInTheDocument()
    fill('日期 Date', '2026-09-09'); expect(screen.getByText('09092026 星期三 Wed')).toBeInTheDocument()
    view.unmount(); mount('/retail-sales/history')
    fireEvent.click(screen.getByRole('button', { name: '范围 Range' }))
    expect(within(screen.getByRole('region', { name: '历史筛选 History Filters' })).getAllByText('08092026 星期二 Tue')).toHaveLength(2)
  })
  it('offers Edit immediately after the first successful checkout', async () => {
    service.create.mockResolvedValue(invoice)
    mount('/retail-sales'); fill('小贩 Vendor', '阿明')
    fireEvent.click(screen.getByRole('option', { name: '金线 Kerisi RM6.00/kg' }))
    fill('重量 Weight (kg)', '2'); fireEvent.click(screen.getByRole('button', { name: '加入明细 Add Item' }))
    fireEvent.click(screen.getByRole('button', { name: '结算 Checkout' }))
    expect(await screen.findByRole('link', { name: '编辑 Edit' })).toHaveAttribute('href', '/retail-sales/history/invoice/edit')
    expect(screen.getByRole('button', { name: '打印 Print' })).toBeInTheDocument()
  })
})
