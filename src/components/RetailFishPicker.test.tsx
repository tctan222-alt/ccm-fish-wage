import { useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RetailFishPicker } from './RetailFishPicker'
import type { RetailFish } from '../lib/retailSales'

const quickAdd = vi.hoisted(() => vi.fn())
vi.mock('../services/retailSales', () => ({ quickAddRetailFish: quickAdd }))
const select = vi.fn(), created = vi.fn(), busy = vi.fn()
const fish: RetailFish[] = [
  { id: 'a', chineseName: '金线', malayName: 'Kerisi', suggestedPriceCents: 205, active: true },
  { id: 'b', chineseName: '金线仔', malayName: 'Kerisi Kecil', suggestedPriceCents: 180, active: true },
  { id: 'c', chineseName: '无资料鱼', malayName: '', suggestedPriceCents: null, active: true },
  { id: 'd', chineseName: '停用鱼', malayName: 'Inactive', suggestedPriceCents: 300, active: false },
]

function Harness({ items = fish, selectedFishId }: { items?: RetailFish[] | null; selectedFishId?: string }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  return <RetailFishPicker fish={items} query={query} inputRef={inputRef} selectedFishId={selectedFishId}
    onQueryChange={setQuery} onSelect={select} onCreated={created} onBusyChange={busy} />
}
function fill(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }
function otherDetails(name = '红鱼', price = '12.05') {
  fireEvent.click(screen.getByRole('button', { name: '其他 Other' }))
  fill('新鱼中文正式名 New Fish Chinese Name', name)
  fill('新鱼马来文名 New Fish Malay Name', 'Merah')
  fill('新鱼建议单价 New Fish Suggested Price (RM/kg)', price)
}
beforeEach(() => {
  vi.clearAllMocks()
  quickAdd.mockImplementation(async input => ({ id: 'new-fish', ...input }))
})
afterEach(cleanup)

