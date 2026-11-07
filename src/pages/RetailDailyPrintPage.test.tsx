import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { retailToday, type RetailSale } from '../lib/retailSales'
import { legacyIsoDateFromBusinessDate } from '../lib/businessDate'

const state = vi.hoisted(() => ({ listeners: [] as { next: (value: { sales: RetailSale[]; fromCache: boolean; hasPendingWrites?: boolean }) => void; fail: (error: unknown) => void; stop: ReturnType<typeof vi.fn> }[] }))
vi.mock('../services/retailSales', () => ({ watchRetailSales: vi.fn((_range, next, fail) => { const stop = vi.fn(); state.listeners.push({ next, fail, stop }); return stop }) }))
import { RetailDailyPrintPage } from './RetailDailyPrintPage'

const todaySale = (id: string, vessel?: string): RetailSale => ({ id, invoiceNumber: id, vendorName: `Vendor ${id}`, businessDate: retailToday(), dateSortKey: 20261107,
  ...(vessel ? { vesselId: `v${vessel}`, vesselCodeSnapshot: vessel } : {}), lines: [{ fishId: 'a', chineseName: '金线', malayName: 'Kerisi', weightDeciKg: 25, unitPriceCents: 201, amountCents: 503, remark: id === 'A' ? '次' : '冰鲜' }], totalAmountCents: 503 })
function emit(sales: RetailSale[], fromCache = false, index = state.listeners.length - 1) { act(() => state.listeners[index].next({ sales, fromCache })) }
beforeEach(() => { state.listeners = []; vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-07T02:00:00Z')); vi.spyOn(window, 'print').mockImplementation(() => {}) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })
function mount() { return render(<MemoryRouter><RetailDailyPrintPage /></MemoryRouter>) }

describe('Retail all-day printing', () => {
  it('defaults to Malaysia today and prints the same scoped totals and invoices without opening each sale', () => {
    mount()
    expect(screen.getByLabelText('销售日期 Print Date')).toHaveValue(legacyIsoDateFromBusinessDate(retailToday()))
    emit([todaySale('A', '833'), todaySale('B', '978'), todaySale('C')])
    const preview = screen.getByRole('region', { name: '批量打印预览 Print Preview' })
    expect(preview).toHaveTextContent('3 单 Sales · 7.5 kg · RM15.09')
    expect(within(preview).getByRole('row', { name: /未记录船号.*1.*2.5.*RM5.03/ })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('打印船号 Print Vessel'), { target: { value: 'id:v833' } })
    expect(preview).toHaveTextContent('1 单 Sales · 2.5 kg · RM5.03')
    fireEvent.click(screen.getByLabelText('当天全部销售单 All Invoices'))
    expect(within(preview).getAllByRole('region', { name: '门市现金结算单' })).toHaveLength(1)
    expect(preview).toHaveTextContent('Vendor A'); expect(preview).not.toHaveTextContent('Vendor B'); expect(preview).toHaveTextContent('备注 Remark：次')
    fireEvent.click(screen.getByRole('button', { name: '打印全部单 Print All Invoices' }))
    expect(window.print).toHaveBeenCalledOnce()
  })
  it('blocks unverified cache, clears stale dates, ignores old callbacks and does not print empty results', () => {
    mount(); emit([todaySale('A', '833')], true)
    expect(screen.getByRole('button', { name: '打印总结 Print Summary' })).toBeDisabled()
    expect(screen.queryByRole('region', { name: '批量打印预览 Print Preview' })).not.toBeInTheDocument()
    emit([todaySale('A', '833')])
    fireEvent.change(screen.getByLabelText('销售日期 Print Date'), { target: { value: '2026-11-06' } })
    expect(state.listeners[0].stop).toHaveBeenCalledOnce()
    expect(screen.queryByRole('region', { name: '批量打印预览 Print Preview' })).not.toBeInTheDocument()
    emit([todaySale('A', '833')], false, 0)
    expect(screen.getByRole('button', { name: '打印总结 Print Summary' })).toBeDisabled()
    emit([])
    expect(screen.getByRole('status')).toHaveTextContent('当天没有符合船号筛选的销售单')
    fireEvent.click(screen.getByRole('button', { name: '打印总结 Print Summary' }))
    expect(window.print).not.toHaveBeenCalled()
  })
  it('surfaces query and corrupt-total errors and permits a fresh reload', () => {
    mount(); act(() => state.listeners[0].fail(new Error('permission-denied')))
    expect(screen.getByRole('alert')).toHaveTextContent('permission-denied')
    fireEvent.click(screen.getByRole('button', { name: '重新载入 Retry' }))
    emit([{ ...todaySale('bad'), totalAmountCents: 1 }])
    expect(screen.getByRole('alert')).toHaveTextContent('总额与明细不一致')
    expect(screen.getByRole('button', { name: '打印总结 Print Summary' })).toBeDisabled()
  })
  it('does not print optimistic pending writes even after a server connection is available', () => {
    mount()
    act(() => state.listeners[0].next({ sales: [todaySale('A', '833')], fromCache: false, hasPendingWrites: true }))
    expect(screen.getByRole('button', { name: '打印总结 Print Summary' })).toBeDisabled()
    expect(screen.queryByRole('region', { name: '批量打印预览 Print Preview' })).not.toBeInTheDocument()
    emit([todaySale('A', '833')])
    expect(screen.getByRole('button', { name: '打印总结 Print Summary' })).toBeEnabled()
  })
})
