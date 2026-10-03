vi.mock('../services/purchaseMasterData', () => ({ loadActiveVessels: async () => [{ id: 'v833', vesselCode: '833', active: true }, { id: 'v978', vesselCode: '978', active: true }] }))
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RetailEditPage, RetailHistoryPage, RetailSalesPage } from './RetailSalesPage'
import { prepareRetailSale, type RetailFish, type RetailSale } from '../lib/retailSales'

const service = vi.hoisted(() => ({ watch: vi.fn(), load: vi.fn(), update: vi.fn(), id: vi.fn(), quickAdd: vi.fn(), saveFish: vi.fn(), history: vi.fn(), save: vi.fn() }))
vi.mock('../services/retailSales', () => ({ watchRetailFish: service.watch, loadRetailSale: service.load, updateRetailSale: service.update, newRetailSaleId: service.id,
  quickAddRetailFish: service.quickAdd, saveRetailFish: service.saveFish, watchRetailSales: service.history, saveRetailSale: service.save,
  loadPendingRetailSale: () => null, rememberPendingRetailSale: vi.fn(), clearPendingRetailSale: vi.fn() }))
vi.mock('../lib/retailInvoicePdf', () => ({ createRetailInvoicePdf: async () => new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' }) }))
const created = Date.parse('2026-10-01T02:00:00Z'), day = 86400000
const fish: RetailFish[] = [{ id: 'original', chineseName: '最新鱼名', malayName: 'new Malay', aliases: ['旧称'], suggestedPriceCents: 99900, active: true },
  { id: 'replacement', chineseName: '马丰', malayName: 'mabong', aliases: ['马鱼'], suggestedPriceCents: 705, active: true }]
const original: RetailSale = { id: 'original-sale', invoiceNumber: '03102026001', invoiceSequence: 1, revision: 1, businessDate: '03/10/2026', dateSortKey: 20261003,
  vendorName: '阿明', remark: '原备注', createdAt: { toDate: () => new Date(created) },
  lines: [{ fishId: 'original', chineseName: '历史甘丰', malayName: 'old Malay', weightDeciKg: 20, unitPriceCents: 615, amountCents: 1230 }], totalAmountCents: 1230 }
function mount(page = <RetailEditPage />, route = '/retail-sales/history/:saleId/edit') {
  return render(<MemoryRouter initialEntries={['/retail-sales/history/original-sale/edit']}><Routes><Route path={route} element={page} /></Routes></MemoryRouter>)
}
function fill(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }
async function editReady() { mount(); return screen.findByLabelText('小贩 Vendor') }
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(created + day)
  service.watch.mockImplementation(next => { next(fish); return vi.fn() })
  service.load.mockResolvedValue(original); service.id.mockReturnValue('edit-operation')
  service.update.mockImplementation(async (id, input) => ({ ...original, ...prepareRetailSale(input), id, revision: 2 }))
  service.quickAdd.mockImplementation(async input => ({ id: 'new-fish', ...input }))
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Retail 30-day editing', () => {
  it('allows a vessel change within 30 days using the same invoice update and original revision', async () => {
    service.load.mockResolvedValue({ ...original, vesselId: 'v833', vesselCodeSnapshot: '833' })
    await editReady(); await screen.findByRole('option', { name: '978' }); fill('船号 Vessel', 'v978')
    fireEvent.click(screen.getByRole('button', { name: '保存修改 Save Changes' }))
    await screen.findByText('修改已保存。 Changes saved.')
    expect(service.update).toHaveBeenCalledWith(original.id, expect.objectContaining({ vesselId: 'v978', vesselCodeSnapshot: '978' }), 1, 'edit-operation', [0])
    expect(service.save).not.toHaveBeenCalled()
  })
  it('retains inactive historical vessel snapshots and permits unrelated edits without reselecting', async () => {
    service.load.mockResolvedValue({ ...original, vesselId: 'retired', vesselCodeSnapshot: '历史船' })
    await editReady(); expect(screen.getByLabelText('船号 Vessel')).toHaveValue('retired')
    fill('小贩 Vendor', '新小贩'); fireEvent.click(screen.getByRole('button', { name: '保存修改 Save Changes' }))
    await screen.findByText('修改已保存。 Changes saved.')
    expect(service.update.mock.calls[0][1]).toMatchObject({ vesselId: 'retired', vesselCodeSnapshot: '历史船' })
  })
  it('loads saved snapshots and price without applying later Master changes and keeps identity read-only', async () => {
    await editReady()
    expect(screen.getByLabelText('中文鱼名 Chinese Fish Name 1')).toHaveValue('历史甘丰')
    expect(screen.getByLabelText('马来文名 Malay Name 1')).toHaveValue('old Malay')
    expect(screen.getByLabelText('单价 Unit Price (RM/kg) 1')).toHaveValue('6.15')
    expect(screen.getByText('03102026001')).toBeInTheDocument()
    expect(screen.getByText('日期 Date：03102026 星期六 Sat')).toBeInTheDocument()
    expect(screen.queryByLabelText('日期 Date')).not.toBeInTheDocument()
  })
  it('edits the same invoice with unchanged half-up calculation and remark, without writing Master', async () => {
    await editReady(); fill('小贩 Vendor', '新小贩'); fill('中文鱼名 Chinese Fish Name 1', '修正名'); fill('马来文名 Malay Name 1', 'corrected')
    fill('重量 Weight (kg) 1', '12.5'); fill('单价 Unit Price (RM/kg) 1', '7.05'); fill('备注 Remark', '已核对')
    fireEvent.click(screen.getByRole('button', { name: '保存修改 Save Changes' }))
    await screen.findByText('修改已保存。 Changes saved.')
    expect(service.update).toHaveBeenCalledWith(original.id, expect.objectContaining({ businessDate: original.businessDate, vendorName: '新小贩', remark: '已核对', totalAmountCents: 8813,
      lines: [expect.objectContaining({ chineseName: '修正名', malayName: 'corrected', weightDeciKg: 125, unitPriceCents: 705, amountCents: 8813 })] }), 1, 'edit-operation', [0])
    expect(service.save).not.toHaveBeenCalled(); expect(service.saveFish).not.toHaveBeenCalled(); expect(service.quickAdd).not.toHaveBeenCalled()
  })
  it('searches aliases through the P9 picker and only a changed fish gets its current default price', async () => {
    await editReady(); fireEvent.click(screen.getByRole('button', { name: '替换鱼种 Change Fish 1' })); fill('鱼名 Fish', '旧称')
    fireEvent.keyDown(screen.getByRole('combobox', { name: '鱼名 Fish' }), { key: 'Enter' })
    expect(screen.getByLabelText('单价 Unit Price (RM/kg) 1')).toHaveValue('6.15')
    fireEvent.click(screen.getByRole('button', { name: '替换鱼种 Change Fish 1' })); fill('鱼名 Fish', '马鱼')
    fireEvent.keyDown(screen.getByRole('combobox', { name: '鱼名 Fish' }), { key: 'Enter' })
    expect(screen.getByLabelText('中文鱼名 Chinese Fish Name 1')).toHaveValue('马丰')
    expect(screen.getByLabelText('马来文名 Malay Name 1')).toHaveValue('mabong')
    expect(screen.getByLabelText('单价 Unit Price (RM/kg) 1')).toHaveValue('7.05')
  })
  it('renders inactive historical fish but never offers an inactive replacement', async () => {
    service.watch.mockImplementation(next => { next(fish.map(item => ({ ...item, active: false }))); return vi.fn() })
    await editReady(); expect(screen.getByLabelText('中文鱼名 Chinese Fish Name 1')).toHaveValue('历史甘丰')
    fireEvent.click(screen.getByRole('button', { name: '替换鱼种 Change Fish 1' })); fill('鱼名 Fish', '马鱼')
    expect(screen.queryByRole('option', { name: /马丰/ })).not.toBeInTheDocument()
    expect(screen.getByText(/此鱼种已停用/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存修改 Save Changes' })); await screen.findByText('修改已保存。 Changes saved.')
    expect(service.update.mock.calls[0][1].lines).toEqual(original.lines)
  })
  it('keeps replacement provenance when selecting away and back to the original fish ID', async () => {
    await editReady()
    for (const query of ['马鱼', '旧称']) {
      fireEvent.click(screen.getByRole('button', { name: '替换鱼种 Change Fish 1' })); fill('鱼名 Fish', query)
      fireEvent.keyDown(screen.getByRole('combobox', { name: '鱼名 Fish' }), { key: 'Enter' })
    }
    expect(screen.getByLabelText('中文鱼名 Chinese Fish Name 1')).toHaveValue('最新鱼名')
    expect(screen.getByLabelText('单价 Unit Price (RM/kg) 1')).toHaveValue('999.00')
    fireEvent.click(screen.getByRole('button', { name: '保存修改 Save Changes' }))
    await screen.findByText('修改已保存。 Changes saved.')
    expect(service.update.mock.calls[0][4]).toEqual([-1])
  })
  it('reuses Other quick-add without nested forms and still snapshots the official name', async () => {
    const view = await editReady(); expect(view).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '加入鱼种 Add Fish' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '加入鱼种 Add Fish' })); fireEvent.click(screen.getByRole('button', { name: '其他 Other' }))
    fill('新鱼中文正式名 New Fish Chinese Name', '新鱼'); fill('建议单价（可空） Suggested Price (RM/kg, Optional)', '8')
    expect(document.querySelector('form form')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '保存并使用新鱼 Save and Use Fish' }))
    await waitFor(() => expect(screen.getByLabelText('中文鱼名 Chinese Fish Name 2')).toHaveValue('新鱼'))
    fill('重量 Weight (kg) 2', '1'); fireEvent.click(screen.getByRole('button', { name: '保存修改 Save Changes' }))
    await screen.findByText('修改已保存。 Changes saved.')
    expect(service.update.mock.calls[0][1].lines[1]).toMatchObject({ fishId: 'new-fish', chineseName: '新鱼', unitPriceCents: 800 })
  })
  it.each([30 * day, 30 * day + 1000])('locks at age %s but retains View/Print/PDF and the original number', async age => {
    vi.setSystemTime(created + age); mount()
    await screen.findByText(/已超过 30 天修改期限/)
    expect(screen.queryByRole('button', { name: '保存修改 Save Changes' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打印 Print' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PDF / 分享 PDF / Share' })).toBeInTheDocument()
    expect(service.update).not.toHaveBeenCalled()
  })
  it('allows the last second and handles an expiry while the page stays open without extending createdAt', async () => {
    vi.setSystemTime(created + 30 * day - 1000); await editReady()
    vi.setSystemTime(created + 30 * day); fireEvent.focus(window)
    expect(screen.getByText(/已超过 30 天修改期限/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存修改 Save Changes' })).not.toBeInTheDocument()
  })
  it('rearms a 30-day deadline beyond the browser timer integer limit instead of overflowing the timeout', async () => {
    vi.useRealTimers(); vi.useFakeTimers(); vi.setSystemTime(created)
    await act(async () => { mount() })
    expect(screen.getByRole('button', { name: '保存修改 Save Changes' })).toBeEnabled()
    await act(async () => { vi.advanceTimersByTime(2147483647) })
    expect(screen.getByRole('button', { name: '保存修改 Save Changes' })).toBeEnabled()
    await act(async () => { vi.advanceTimersByTime(30 * day - 2147483647) })
    expect(screen.getByText(/已超过 30 天修改期限/)).toBeInTheDocument()
  })
  it('shows a server expiry rejection even if the client clock still allows editing', async () => {
    service.update.mockRejectedValue(new Error('已超过 30 天修改期限，服务器拒绝保存'))
    await editReady(); fireEvent.click(screen.getByRole('button', { name: '保存修改 Save Changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('服务器拒绝保存')
    expect(screen.getByRole('button', { name: '重试修改 Retry Update' })).toBeEnabled()
  })
  it('shows stale revision error and reloads rather than silently overwriting', async () => {
    service.update.mockRejectedValue(new Error('此结算单已在其他装置修改，请重新载入。'))
    await editReady(); fireEvent.click(screen.getByRole('button', { name: '保存修改 Save Changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('已在其他装置修改')
    service.load.mockResolvedValue({ ...original, revision: 2, vendorName: '其他装置' })
    fireEvent.click(screen.getByRole('button', { name: /重新载入（放弃/ }))
    await waitFor(() => expect(screen.getByLabelText('小贩 Vendor')).toHaveValue('其他装置'))
  })
  it('freezes a failed operation for retry, without creating a new operation or another sale', async () => {
    service.update.mockRejectedValueOnce(new Error('网络中断')).mockResolvedValueOnce({ ...original, revision: 2 })
    await editReady(); fireEvent.click(screen.getByRole('button', { name: '保存修改 Save Changes' }))
    await screen.findByRole('alert'); expect(screen.getByLabelText('小贩 Vendor')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重试修改 Retry Update' })); await screen.findByText('修改已保存。 Changes saved.')
    expect(service.update.mock.calls[1]).toEqual(service.update.mock.calls[0]); expect(service.id).toHaveBeenCalledTimes(1)
  })
  it('fails closed for a missing trusted timestamp and uses legacy ID fallback without creating a number', async () => {
    service.load.mockResolvedValue({ ...original, createdAt: undefined, invoiceNumber: undefined, revision: undefined })
    mount(); await screen.findByText(/无法确认首次保存时间/)
    expect(screen.getByText('单号 Invoice No.：original-sale')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存修改 Save Changes' })).not.toBeInTheDocument()
    expect(service.update).not.toHaveBeenCalled()
  })
  it('shows the same date and formal number in history with an Edit entry only while eligible', async () => {
    service.history.mockImplementation((_range, next) => { next({ sales: [original, { ...original, id: 'expired', createdAt: { toDate: () => new Date(created - 31 * day) } }], fromCache: false }); return vi.fn() })
    mount(<RetailHistoryPage />, '*')
    expect(screen.getAllByText('03102026 星期六 Sat')).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: /编辑 Edit 03102026001/ })).toHaveLength(1)
    expect(screen.getAllByText('单号 No. 03102026001')).toHaveLength(2)
  })
  it('entry overlays the native date control with Malaysia civil-date presentation and supports remark', () => {
    mount(<RetailSalesPage />, '*')
    fill('日期 Date', '2026-10-03'); expect(screen.getByText('03102026 星期六 Sat')).toBeInTheDocument()
    expect(screen.getByLabelText('日期 Date')).toHaveValue('2026-10-03')
    expect(screen.getByLabelText('备注 Remark')).toHaveAttribute('maxlength', '500')
  })
})
