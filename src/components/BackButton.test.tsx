import { cleanup,fireEvent,render,screen } from '@testing-library/react'
import { BrowserRouter,Link,MemoryRouter,Route,Routes,useLocation,useNavigate } from 'react-router-dom'
import { afterEach,expect,it,vi } from 'vitest'
import { BackButton } from './BackButton'
import { useState } from 'react'
import { DirtyStateProvider } from './DirtyStateProvider'
import { useUnsavedForm } from './dirtyState'

function Draft(){const [value,setValue]=useState('');const saved=useUnsavedForm(value);return <><input aria-label="draft" value={value} onChange={e=>setValue(e.target.value)}/><button onClick={saved}>Save</button></>}
function Location(){return <output aria-label="route">{useLocation().pathname}</output>}

afterEach(()=>{cleanup();window.history.replaceState(null,'',window.location.href);vi.restoreAllMocks()})

it('does not warn for date, vessel, status or search filters',()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  render(<MemoryRouter initialEntries={['/daily']}><DirtyStateProvider><BackButton/><input aria-label="date filter" type="date"/><select aria-label="vessel filter"><option value="">All</option><option value="v1">V1</option></select><select aria-label="status filter"><option value="">All</option><option value="saved">Saved</option></select><input aria-label="search filter"/><Location/></DirtyStateProvider></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('date filter'),{target:{value:'2026-10-02'}})
  fireEvent.change(screen.getByLabelText('vessel filter'),{target:{value:'v1'}})
  fireEvent.change(screen.getByLabelText('status filter'),{target:{value:'saved'}})
  fireEvent.change(screen.getByLabelText('search filter'),{target:{value:'fish'}})
  fireEvent.click(document.querySelector('button.back-button')!)
  expect(confirm).not.toHaveBeenCalled()
  expect(screen.getByLabelText('route')).toHaveTextContent('/fish-department')
})

it('warns before returning when a form has unsaved changes',()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  render(<MemoryRouter initialEntries={['/fish-head-purchase']}><DirtyStateProvider><BackButton/><Draft/><Location/></DirtyStateProvider></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('draft'),{target:{value:'x'}})
  fireEvent.click(screen.getByRole('button',{name:'返回'}))
  expect(confirm).toHaveBeenCalledOnce()
  expect(screen.getByLabelText('route')).toHaveTextContent('/fish-head-purchase')
})

it('also blocks a page link while the form has unsaved changes',()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  render(<MemoryRouter initialEntries={['/fish-head-purchase']}><DirtyStateProvider><BackButton/><Draft/><Link to="/dashboard">仪表板</Link><Location/></DirtyStateProvider></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('draft'),{target:{value:'x'}})
  fireEvent.click(screen.getByRole('link',{name:'仪表板'}))
  expect(confirm).toHaveBeenCalledOnce()
  expect(screen.getByLabelText('route')).toHaveTextContent('/fish-head-purchase')
})

it('falls back from the ice department to the dashboard',()=>{
  render(<MemoryRouter initialEntries={['/ice-department']}><DirtyStateProvider><BackButton/><Location/></DirtyStateProvider></MemoryRouter>)
  fireEvent.click(document.querySelector('button.back-button')!)
  expect(screen.getByLabelText('route')).toHaveTextContent('/dashboard')
})

function MoveToDashboard(){
  const navigate=useNavigate()
  return <button type="button" aria-label="go-dashboard" onClick={()=>navigate('/dashboard')}>go</button>
}


it('clears detected form state after leaving and re-entering a route',()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  render(<MemoryRouter initialEntries={['/fish-head-purchase']}><DirtyStateProvider><BackButton/><Routes>
    <Route path="/fish-head-purchase" element={<><Draft/><MoveToDashboard/></>}/>
    <Route path="/dashboard" element={<Link to="/fish-head-purchase" aria-label="reenter-fish">reenter</Link>}/>
    <Route path="/fish-department" element={<Location/>}/>
  </Routes></DirtyStateProvider></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('draft'),{target:{value:'x'}})
  fireEvent.click(screen.getByLabelText('go-dashboard'))
  fireEvent.click(screen.getByLabelText('reenter-fish'))
  fireEvent.click(document.querySelector('button.back-button')!)
  expect(confirm).not.toHaveBeenCalled()
  expect(screen.getByLabelText('route')).toHaveTextContent('/fish-department')
})

