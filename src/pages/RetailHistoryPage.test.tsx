import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'
import type { RetailSale } from '../lib/retailSales'
import { retailToday } from '../lib/retailSales'

type HistoryResult = { sales: RetailSale[]; fromCache: boolean }
const state = vi.hoisted(() => ({
  listeners: [] as { next: (result: HistoryResult) => void; error: (error: unknown) => void; stop: ReturnType<typeof vi.fn> }[],
  initial: null as HistoryResult | null,
  watch: vi.fn(), legacyRead: vi.fn(), authReady: null as ((user: User | null) => void) | null,
}))
vi.mock('../firebase', () => ({ auth: {}, db: {}, firebaseConfigured: true }))
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn((_auth, callback) => { state.authReady = callback; return vi.fn() }), signOut: vi.fn(), signInWithEmailAndPassword: vi.fn() }))
vi.mock('../services/retailSales', () => ({
  watchRetailSales: state.watch, loadRetailSales: state.legacyRead,
  watchRetailFish: vi.fn(), loadRetailSale: vi.fn(), saveRetailSale: vi.fn(), saveRetailFish: vi.fn(), quickAddRetailFish: vi.fn(), initializeRetailFish: vi.fn(),
  newRetailSaleId: vi.fn(), loadPendingRetailSale: vi.fn(), rememberPendingRetailSale: vi.fn(), clearPendingRetailSale: vi.fn(),
}))
import { RetailHistoryPage } from './RetailSalesPage'
import App from '../App'

const sale: RetailSale = { id: 'history-1', businessDate: '07/09/2026', dateSortKey: 20260907, vendorName: '阿明', totalAmountCents: 1200, lines: [{ fishId: 'fish-1', chineseName: '金线', malayName: 'Kerisi', weightDeciKg: 20, unitPriceCents: 600, amountCents: 1200 }] }
function mount() { return render(<MemoryRouter><RetailHistoryPage /></MemoryRouter>) }
function emit(result: HistoryResult, index = state.listeners.length - 1) { act(() => state.listeners[index]?.next(result)) }
beforeEach(() => {
  state.listeners = []; state.initial = null; state.authReady = null
  state.legacyRead.mockReset().mockReturnValue(new Promise(() => {}))
  state.watch.mockReset().mockImplementation((_date, next, error) => {
    const stop = vi.fn(); state.listeners.push({ next, error, stop })
    if (state.initial) next(state.initial)
    return stop
  })
  window.history.replaceState(null, '', '/')
})
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); vi.useRealTimers(); vi.restoreAllMocks() })

