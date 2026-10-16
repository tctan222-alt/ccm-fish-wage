import { cleanup,fireEvent,render,screen,within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import type { FishSpeciesRecord } from '../lib/weighing'
import { FishSpeciesPage } from './FishSpeciesPage'

const species=(changes:Partial<FishSpeciesRecord>={}):FishSpeciesRecord=>({id:'unpriced',speciesCode:'unpriced',displayName:'未定价鱼',active:true,order:1,notes:'',...changes})
afterEach(cleanup)
async function edit(item:FishSpeciesRecord){
  const saver=vi.fn(async(next:FishSpeciesRecord)=>({...next,updatedBy:'master-user'}))
  render(<MemoryRouter><FishSpeciesPage loader={async()=>[item]} saver={saver}/></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button',{name:'修改鱼名 / 基础价 Edit'}))
  const dialog=screen.getByRole('dialog')
  return {saver,dialog,input:within(dialog).getByRole('textbox',{name:'基础默认价 Base default (RM/kg)'})}
}

describe('Fish Head Master price editing',()=>{
  it('shows unpriced fish and allows a blank/null price to be filled as integer cents',async()=>{
    const {saver,input}=await edit(species({basePriceCentsPerKg:null}))
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('inputmode','decimal')
    expect(screen.getByText(/基础默认价 Base default：未设默认价/)).toBeInTheDocument()
    fireEvent.change(input,{target:{value:'2.60'}})
    fireEvent.click(screen.getByRole('button',{name:'保存'}))
    await screen.findByText('基础默认价 Base default：RM2.60/kg')
    expect(saver).toHaveBeenCalledWith(expect.objectContaining({id:'unpriced',basePriceCentsPerKg:260}))
  })
  it('loads and edits an existing base price without a vessel premium',async()=>{
    const original=species({id:'jin_xian',speciesCode:'jin_xian',displayName:'金线',basePriceCentsPerKg:250})
    const {saver,input}=await edit(original)
    expect(input).toHaveValue('2.50')
    fireEvent.change(input,{target:{value:'2.70'}})
    fireEvent.click(screen.getByRole('button',{name:'保存'}))
    await screen.findByText('基础默认价 Base default：RM2.70/kg')
    expect(saver).toHaveBeenCalledWith(expect.objectContaining({basePriceCentsPerKg:270}))
    expect(original.basePriceCentsPerKg).toBe(250)
  })
  it('displays an existing legacy default without silently persisting it',async()=>{
    const {input,saver}=await edit(species({id:'jin_xian',speciesCode:'jin_xian',displayName:'金线'}))
    expect(input).toHaveValue('2.05')
    expect(saver).not.toHaveBeenCalled()
  })
  it('can explicitly clear an existing default price',async()=>{
    const {input,saver}=await edit(species({basePriceCentsPerKg:245}))
    fireEvent.change(input,{target:{value:''}})
    fireEvent.click(screen.getByRole('button',{name:'保存'}))
    await screen.findByText('基础默认价 Base default：未设默认价 Not set')
    expect(saver).toHaveBeenCalledWith(expect.objectContaining({basePriceCentsPerKg:null}))
  })
  it.each(['-2.50','2.555','0','abc'])('rejects invalid/negative price %s without saving',async price=>{
    const {input,saver,dialog}=await edit(species())
    fireEvent.change(input,{target:{value:price}})
    fireEvent.click(screen.getByRole('button',{name:'保存'}))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('基础默认价')
    expect(saver).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button',{name:'保存'})).toBeEnabled()
  })
})
