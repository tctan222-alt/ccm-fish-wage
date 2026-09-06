import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RetailFishPage, RetailHistoryPage, RetailReceiptPage, RetailSalesPage } from './RetailSalesPage'
import { prepareRetailSale, type RetailFish, type RetailSale } from '../lib/retailSales'
import { legacyIsoDateFromBusinessDate } from '../lib/businessDate'
import { retailToday } from '../lib/retailSales'

const services = vi.hoisted(() => ({ watch: vi.fn(), save: vi.fn(), saveFish: vi.fn(), initialize: vi.fn(), history: vi.fn(), detail: vi.fn(), id: vi.fn(), restore: vi.fn(), remember: vi.fn(), clear: vi.fn() }))
vi.mock('../services/retailSales', () => ({ watchRetailFish: services.watch, saveRetailSale: services.save, saveRetailFish: services.saveFish, initializeRetailFish: services.initialize, loadRetailSales: services.history, loadRetailSale: services.detail, newRetailSaleId: services.id, loadPendingRetailSale: services.restore, rememberPendingRetailSale: services.remember, clearPendingRetailSale: services.clear }))
const fish: RetailFish[] = [
  { id: 'a', chineseName: '甘丰', malayName: 'kembung', suggestedPriceCents: 600, active: true },
  { id: 'b', chineseName: '马丰', malayName: 'mabong', suggestedPriceCents: 800, active: true },
  { id: 'c', chineseName: '无建议鱼', malayName: '', suggestedPriceCents: null, active: true },
  { id: 'd', chineseName: '停用鱼', malayName: '', suggestedPriceCents: 100, active: false },
]
function mount(page = <RetailSalesPage />) { return render(<MemoryRouter>{page}</MemoryRouter>) }
function fill(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }
function add(name = '甘丰', kg = '2', price?: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))
  fill('重量 kg', kg)
  if (price !== undefined) fill('实际 RM/kg', price)
  fireEvent.click(screen.getByRole('button', { name: '加入明细' }))
}
beforeEach(() => {
  vi.clearAllMocks()
  services.watch.mockImplementation(next => { next(fish); return vi.fn() })
  services.id.mockReturnValue('sale-1')
  services.save.mockImplementation(async (id, input) => ({ id, ...prepareRetailSale(input) }))
  services.saveFish.mockResolvedValue(undefined)
  services.restore.mockReturnValue(null)
})
afterEach(cleanup)

