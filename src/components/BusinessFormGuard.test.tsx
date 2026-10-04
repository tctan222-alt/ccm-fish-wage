import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { BackButton } from './BackButton'
import { BusinessFormGuard } from './BusinessFormGuard'
import { DirtyStateProvider } from './DirtyStateProvider'

afterEach(()=>{cleanup();vi.restoreAllMocks()})
function ExistingForm(){const[value,setValue]=useState('');return <form><input aria-label="business field" value={value} onChange={e=>setValue(e.target.value)}/><button type="button" onClick={()=>setValue('')}>Save and reset</button></form>}
it('opts native business forms in without marking surrounding filters dirty, and observes form reset',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  render(<MemoryRouter initialEntries={['/vessel-trips/new']}><DirtyStateProvider><BackButton/><BusinessFormGuard><input aria-label="search"/><ExistingForm/></BusinessFormGuard></DirtyStateProvider></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('search'),{target:{value:'query'}})
  let unload=new Event('beforeunload',{cancelable:true});fireEvent(window,unload);expect(unload.defaultPrevented).toBe(false)
  fireEvent.change(screen.getByLabelText('business field'),{target:{value:'unsaved'}})
  fireEvent.click(screen.getByRole('button',{name:'返回'}));expect(confirm).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByText('Save and reset'))
  await waitFor(()=>{unload=new Event('beforeunload',{cancelable:true});fireEvent(window,unload);expect(unload.defaultPrevented).toBe(false)})
})

function RetainingForm({succeeds}:{succeeds:boolean}){
  const[amount,setAmount]=useState(''),[method,setMethod]=useState('cash')
  return <form onSubmit={async event=>{event.preventDefault();await Promise.resolve();if(succeeds)setAmount('')}}><select aria-label="method" value={method} onChange={e=>setMethod(e.target.value)}><option value="cash">Cash</option><option value="bank">Bank</option></select><input aria-label="amount" value={amount} onChange={e=>setAmount(e.target.value)}/><button>Save</button></form>
}
it.each([true,false])('clears only a successful submitted form reset, retaining context (success=%s)',async succeeds=>{
  render(<MemoryRouter><DirtyStateProvider><BackButton/><BusinessFormGuard><RetainingForm succeeds={succeeds}/></BusinessFormGuard></DirtyStateProvider></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('method'),{target:{value:'bank'}});fireEvent.change(screen.getByLabelText('amount'),{target:{value:'10'}})
  fireEvent.click(screen.getByText('Save'))
  await waitFor(()=>expect(screen.getByLabelText('amount')).toHaveValue(succeeds?'':'10'))
  await waitFor(()=>{const unload=new Event('beforeunload',{cancelable:true});fireEvent(window,unload);expect(unload.defaultPrevented).toBe(!succeeds)})
  expect(screen.getByLabelText('method')).toHaveValue('bank')
})

it('does not treat a user clearing an unsuccessful submission as a saved form',async()=>{
  render(<MemoryRouter><DirtyStateProvider><BackButton/><BusinessFormGuard><RetainingForm succeeds={false}/></BusinessFormGuard></DirtyStateProvider></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('method'),{target:{value:'bank'}})
  fireEvent.change(screen.getByLabelText('amount'),{target:{value:'10'}})
  fireEvent.click(screen.getByText('Save'))
  await waitFor(()=>expect(screen.getByLabelText('amount')).toHaveValue('10'))
  fireEvent.change(screen.getByLabelText('amount'),{target:{value:''}})
  const unload=new Event('beforeunload',{cancelable:true});fireEvent(window,unload)
  expect(unload.defaultPrevented).toBe(true)
})
