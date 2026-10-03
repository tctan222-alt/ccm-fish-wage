import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { BackButton } from './BackButton'
import { DirtyStateProvider } from './DirtyStateProvider'
import { useUnsavedForm } from './dirtyState'
afterEach(()=>{cleanup();vi.restoreAllMocks()})
function Form({name}:{name:string}){const[value,setValue]=useState('');const saved=useUnsavedForm(value);return <><input aria-label={name} value={value} onChange={e=>setValue(e.target.value)}/><button onClick={saved}>Save {name}</button></>}
it('retains another business draft when a nested form saves',()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  render(<MemoryRouter><DirtyStateProvider><BackButton/><Form name="invoice"/><Form name="master"/></DirtyStateProvider></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('invoice'),{target:{value:'invoice draft'}})
  fireEvent.change(screen.getByLabelText('master'),{target:{value:'fish'}})
  fireEvent.click(screen.getByText('Save master'))
  fireEvent(window,new Event('ccm:form-saved'))
  fireEvent.click(screen.getByRole('button',{name:'返回'}));expect(confirm).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByText('Save invoice'))
  const unload=new Event('beforeunload',{cancelable:true});fireEvent(window,unload);expect(unload.defaultPrevented).toBe(false)
})
