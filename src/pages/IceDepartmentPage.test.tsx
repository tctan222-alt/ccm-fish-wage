import { render,screen,within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect,it } from 'vitest'
import { IceDepartmentPage } from './IceDepartmentPage'

it('shows the eight active ice-department vessels',()=>{
  render(<MemoryRouter><IceDepartmentPage/></MemoryRouter>)
  const vessels=within(screen.getByRole('navigation',{name:'冰工船只'}))
  for(const code of ['978','833','2072','9633','4818','2031','1785','5202']){
    expect(vessels.getByRole('link',{name:code})).toHaveAttribute('href',`/ice-department/${code}`)
  }
})