describe('mobile retail checkout', () => {
  it('accepts decimal kg, shows exact draft amounts, and preserves weights on the saved printable receipt', async () => {
    mount(); fill('小贩名', '阿明')
    expect(screen.getByLabelText('重量 kg')).toHaveAttribute('inputmode', 'decimal')
    fireEvent.click(screen.getByRole('button', { name: /甘丰/ })); fill('重量 kg', '12.5')
    expect(screen.getByText('RM75.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '加入明细' }))
    add('马丰', '7.3')
    expect(screen.getByText('12.5 kg × RM6.00/kg')).toBeInTheDocument()
    expect(screen.getByText('7.3 kg × RM8.00/kg')).toBeInTheDocument()
    expect(screen.getByText('RM133.40')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '结算' }))
    const receipt = await screen.findByRole('region', { name: '现金结算单' })
    expect(within(receipt).getByRole('cell', { name: '12.5' })).toBeInTheDocument()
    expect(within(receipt).getByRole('cell', { name: '7.3' })).toBeInTheDocument()
    expect(within(receipt).getByRole('cell', { name: '75.00' })).toBeInTheDocument()
    expect(within(receipt).getByRole('cell', { name: '58.40' })).toBeInTheDocument()
    expect(services.save.mock.calls[0][1]).toMatchObject({ lines: [{ weightDeciKg: 125, amountCents: 7500 }, { weightDeciKg: 73, amountCents: 5840 }] })
  })
  it('rejects two decimal places explicitly without adding or rounding the weight', () => {
    mount(); add('甘丰', '2.25')
    expect(screen.getByRole('alert')).toHaveTextContent('最多一位小数')
    expect(screen.getByLabelText('重量 kg')).toHaveValue('2.25')
    expect(screen.getByRole('button', { name: '结算' })).toBeDisabled()
    expect(services.save).not.toHaveBeenCalled()
  })
  it('retains vendor/date across lines, accepts overrides, saves once, prints, and starts next vendor', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    mount()
    expect(screen.getByLabelText('日期')).toHaveValue(legacyIsoDateFromBusinessDate(retailToday()))
    fill('日期', '2026-09-05'); fill('小贩名', '阿明')
    fireEvent.click(screen.getByRole('button', { name: /甘丰/ }))
    expect(screen.getByLabelText('实际 RM/kg')).toHaveValue('6.00')
    fill('重量 kg', '3'); fill('实际 RM/kg', '6.15')
    fireEvent.click(screen.getByRole('button', { name: '加入明细' }))
    expect(screen.getByLabelText('重量 kg')).toHaveValue('')
    expect(screen.getByLabelText('小贩名')).toHaveValue('阿明')
    expect(screen.getByLabelText('日期')).toHaveValue('2026-09-05')
    add('马丰', '2')
    expect(screen.getByText('RM34.45')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '结算' }))
    fireEvent.click(screen.getByRole('button', { name: '正在保存…' }))
    expect(await screen.findByText('现金结算已保存。')).toBeInTheDocument()
    expect(services.save).toHaveBeenCalledOnce()
    expect(services.save.mock.calls[0][1]).toMatchObject({ vendorName: '阿明', businessDate: '05/09/2026', lines: [{ unitPriceCents: 615 }, { unitPriceCents: 800 }] })
    fireEvent.click(screen.getByRole('button', { name: '打印结算单' })); expect(print).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '下一位小贩' }))
    expect(screen.getByLabelText('小贩名')).toHaveValue('')
    expect(screen.getByText('RM0.00')).toBeInTheDocument()
    print.mockRestore()
  })
  it('searches names, hides inactive species, accepts a missing default, and removes draft lines', () => {
    mount(); expect(screen.queryByRole('button', { name: '停用鱼' })).not.toBeInTheDocument()
    fill('搜索鱼名', 'mabong'); expect(screen.queryByRole('button', { name: /甘丰/ })).not.toBeInTheDocument()
    fill('搜索鱼名', ''); add('无建议鱼', '5', '1.01')
    expect(screen.getAllByText('RM5.05')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '移除第 1 条明细' }))
    expect(screen.getByRole('button', { name: '结算' })).toBeDisabled()
  })
  it('keeps added snapshots through live changes and makes newly added fish available immediately', () => {
    let next: (items: RetailFish[]) => void = () => {}
    services.watch.mockImplementation(callback => { next = callback; callback(fish); return vi.fn() })
    mount(); add()
    act(() => next([{ ...fish[0], chineseName: '新名称', suggestedPriceCents: 900 }, { ...fish[1], id: 'new', chineseName: '新鱼' }]))
    expect(screen.getByText('甘丰')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /新鱼/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /新名称/ }))
    expect(screen.getByLabelText('实际 RM/kg')).toHaveValue('9.00')
  })
  it('retries an uncertain save using the same ID and frozen snapshot', async () => {
    services.save.mockRejectedValueOnce(new Error('连接中断'))
    mount(); fill('小贩名', '阿明'); add()
    fireEvent.click(screen.getByRole('button', { name: '结算' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('连接中断')
    expect(screen.getByLabelText('小贩名')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重试结算' }))
    await screen.findByText('现金结算已保存。')
    expect(services.id).toHaveBeenCalledOnce()
    expect(services.save.mock.calls[1]).toEqual(services.save.mock.calls[0])
  })
  it('does not silently omit the current unadded line', async () => {
    mount(); fill('小贩名', '阿明'); add()
    fireEvent.click(screen.getByRole('button', { name: /马丰/ })); fill('重量 kg', '3')
    fireEvent.click(screen.getByRole('button', { name: '结算' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请先加入或清除')
    expect(services.save).not.toHaveBeenCalled()
  })
  it('restores an interrupted checkout after a page reload', async () => {
    const pending = { id: 'old-attempt', input: prepareRetailSale({ businessDate: '05/09/2026', vendorName: '阿明', lines: [{ fishId: 'a', chineseName: '甘丰', malayName: 'kembung', weightKg: 2, unitPriceCents: 600, amountCents: 1200 }] }) }
    services.restore.mockReturnValue(pending)
    mount(); expect(screen.getByLabelText('小贩名')).toHaveValue('阿明')
    expect(screen.getByLabelText('小贩名')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重试结算' }))
    await screen.findByText('现金结算已保存。')
    expect(services.save).toHaveBeenCalledWith(pending.id, pending.input)
    expect(services.id).not.toHaveBeenCalled(); expect(services.clear).toHaveBeenCalledOnce()
  })
})

describe('retail settings and history', () => {
  it('creates a fish without Malay name or price and edits name, price, and enabled state', async () => {
    mount(<RetailFishPage />); fireEvent.click(screen.getByRole('button', { name: '新增鱼种' }))
    fill('中文鱼名', '新增鱼'); fireEvent.click(screen.getByRole('button', { name: '保存鱼种' }))
    await waitFor(() => expect(services.saveFish).toHaveBeenCalledWith(null, { chineseName: '新增鱼', malayName: '', suggestedPriceCents: null, active: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '修改 甘丰' }))
    fill('中文鱼名', '新名字'); fill('马来文名（可空）', 'new'); fill('建议 RM/kg（可空）', '7.25')
    fireEvent.click(screen.getByLabelText('启用')); fireEvent.click(screen.getByRole('button', { name: '保存鱼种' }))
    await waitFor(() => expect(services.saveFish).toHaveBeenLastCalledWith('a', { chineseName: '新名字', malayName: 'new', suggestedPriceCents: 725, active: false }))
  })
  it('initializes seed data only on explicit setup action', async () => {
    services.watch.mockImplementation(next => { next([]); return vi.fn() })
    mount(<RetailFishPage />); expect(services.initialize).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '建立初始三种鱼' }))
    await waitFor(() => expect(services.initialize).toHaveBeenCalledOnce())
  })
  it('loads date history, filters by vendor, opens stored snapshots and reprints', async () => {
    const sale: RetailSale = { id: 'old', businessDate: '06/09/2026', dateSortKey: 20260906, vendorName: '阿明', totalAmountCents: 5840, lines: [{ fishId: 'a', chineseName: '历史甘丰', malayName: 'old name', weightDeciKg: 73, unitPriceCents: 800, amountCents: 5840 }] }
    services.history.mockResolvedValue([sale, { ...sale, id: 'other', vendorName: '阿华' }]); services.detail.mockResolvedValue(sale)
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    render(<MemoryRouter initialEntries={['/retail-sales/history']}><Routes><Route path="/retail-sales/history" element={<RetailHistoryPage />} /><Route path="/retail-sales/history/:saleId" element={<RetailReceiptPage />} /></Routes></MemoryRouter>)
    await screen.findByRole('heading', { name: '阿华' }); fill('日期', '2026-09-06')
    await waitFor(() => expect(services.history).toHaveBeenCalledWith('06/09/2026'))
    fill('搜索小贩名', '阿明'); expect(screen.queryByRole('heading', { name: '阿华' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: '查看并打印 阿明' }))
    const receipt = await screen.findByRole('region', { name: '现金结算单' })
    expect(within(receipt).getByText('历史甘丰')).toBeInTheDocument(); expect(within(receipt).getByText('old name')).toBeInTheDocument()
    expect(within(receipt).getByRole('cell', { name: '7.3' })).toBeInTheDocument()
    expect(within(receipt).getByRole('cell', { name: '58.40' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '打印结算单' })); expect(print).toHaveBeenCalledOnce(); print.mockRestore()
  })
})
