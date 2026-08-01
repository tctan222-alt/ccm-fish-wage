import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'
import { IceDepartmentPage } from './IceDepartmentPage'

it('shows the eight active ice-department vessels from the shared master-data loader', async () => {
  const vessels = ['978', '833', '2072', '9633', '4818', '2031', '1785', '5202'].map((vesselCode, order) => ({
    id: `v${vesselCode}`, vesselCode, displayName: vesselCode, defaultSupplierId: '', defaultSupplierNameSnapshot: '', active: true, order, notes: '',
  }))
  render(<MemoryRouter><IceDepartmentPage vesselLoader={async () => vessels} /></MemoryRouter>)
  const navigation = within(await screen.findByRole('navigation', { name: '冰工船只' }))
  for (const vessel of vessels) expect(navigation.getByRole('link', { name: vessel.vesselCode })).toHaveAttribute('href', `/ice-department/${vessel.id}`)
})
