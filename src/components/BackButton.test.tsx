import { cleanup,fireEvent,render,screen } from '@testing-library/react'
import { Link,MemoryRouter,Route,Routes,useLocation,useNavigate } from 'react-router-dom'
import { afterEach,expect,it,vi } from 'vitest'
import { BackButton } from './BackButton'

function Location(){return <output aria-label="route">{useLocation().pathname}</output>}

afterEach(()=>{cleanup();window.history.replaceState(null,'',window.location.href);vi.restoreAllMocks()})

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
  fireEvent.click(document.querySelector('button.back-button')!)
  expect(screen.getByLabelText('route')).toHaveTextContent('/dashboard')
})

function MoveToDashboard(){
  const navigate=useNavigate()
  return <button type="button" aria-label="go-dashboard" onClick={()=>navigate('/dashboard')}>go</button>
}

function RestoreOriginal(){
  const navigate=useNavigate()
  return <button type="button" aria-label="restore-original" onClick={()=>navigate(-1)}>restore</button>
}

it('clears detected form state after leaving and re-entering a route',()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  render(<MemoryRouter initialEntries={['/fish-head-purchase']}><BackButton/><Routes>
    <Route path="/fish-head-purchase" element={<><input aria-label="draft"/><MoveToDashboard/></>}/>
    <Route path="/dashboard" element={<Link to="/fish-head-purchase" aria-label="reenter-fish">reenter</Link>}/>
    <Route path="/fish-department" element={<Location/>}/>
  </Routes></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('draft'),{target:{value:'x'}})
  fireEvent.click(screen.getByLabelText('go-dashboard'))
  fireEvent.click(screen.getByLabelText('reenter-fish'))
  fireEvent.click(document.querySelector('button.back-button')!)
  expect(confirm).not.toHaveBeenCalled()
  expect(screen.getByLabelText('route')).toHaveTextContent('/fish-department')
})

it('keeps the dirty guard after a cancelled browser Back is restored',()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  const historyGo=vi.spyOn(window.history,'go').mockImplementation(()=>undefined)
  window.history.replaceState({idx:1},'',window.location.href)
  render(<MemoryRouter initialEntries={['/fish-head-purchase','/dashboard']} initialIndex={0}><BackButton/><Routes>
    <Route path="/fish-head-purchase" element={<><input aria-label="draft"/><button type="button" aria-label="simulate-pop" onClick={()=>window.dispatchEvent(new PopStateEvent('popstate',{state:{idx:0}}))}>simulate</button><MoveToDashboard/></>}/>
    <Route path="/dashboard" element={<RestoreOriginal/>}/>
  </Routes></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('draft'),{target:{value:'x'}})
  fireEvent.click(screen.getByLabelText('simulate-pop'))
  expect(confirm).toHaveBeenCalledOnce()
  expect(historyGo).toHaveBeenCalledWith(1)
  fireEvent.click(screen.getByLabelText('go-dashboard'))
  fireEvent.click(screen.getByLabelText('restore-original'))
  window.dispatchEvent(new PopStateEvent('popstate',{state:{idx:0}}))
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(historyGo).toHaveBeenCalledTimes(2)
  expect(screen.getByLabelText('draft')).toBeInTheDocument()
})