describe('compact retail fish selection', () => {
  it('browses every active fish without a search limit and keeps missing metadata visible', () => {
    const extra = Array.from({ length: 10 }, (_, index) => ({ ...fish[0], id: `extra-${index}`, chineseName: `鱼种${index}` }))
    render(<Harness items={[...fish, ...extra]} />)
    expect(screen.getAllByRole('option')).toHaveLength(13)
    expect(screen.getByRole('option', { name: '金线 Kerisi RM2.05/kg' })).toBeInTheDocument()
    const missing = screen.getByRole('option', { name: '无资料鱼 — —' })
    expect(within(missing).getAllByText('—')).toHaveLength(2)
    expect(screen.queryByRole('option', { name: /停用鱼/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '其他 Other' })).toBeEnabled()
  })

  it('keeps exact, prefix and substring search ordering with the existing top-eight limit', () => {
    const extra = Array.from({ length: 10 }, (_, index) => ({ ...fish[0], id: `extra-${index}`, chineseName: `鱼种${index}`, malayName: `Big Kerisi ${index}` }))
    render(<Harness items={[...extra, fish[1], fish[0]]} />)
    fill('鱼名 Fish', 'kERIsi')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(8)
    expect(options[0]).toHaveAccessibleName('金线 Kerisi RM2.05/kg')
    expect(options[1]).toHaveAccessibleName('金线仔 Kerisi Kecil RM1.80/kg')
    expect(options[2]).toHaveAccessibleName('鱼种0 Big Kerisi 0 RM2.05/kg')
  })

  it('selects the original master object including Chinese, Malay and default price without writing data', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('option', { name: '金线 Kerisi RM2.05/kg' }))
    expect(select).toHaveBeenCalledWith(fish[0])
    expect(select.mock.calls[0][0]).toBe(fish[0])
    expect(quickAdd).not.toHaveBeenCalled()
    expect(created).not.toHaveBeenCalled()
  })

  it('separates the selected fish from keyboard focus and ignores IME Enter', () => {
    render(<Harness selectedFishId="b" />)
    const input = screen.getByRole('combobox', { name: '鱼名 Fish' })
    const first = screen.getByRole('option', { name: '金线 Kerisi RM2.05/kg' })
    const second = screen.getByRole('option', { name: '金线仔 Kerisi Kecil RM1.80/kg' })
    expect(second).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', first.id)
    expect(first).toHaveAttribute('data-highlighted', 'true')
    expect(first).toHaveAttribute('aria-selected', 'false')
    expect(second).toHaveAttribute('aria-selected', 'true')
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(select).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(select).toHaveBeenCalledWith(fish[0])
  })

  it('keeps Other unavailable until master data has loaded', () => {
    render(<Harness items={null} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading fish')
    expect(screen.getByRole('button', { name: '其他 Other' })).toBeDisabled()
  })

  it('adds through Other using the existing required fields and returns the saved master object', async () => {
    let resolve: (value: RetailFish) => void = () => {}
    quickAdd.mockReturnValue(new Promise<RetailFish>(done => { resolve = done }))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '其他 Other' }))
    const name = screen.getByLabelText('新鱼中文正式名 New Fish Chinese Name')
    expect(name).toHaveFocus()
    expect(name).toBeRequired()
    fill('新鱼中文正式名 New Fish Chinese Name', '红鱼')
    expect(name).toHaveFocus()
    expect(screen.getByLabelText('新鱼马来文名 New Fish Malay Name')).toBeRequired()
    expect(screen.getByLabelText('新鱼建议单价 New Fish Suggested Price (RM/kg)')).toBeRequired()
    fill('新鱼马来文名 New Fish Malay Name', 'Merah')
    fill('新鱼建议单价 New Fish Suggested Price (RM/kg)', '12.05')
    fireEvent.click(screen.getByRole('button', { name: '保存并使用新鱼 Save and Use Fish' }))
    expect(quickAdd).toHaveBeenCalledOnce()
    expect(quickAdd).toHaveBeenCalledWith({ chineseName: '红鱼', malayName: 'Merah', suggestedPriceCents: 1205, active: true })
    expect(screen.getByRole('button', { name: '正在新增… Adding fish…' })).toBeDisabled()
    expect(busy).toHaveBeenCalledWith(true)
    const saved: RetailFish = { id: 'new-red', chineseName: '红鱼', malayName: 'Merah', suggestedPriceCents: 1205, active: true }
    await act(async () => resolve(saved))
    expect(created).toHaveBeenCalledWith(saved)
    expect(select).toHaveBeenCalledWith(saved)
    expect(busy).toHaveBeenLastCalledWith(false)
  })

  it('prevents blank or existing Chinese names in Other from creating duplicate fish', async () => {
    render(<Harness />)
    otherDetails('   ')
    fireEvent.click(screen.getByRole('button', { name: '保存并使用新鱼 Save and Use Fish' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请输入新鱼的中文正式名')
    fill('新鱼中文正式名 New Fish Chinese Name', '金线')
    fireEvent.click(screen.getByRole('button', { name: '保存并使用新鱼 Save and Use Fish' }))
    expect(screen.getByRole('alert')).toHaveTextContent('此鱼种已存在')
    expect(quickAdd).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
  })

  it('preserves price precision and range validation for Other without rounding', async () => {
    render(<Harness />)
    otherDetails('红鱼', '2.055')
    fireEvent.click(screen.getByRole('button', { name: '保存并使用新鱼 Save and Use Fish' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('最多两位小数')
    fill('新鱼建议单价 New Fish Suggested Price (RM/kg)', '0')
    fireEvent.click(screen.getByRole('button', { name: '保存并使用新鱼 Save and Use Fish' }))
    expect(screen.getByRole('alert')).toHaveTextContent('RM0.01')
    expect(quickAdd).not.toHaveBeenCalled()
  })

  it('keeps an Other save error visible and lets the user cancel without a write or selection', async () => {
    quickAdd.mockRejectedValue(new Error('网络错误 Network error'))
    render(<Harness />)
    otherDetails()
    fireEvent.click(screen.getByRole('button', { name: '保存并使用新鱼 Save and Use Fish' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('网络错误 Network error')
    expect(screen.getByRole('button', { name: '保存并使用新鱼 Save and Use Fish' })).toBeEnabled()
    expect(created).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消新增 Cancel Add' }))
    expect(screen.queryByRole('region', { name: '新增门市鱼种 Add Retail Fish' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '鱼名 Fish' })).toHaveFocus()
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })
})