it('cancels browser Back before the draft is unmounted, and guards the next attempt',()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  const historyGo=vi.spyOn(window.history,'go').mockImplementation(()=>undefined)
  window.history.replaceState({idx:1},'','/fish-head-purchase')
  render(<BrowserRouter><DirtyStateProvider><BackButton/><Routes><Route path="/fish-head-purchase" element={<Draft/>}/><Route path="/dashboard" element={<p>Dashboard</p>}/></Routes></DirtyStateProvider></BrowserRouter>)
  fireEvent.change(screen.getByLabelText('draft'),{target:{value:'kept'}})
  window.history.replaceState({idx:0},'','/dashboard')
  fireEvent(window,new PopStateEvent('popstate',{state:{idx:0}}))
  expect(confirm).toHaveBeenCalledOnce();expect(historyGo).toHaveBeenCalledWith(1)
  window.history.replaceState({idx:1},'','/fish-head-purchase')
  fireEvent(window,new PopStateEvent('popstate',{state:{idx:1}}))
  expect(screen.getByLabelText('draft')).toHaveValue('kept')
  window.history.replaceState({idx:0},'','/dashboard')
  fireEvent(window,new PopStateEvent('popstate',{state:{idx:0}}))
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(screen.getByLabelText('draft')).toHaveValue('kept')
})

it('clears a saved form and keeps Home, Logout and beforeunload protection for a real draft',()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false),logout=vi.fn()
  render(<MemoryRouter initialEntries={['/retail-sales']}><DirtyStateProvider><BackButton/><Draft/><Link to="/dashboard">Home</Link><button data-navigation-leave onClick={logout}>Logout</button><Location/></DirtyStateProvider></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('draft'),{target:{value:'x'}})
  fireEvent.click(screen.getByText('Home'));fireEvent.click(screen.getByText('Logout'))
  expect(logout).not.toHaveBeenCalled();expect(confirm).toHaveBeenCalledTimes(2)
  const unload=new Event('beforeunload',{cancelable:true});fireEvent(window,unload);expect(unload.defaultPrevented).toBe(true)
  fireEvent.click(screen.getByText('Save'))
  const cleanUnload=new Event('beforeunload',{cancelable:true});fireEvent(window,cleanUnload);expect(cleanUnload.defaultPrevented).toBe(false)
  fireEvent.click(screen.getByText('Home'));expect(confirm).toHaveBeenCalledTimes(2);expect(screen.getByLabelText('route')).toHaveTextContent('/dashboard')
})

it('keeps beforeunload protection if an approved async Logout has not left the form',()=>{
  vi.spyOn(window,'confirm').mockReturnValue(true)
  render(<MemoryRouter><DirtyStateProvider><BackButton/><Draft/><button data-navigation-leave>Logout</button></DirtyStateProvider></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('draft'),{target:{value:'draft'}})
  fireEvent.click(screen.getByText('Logout'))
  const unload=new Event('beforeunload',{cancelable:true});fireEvent(window,unload);expect(unload.defaultPrevented).toBe(true)
})

it.each([
  ['/fish-head-settlement/s1','/fish-head-settlement'],['/fish-meal-settlement/s1','/fish-meal-settlement'],
  ['/retail-sales/history/s1','/retail-sales/history'],['/retail-sales/history/s1/edit','/retail-sales/history/s1'],
  ['/retail-sales/fish','/retail-sales'],['/monthly/2026-10/worker/w1/statement','/monthly'],
  ['/purchases/new','/purchases'],['/purchases/r1','/purchases'],['/purchases/monthly','/purchases'],
  ['/weighing/s1/review','/weighing/s1'],['/weighing/s1','/weighing'],['/ice-department/v1/monthly','/ice-department/v1'],
  ['/workers','/master-data'],['/partners','/master-data'],['/vessels','/master-data'],['/fish-species','/master-data'],['/purchase-categories','/master-data'],
  ['/fish-head-wages','/fish-department'],['/daily','/fish-department'],['/monthly','/fish-department'],
])('returns direct link %s to %s with an empty history stack',(route,parent)=>{
  window.history.replaceState({idx:0},'',window.location.href)
  render(<MemoryRouter initialEntries={[route]}><BackButton/><Location/></MemoryRouter>)
  fireEvent.click(document.querySelector('button.back-button')!)
  expect(screen.getByLabelText('route').textContent).toBe(parent)
})
