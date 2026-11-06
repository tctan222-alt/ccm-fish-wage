import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import seedSheet from '../data/qlPrices20261010.json'
import { QL_SEED_VERSION } from '../lib/qlPrices'
import { QlPricesPage } from './QlPricesPage'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

function show(reader?: () => Promise<unknown>, date = '2026-11-06') {
  render(<MemoryRouter><QlPricesPage reader={reader} initialBusinessDate={date} /></MemoryRouter>)
}

function incoming(date = '2026-11-07', newPrice = 3.25) {
  const source = structuredClone(seedSheet)
  source.version = `ql-foods-${date}`
  source.effectiveDate = date
  source.source.title = `QL Foods 鱼头价格表 ${date}`
  source.values[1][1] = date
  source.values[3][2] = (newPrice * 100 - 315) / 100
  source.values[3][3] = newPrice
  return source
}

function deferred() {
  let resolve!: (value: unknown) => void
  let reject!: (error: Error) => void
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const groups = () => screen.getByRole('region', { name: 'QL 价格组别' })
const preview = () => screen.getByRole('region', { name: 'QL 更新预览' })

describe('QL buyer price reference', () => {
  it('shows all approved groups, exact source and 22 raised / 14 unchanged prices', () => {
    show()
    expect(within(groups()).getAllByRole('article')).toHaveLength(36)
    expect(within(groups()).getAllByText(/调整 不变/)).toHaveLength(14)
    expect(within(groups()).getAllByText(/调整 \+RM/)).toHaveLength(22)
    expect(screen.getByRole('link', { name: 'QL Foods Google Sheet' })).toHaveAttribute('href', QL_SEED_VERSION.source.url)
    expect(screen.getByText(/Sheet1!A1:E39/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'QL 来源与版本' })).toHaveTextContent(`已核准参考版本：${QL_SEED_VERSION.version}`)
    expect(screen.getByText(/尚无关联买家的鱼头销售流程/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /保存|发布/ })).not.toBeInTheDocument()
  })

  it('keeps 丁温 method collisions distinct and requires review before method selection', () => {
    show()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '丁温' } })
    expect(within(groups()).getAllByRole('article')).toHaveLength(2)
    expect(screen.getByText(/需要复核/)).toBeInTheDocument()
    expect(within(groups()).getByText('加晒/丁温/目孔(拖网)')).toBeInTheDocument()
    expect(within(groups()).getByText('丁温/目孔/加西（底船）')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '作业方式' }), { target: { value: 'bottom' } })
    expect(within(groups()).getAllByRole('article')).toHaveLength(1)
    expect(screen.queryByText(/需要复核/)).not.toBeInTheDocument()
    expect(within(groups()).getByText('RM2.10')).toBeInTheDocument()
  })

  it('does not merge 青兰 general and bottom prices or infer expanded shorthand', () => {
    show()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '青兰' } })
    expect(within(groups()).getAllByRole('article')).toHaveLength(2)
    expect(within(groups()).getByText('RM0.90')).toBeInTheDocument()
    expect(within(groups()).getByText('RM1.10')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '红目林仔' } })
    expect(screen.getByText(/需要复核/)).toBeInTheDocument()
    expect(screen.getByText('没有符合条件的组别，请核对原表。')).toBeInTheDocument()
  })

  it('never supplies the 2026-10-10 price to an earlier business date', () => {
    show(undefined, '2026-10-09')
    expect(screen.getByText('该业务日期尚无已生效的 QL 价格版本。')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'QL 价格组别' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('业务日期'), { target: { value: '2026-10-10' } })
    expect(within(groups()).getAllByRole('article')).toHaveLength(36)
    fireEvent.change(screen.getByLabelText('业务日期'), { target: { value: '' } })
    expect(screen.getByRole('alert')).toHaveTextContent('请选择有效业务日期。')
  })

  it('reports missing authenticated runtime access without changing references or reading public exports', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    show()
    fireEvent.click(screen.getByRole('button', { name: '检查 QL 更新' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/授权|认证|Google/)
    expect(fetcher).not.toHaveBeenCalled()
    expect(within(groups()).getAllByRole('article')).toHaveLength(36)
    expect(screen.queryByRole('region', { name: 'QL 更新预览' })).not.toBeInTheDocument()
    fetcher.mockRestore()
  })

  it('previews before/after without adopting it and preserves user filters during the read', async () => {
    const pending = deferred()
    show(() => pending.promise)
    fireEvent.click(screen.getByRole('button', { name: '检查 QL 更新' }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '大目力' } })
    fireEvent.change(screen.getByLabelText('业务日期'), { target: { value: '2026-11-08' } })
    expect(screen.getByText('正在检查 QL 原表…')).toBeInTheDocument()
    await act(async () => pending.resolve(incoming()))
    expect(within(preview()).getByText(/RM3.15.*RM3.25/)).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('大目力')
    expect(screen.getByLabelText('业务日期')).toHaveValue('2026-11-08')
    expect(within(groups()).getByText('RM3.15')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'QL 来源与版本' })).toHaveTextContent(`已核准参考版本：${QL_SEED_VERSION.version}`)
  })

  it('discards a stale check and retains the preview after a newer failure without permitting stage', async () => {
    const first = deferred(), second = deferred(), third = deferred()
    const reader = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
    show(reader)
    const check = screen.getByRole('button', { name: '检查 QL 更新' })
    fireEvent.click(check)
    fireEvent.click(check)
    await act(async () => second.resolve(incoming('2026-11-08', 3.35)))
    await act(async () => first.resolve(incoming('2026-11-07', 3.25)))
    expect(within(preview()).getByText(/版本 ql-foods-2026-11-08/)).toBeInTheDocument()
    fireEvent.click(check)
    await act(async () => third.reject(new Error('Source unavailable')))
    expect(await screen.findByRole('alert')).toHaveTextContent('Source unavailable')
    expect(within(preview()).getByText(/版本 ql-foods-2026-11-08/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '仅在本页暂存预览' })).toBeDisabled()
    expect(screen.queryByText(/本页暂存记录/)).not.toBeInTheDocument()
  })

  it('only stages after an explicit action, marks it local, retains history and is idempotent', async () => {
    show(async () => incoming(), '2026-11-08')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '大目力' } })
    fireEvent.click(screen.getByRole('button', { name: '检查 QL 更新' }))
    await screen.findByRole('region', { name: 'QL 更新预览' })
    fireEvent.click(screen.getByRole('button', { name: '仅在本页暂存预览' }))
    expect(screen.getByRole('region', { name: 'QL 来源与版本' })).toHaveTextContent('本页暂存版本（未发布）：ql-foods-2026-11-07')
    expect(within(groups()).getByText('RM3.25')).toBeInTheDocument()
    expect(screen.getByText(/本页暂存记录：1 次/)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/本页暂存记录：1 次/))
    expect(screen.getByText(/ql-foods-2026-10-10 → ql-foods-2026-11-07/)).toBeInTheDocument()
    expect(screen.getByText(/大目力.*RM3.15.*RM3.25/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('业务日期'), { target: { value: '2026-11-06' } })
    expect(within(groups()).getByText('RM3.15')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '检查 QL 更新' }))
    await screen.findByRole('region', { name: 'QL 更新预览' })
    fireEvent.click(screen.getByRole('button', { name: '仅在本页暂存预览' }))
    expect(screen.getByText(/本页暂存记录：1 次/)).toBeInTheDocument()
    cleanup()
    show(undefined, '2026-11-08')
    expect(screen.queryByText(/本页暂存版本（未发布）/)).not.toBeInTheDocument()
    expect(screen.queryByText(/本页暂存记录/)).not.toBeInTheDocument()
  })

  it('renders a future decrease with the correct sign and before/after audit', async () => {
    show(async () => incoming('2026-11-07', 3.10), '2026-11-08')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '大目力' } })
    fireEvent.click(screen.getByRole('button', { name: '检查 QL 更新' }))
    await screen.findByRole('region', { name: 'QL 更新预览' })
    expect(within(preview()).getByText(/RM3.15.*RM3.10/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '仅在本页暂存预览' }))
    expect(within(groups()).getByText(/调整 -RM0.05/)).toBeInTheDocument()
    expect(within(groups()).queryByText(/\+RM-/)).not.toBeInTheDocument()
  })

  it('initializes the business date in Malaysia when UTC is on the preceding day', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-06T17:15:00Z'))
    render(<MemoryRouter><QlPricesPage /></MemoryRouter>)
    expect(screen.getByLabelText('业务日期')).toHaveValue('2026-11-07')
  })
})