describe('first-entry Retail history loading', () => {
  it('shows available history on fresh mount while the first server synchronization is still pending', async () => {
    state.initial = { sales: [sale], fromCache: true }
    mount()
    expect(await screen.findByRole('link', { name: /查看结算单 View Invoice.*阿明/ })).toBeInTheDocument()
    expect(screen.getByText(/缓存 Cached/)).toBeInTheDocument()
    emit({ sales: [sale], fromCache: false })
    expect(screen.queryByText(/缓存 Cached/)).not.toBeInTheDocument()
    expect(state.watch).toHaveBeenCalledOnce()
  })
  it('recovers from an initially empty cache when data arrives without navigation or refresh', async () => {
    state.initial = { sales: [], fromCache: true }
    mount()
    expect(screen.queryByText(/没有符合条件的销售/)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('尚未取得服务器记录')
    emit({ sales: [sale], fromCache: false })
    expect(screen.getByRole('link', { name: /查看结算单 View Invoice.*阿明/ })).toBeInTheDocument()
    expect(state.watch).toHaveBeenCalledOnce()
    expect(state.listeners[0].stop).not.toHaveBeenCalled()
  })
  it('waits for slow auth initialization and then loads late history data on the same route', async () => {
    window.history.replaceState(null, '', '/retail-sales/history')
    render(<App />)
    expect(screen.getByRole('status')).toHaveTextContent('正在载入')
    expect(state.watch).not.toHaveBeenCalled()
    await act(async () => state.authReady?.({ uid: 'retail-user' } as User))
    await waitFor(() => expect(state.watch).toHaveBeenCalledOnce())
    expect(screen.getByRole('status')).toHaveTextContent('正在载入历史')
    emit({ sales: [sale], fromCache: false })
    expect(screen.getByRole('link', { name: /查看结算单 View Invoice.*阿明/ })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/retail-sales/history')
    expect(screen.getByRole('button', { name: '退出登录 Sign Out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回 Back' })).toBeInTheDocument()
  })
  it('separates loading from server-confirmed empty history', () => {
    mount(); expect(screen.getByRole('status')).toHaveTextContent('正在载入历史')
    emit({ sales: [], fromCache: false })
    expect(screen.getByRole('status')).toHaveTextContent('没有符合条件的销售')
    expect(screen.queryByText(/正在载入历史/)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('shows a specific query error instead of staying in loading and can retry in place', () => {
    mount()
    act(() => state.listeners[0].error({ code: 'permission-denied', message: 'Missing permissions' }))
    expect(screen.getByRole('alert')).toHaveTextContent('没有读取销售历史的权限')
    expect(screen.getByRole('alert')).toHaveTextContent('permission-denied')
    expect(screen.queryByText(/正在载入历史/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试 Retry' }))
    expect(state.listeners[0].stop).toHaveBeenCalledOnce()
    emit({ sales: [sale], fromCache: false })
    expect(screen.getByRole('link', { name: /查看结算单 View Invoice.*阿明/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('surfaces synchronous query setup failures and invalid dates', () => {
    state.watch.mockImplementationOnce(() => { throw new Error('Query setup failed') })
    mount()
    expect(screen.getByRole('alert')).toHaveTextContent('Query setup failed')
    fireEvent.click(screen.getByRole('button', { name: '范围 Range' }))
    fireEvent.change(screen.getByLabelText('开始 From'), { target: { value: '' } })
    expect(screen.getByRole('alert')).toHaveTextContent('请选择有效日期')
    expect(state.watch).toHaveBeenCalledOnce()
  })
  it('ignores stale success/error callbacks after changing dates and keeps vendor filtering local', () => {
    mount(); emit({ sales: [sale], fromCache: false })
    fireEvent.change(screen.getByLabelText('搜索小贩 Search Vendor'), { target: { value: '阿华' } })
    expect(state.watch).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '范围 Range' }))
    fireEvent.change(screen.getByLabelText('开始 From'), { target: { value: '2026-01-01' } })
    expect(state.watch).toHaveBeenCalledTimes(2)
    expect(state.watch.mock.calls[1][0]).toEqual({ fromDate: '01/01/2026', toDate: retailToday() })
    expect(state.listeners[0].stop).toHaveBeenCalledOnce()
    emit({ sales: [sale], fromCache: false }, 0)
    act(() => state.listeners[0].error({ code: 'unavailable' }))
    expect(screen.queryByRole('link', { name: /查看结算单 View Invoice.*阿明/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    emit({ sales: [{ ...sale, id: 'next', vendorName: '阿华' }], fromCache: false })
    expect(screen.getByRole('link', { name: /查看结算单 View Invoice.*阿华/ })).toBeInTheDocument()
  })
  it('cleans up StrictMode and unmount subscriptions without requiring a navigation cycle', () => {
    state.initial = { sales: [sale], fromCache: false }
    const view = render(<StrictMode><MemoryRouter><RetailHistoryPage /></MemoryRouter></StrictMode>)
    expect(screen.getByRole('link', { name: /查看结算单 View Invoice.*阿明/ })).toBeInTheDocument()
    expect(state.watch).toHaveBeenCalledTimes(2)
    expect(state.listeners[0].stop).toHaveBeenCalledOnce()
    view.unmount()
    expect(state.listeners[1].stop).toHaveBeenCalledOnce()
    emit({ sales: [], fromCache: false }, 1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('compact Retail history periods', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-07T17:00:00Z')) // 08/09 in Malaysia.
  })
  it('defaults to Malaysia Today with no permanently expanded range controls', () => {
    mount()
    expect(screen.getByRole('button', { name: '今天 Today' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('日期 Date：08/09/2026')).toBeInTheDocument()
    expect(state.watch).toHaveBeenCalledWith({ fromDate: '08/09/2026', toDate: '08/09/2026' }, expect.any(Function), expect.any(Function))
    expect(screen.queryByLabelText('开始 From')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('结束 To')).not.toBeInTheDocument()
  })
  it('shows the full Monday–Sunday week and steps across a month boundary', () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: '按周 Week' }))
    expect(screen.getByText('07/09/2026 – 13/09/2026')).toBeInTheDocument()
    expect(screen.getByText('周一至周日 Mon–Sun')).toBeInTheDocument()
    expect(state.watch.mock.lastCall?.[0]).toEqual({ fromDate: '07/09/2026', toDate: '13/09/2026' })
    fireEvent.click(screen.getByRole('button', { name: '上一周 Previous Week' }))
    expect(screen.getByText('31/08/2026 – 06/09/2026')).toBeInTheDocument()
    expect(state.watch.mock.lastCall?.[0]).toEqual({ fromDate: '31/08/2026', toDate: '06/09/2026' })
    fireEvent.click(screen.getByRole('button', { name: '下一周 Next Week' }))
    expect(state.watch.mock.lastCall?.[0]).toEqual({ fromDate: '07/09/2026', toDate: '13/09/2026' })
    expect(screen.queryByLabelText('开始 From')).not.toBeInTheDocument()
  })
  it('queries only the chosen inclusive range and hides date inputs after leaving Range', () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: '范围 Range' }))
    expect(screen.getByRole('button', { name: '范围 Range' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.change(screen.getByLabelText('开始 From'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('结束 To'), { target: { value: '2026-09-05' } })
    expect(state.watch.mock.lastCall?.[0]).toEqual({ fromDate: '01/09/2026', toDate: '05/09/2026' })
    fireEvent.click(screen.getByRole('button', { name: '今天 Today' }))
    expect(state.watch.mock.lastCall?.[0]).toEqual({ fromDate: '08/09/2026', toDate: '08/09/2026' })
    expect(screen.queryByLabelText('开始 From')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('结束 To')).not.toBeInTheDocument()
  })
  it('rejects from after to, cancels the old query, and resumes when corrected', () => {
    state.initial = { sales: [sale], fromCache: false }
    mount(); fireEvent.click(screen.getByRole('button', { name: '范围 Range' }))
    fireEvent.change(screen.getByLabelText('开始 From'), { target: { value: '2026-09-10' } })
    expect(screen.getByRole('alert')).toHaveTextContent('开始日期不可晚于结束日期')
    expect(state.watch).toHaveBeenCalledOnce()
    expect(state.listeners[0].stop).toHaveBeenCalledOnce()
    expect(screen.queryByRole('list', { name: '销售记录 Sales Records' })).not.toBeInTheDocument()
    emit({ sales: [sale], fromCache: false }, 0)
    expect(screen.queryByRole('link', { name: /View Invoice/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('结束 To'), { target: { value: '2026-09-12' } })
    expect(state.watch.mock.lastCall?.[0]).toEqual({ fromDate: '10/09/2026', toDate: '12/09/2026' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('renders one compact clickable row per invoice with full accessible date, vendor and amount', () => {
    state.initial = { sales: [sale, { ...sale, id: 'second', vendorName: 'Ah Seng', totalAmountCents: 24600 }], fromCache: false }
    mount()
    const records = screen.getByRole('list', { name: '销售记录 Sales Records' })
    expect(records.querySelectorAll('li')).toHaveLength(2)
    const row = screen.getByRole('link', { name: '查看结算单 View Invoice 07/09/2026 Ah Seng RM246.00' })
    expect(row).toHaveAttribute('href', '/retail-sales/history/second')
    expect(row).toHaveTextContent('07/09')
    expect(row.querySelector('time')).toHaveAttribute('datetime', '2026-09-07')
    expect(records.querySelector('article')).toBeNull()
    expect(records.querySelector('h2')).toBeNull()
  })
})
