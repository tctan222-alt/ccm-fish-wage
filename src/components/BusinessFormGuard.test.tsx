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
