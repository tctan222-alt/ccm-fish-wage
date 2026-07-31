import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { DashboardPage } from './DashboardPage'

describe('CCM 部门首页', () => {
  it('shows departments and shared-master-data ice vessels', async () => {
    const vessels = ['978', '833', '2072', '9633', '4818', '2031', '1785', '5202'].map((vesselCode, order) => ({
      id: `v${vesselCode}`, vesselCode, displayName: vesselCode, defaultSupplierId: '', defaultSupplierNameSnapshot: '', active: true, order, notes: '',
    }))
    render(<MemoryRouter><DashboardPage vesselLoader={async () => vessels} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'CCM 首页' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '鱼头鱼仔部' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '鱼头购入' })).toHaveAttribute('href', '/fish-head-purchase')
    expect(screen.getByRole('link', { name: '鱼仔购入' })).toHaveAttribute('href', '/fish-meal-purchase')
    expect(screen.getByRole('link', { name: '切鱼头工钱计算' })).toHaveAttribute('href', '/fish-head-wages')
    for (const vessel of vessels) expect(await screen.findByRole('link', { name: vessel.vesselCode })).toHaveAttribute('href', `/ice-department/${vessel.id}`)
    expect(screen.getByRole('heading', { name: 'CCM 行政' })).toBeInTheDocument()
    expect(screen.getByText('建设中')).toBeInTheDocument()
  })
})
