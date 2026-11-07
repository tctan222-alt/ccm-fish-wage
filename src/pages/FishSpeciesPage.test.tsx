import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
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
  it('cannot enable browser bulk writes through a build-time flag',async()=>{
    vi.stubEnv('VITE_APPROVED_QL_MASTER_WRITES','true')
    try{
      const saver=vi.fn(),initializer=vi.fn()
      render(<MemoryRouter><FishSpeciesPage loader={async()=>[]} saver={saver} initializer={initializer}/></MemoryRouter>)
      fireEvent.click(await screen.findByText('审阅 QL 34组非底船 Master 候选（只读）'))
      expect(screen.queryByRole('button',{name:'确认采用36组新基础默认价'})).not.toBeInTheDocument()
      expect(screen.getByRole('button',{name:'下载34组非底船审核对照（不执行）'})).toBeEnabled()
      expect(saver).not.toHaveBeenCalled();expect(initializer).not.toHaveBeenCalled()
    }finally{vi.unstubAllEnvs()}
  })
  it('previews only 34 non-bottom groups and conflicting old prices without writing Master',async()=>{
    const saver=vi.fn(),initializer=vi.fn()
    const items=[species({id:'ding_wen',speciesCode:'ding_wen',displayName:'丁温',basePriceCentsPerKg:190})]
    const before=JSON.stringify(items)
    render(<MemoryRouter><FishSpeciesPage loader={async()=>items} saver={saver} initializer={initializer}/></MemoryRouter>)
    fireEvent.click(await screen.findByText('审阅 QL 34组非底船 Master 候选（只读）'))
    const table=screen.getByRole('table',{name:'未来基础默认价对照（不含船号加价）'})
    expect(within(table).getAllByRole('row')).toHaveLength(35)
    expect(within(table).getAllByText('独立空价组（保留旧鱼）')).toHaveLength(1)
    expect(within(table).getAllByText(/丁温.*RM1.90/)).toHaveLength(1)
    expect(within(table).getByText('25. 加晒/丁温/目孔(拖网)')).toBeInTheDocument()
    expect(within(table).queryByText('35. 丁温/目孔/加西（底船）')).not.toBeInTheDocument()
    expect(within(table).queryByText('36. 青兰（底船）')).not.toBeInTheDocument()
    expect(within(table).getAllByText('留空（按当天行情）')).toHaveLength(2)
    expect(saver).not.toHaveBeenCalled()
    expect(initializer).not.toHaveBeenCalled()
    expect(JSON.stringify(items)).toBe(before)
  })
  it('keeps market-conflicting generic 青兰 at an explicit blank default instead of applying QL price',async()=>{
    const original=[species({id:'qing_lan',speciesCode:'qing_lan',displayName:'青兰',basePriceCentsPerKg:null})]
    const saver=vi.fn()
    render(<MemoryRouter><FishSpeciesPage loader={async()=>original} saver={saver}/></MemoryRouter>)
    fireEvent.click(await screen.findByText('审阅 QL 34组非底船 Master 候选（只读）'))
    const table=screen.getByRole('table',{name:'未来基础默认价对照（不含船号加价）'})
    expect(within(table).getAllByText('留空（按当天行情）')).toHaveLength(2)
    expect(within(table).queryByText('36. 青兰（底船）')).not.toBeInTheDocument()
    expect(saver).not.toHaveBeenCalled()
  })
  it('does not crash or retain obsolete separate-group choices when a previously inactive fish is reactivated',async()=>{
    const old=species({id:'jin_xian',speciesCode:'jin_xian',displayName:'金线',
      active:false,basePriceCentsPerKg:205})
    const saver=vi.fn(async(next:FishSpeciesRecord)=>next)
    render(<MemoryRouter><FishSpeciesPage loader={async()=>[old]} saver={saver}/></MemoryRouter>)
    fireEvent.click(await screen.findByText('审阅 QL 34组非底船 Master 候选（只读）'))
    const choice=screen.getByRole('checkbox',{name:'单独建立空默认价来源组，保留现有鱼名和旧价格'})
    fireEvent.click(choice)
    expect(choice).toBeChecked()
    expect(screen.getByText('独立空价组（保留旧鱼）')).toBeInTheDocument()
    expect(screen.getAllByText('留空（按当天行情）')).toHaveLength(3)
    expect(screen.getByText('QL 来源参考价 RM2.10，不作为 Master 默认价')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'重新启用'}))
    await waitFor(()=>{
      expect(screen.getByText(/未解决冲突 0/)).toBeInTheDocument()
      expect(screen.queryByRole('checkbox',{name:'单独建立空默认价来源组，保留现有鱼名和旧价格'})).not.toBeInTheDocument()
    })
    expect(saver).toHaveBeenCalledWith(expect.objectContaining({id:'jin_xian',active:true}))
  })
  it('does not present an empty-Master plan when the Master load failed',async()=>{
    render(<MemoryRouter><FishSpeciesPage loader={async()=>{throw new Error('offline')}}/></MemoryRouter>)
    await screen.findByRole('alert')
    expect(screen.queryByText('审阅 QL 34组非底船 Master 候选（只读）')).not.toBeInTheDocument()
  })
  it('distinguishes unchanged matches from proposed price modifications',async()=>{
    const items=[species({id:'jin_xian',speciesCode:'jin_xian',displayName:'金线',basePriceCentsPerKg:205}),
      species({id:'hong_mu_lin',speciesCode:'hong_mu_lin',displayName:'红目林',basePriceCentsPerKg:275})]
    render(<MemoryRouter><FishSpeciesPage loader={async()=>items}/></MemoryRouter>)
    fireEvent.click(await screen.findByText('审阅 QL 34组非底船 Master 候选（只读）'))
    expect(screen.getByText(/拟修改基础价 1 · 同价 1/)).toBeInTheDocument()
  })
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
