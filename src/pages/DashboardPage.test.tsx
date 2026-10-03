import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage'

afterEach(cleanup)
it('shows vessel loading, failure and retry without losing the ice department link',async()=>{
  let reject!: (error: Error) => void
  const loader=vi.fn().mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail})).mockResolvedValueOnce([{id:'v1',vesselCode:'TK141'}])
  render(<MemoryRouter><DashboardPage vesselLoader={loader}/></MemoryRouter>)
  expect(screen.getByRole('status')).toHaveTextContent('正在载入船号')
  reject(new Error('offline'))
  expect(await screen.findByRole('alert')).toHaveTextContent('无法载入船号')
  expect(screen.getByRole('link',{name:'查看冰工部门'})).toHaveAttribute('href','/ice-department')
  fireEvent.click(screen.getByRole('button',{name:'重试 Retry'}))
  expect(await screen.findByRole('link',{name:'TK141'})).toHaveAttribute('href','/ice-department/v1')
  expect(loader).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
it('distinguishes an empty successful response from a failure',async()=>{
  render(<MemoryRouter><DashboardPage vesselLoader={async()=>[]}/></MemoryRouter>)
  expect(await screen.findByText(/没有启用中的船号/)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

describe('CCM 部门首页', () => {
  it('shows departments and shared-master-data ice vessels', async () => {
    const vessels = ['978', '833', '2072', '9633', '4818', '2031', '1785', '5202'].map((vesselCode, order) => ({
      id: `v${vesselCode}`, vesselCode, displayName: vesselCode, defaultSupplierId: '', defaultSupplierNameSnapshot: '', active: true, order, notes: '',
    }))
    render(<MemoryRouter><DashboardPage vesselLoader={async () => vessels} /></MemoryRouter>)
    expect(screen.queryByText(/Vessel Trip/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'CCM 首页' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '快速现金结算' })).toHaveAttribute('href', '/retail-sales')
    expect(screen.getByRole('heading', { name: '鱼头鱼仔部' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '鱼头购入' })).toHaveAttribute('href', '/fish-head-purchase')
    expect(screen.getByRole('link', { name: '鱼头结单' })).toHaveAttribute('href', '/fish-head-settlement')
    expect(screen.getByRole('link', { name: '鱼仔购入' })).toHaveAttribute('href', '/fish-meal-purchase')
    expect(screen.getByRole('link', { name: '鱼仔结单' })).toHaveAttribute('href', '/fish-meal-settlement')
    expect(screen.getByRole('link', { name: '切鱼头工钱计算' })).toHaveAttribute('href', '/fish-head-wages')
    for (const vessel of vessels) expect(await screen.findByRole('link', { name: vessel.vesselCode })).toHaveAttribute('href', `/ice-department/${vessel.id}`)
    expect(screen.getByRole('heading', { name: 'CCM 行政' })).toBeInTheDocument()
    expect(screen.getByText('建设中')).toBeInTheDocument()
    const links=screen.getAllByRole('link')
    expect(links.at(-1)).toHaveAccessibleName('主资料 Master Data')
    expect(links.at(-1)).toHaveAttribute('href','/master-data')
  })
})
