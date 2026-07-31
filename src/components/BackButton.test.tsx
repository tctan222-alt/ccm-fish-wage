import { cleanup,fireEvent,render,screen } from '@testing-library/react'
import { Link,MemoryRouter,useLocation } from 'react-router-dom'
import { afterEach,expect,it,vi } from 'vitest'
import { BackButton } from './BackButton'

function Location(){return <output aria-label="route">{useLocation().pathname}</output>}

afterEach(()=>{cleanup();vi.restoreAllMocks()})

it('warns before returning when a form has unsaved changes',()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  render(<MemoryRouter initialEntries={['/fish-head-purchase']}><BackButton/><input aria-label="draft"/><Location/></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('draft'),{target:{value:'x'}})
  fireEvent.click(screen.getByRole('button',{name:'返回'}))
  expect(confirm).toHaveBeenCalledOnce()
  expect(screen.getByLabelText('route')).toHaveTextContent('/fish-head-purchase')
})

it('also blocks a page link while the form has unsaved changes',()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  render(<MemoryRouter initialEntries={['/fish-head-purchase']}><BackButton/><input aria-label="draft"/><Link to="/dashboard">仪表板</Link><Location/></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('draft'),{target:{value:'x'}})
  fireEvent.click(screen.getByRole('link',{name:'仪表板'}))
  expect(confirm).toHaveBeenCalledOnce()
  expect(screen.getByLabelText('route')).toHaveTextContent('/fish-head-purchase')
})

it('falls back from the ice department to the dashboard',()=>{
  render(<MemoryRouter initialEntries={['/ice-department']}><BackButton/><Location/></MemoryRouter>)
  fireEvent.click(screen.getByRole('button',{name:'返回'}))
  expect(screen.getByLabelText('route')).toHaveTextContent('/dashboard')
})
