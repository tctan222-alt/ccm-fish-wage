import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IceVesselPage } from './IceVesselPage'
afterEach(()=>{cleanup();vi.clearAllMocks()})
describe('冰工船记录页',()=>{
  it('按公斤、半箱、柴油和材料费即时计算，再保存草稿',async()=>{
    const saver=vi.fn(async record=>record)
    render(<MemoryRouter initialEntries={['/ice-department/v978']}><Routes><Route path="/ice-department/:vesselId" element={<IceVesselPage vesselLoader={async()=>[{id:'v978',vesselCode:'978',displayName:'978',defaultSupplierId:'',defaultSupplierNameSnapshot:'',active:true,notes:''}]} recordLoader={async()=>[]} saver={saver} today={()=>'31/07/2026'}/>} /></Routes></MemoryRouter>)
    expect(await screen.findByRole('heading',{name:'冰工船 978'})).toBeInTheDocument();fireEvent.change(screen.getByLabelText('木斑什进厂重量（kg）'),{target:{value:'125'}});fireEvent.change(screen.getByLabelText('冰箱子数量（箱）'),{target:{value:'1.5'}});fireEvent.change(screen.getByLabelText('柴油数量（公升）'),{target:{value:'0.5'}});expect(screen.getByText('本次合计：RM 57.51')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));expect(await screen.findByText('草稿')).toBeInTheDocument();expect(saver).toHaveBeenCalledWith(expect.objectContaining({workDate:'31/07/2026',factoryIncomingWeightGrams:125_000,iceBoxHalfUnits:3,dieselVolumeMilliliters:500,recordTotalCents:5_751}))
  })

  it('确认失败时保留已保存的草稿，避免重试建立重复记录',async()=>{
    const saver=vi.fn(async record=>record), confirmer=vi.fn(async()=>{throw new Error('确认失败')})
    render(<MemoryRouter initialEntries={['/ice-department/v978']}><Routes><Route path="/ice-department/:vesselId" element={<IceVesselPage vesselLoader={async()=>[{id:'v978',vesselCode:'978',displayName:'978',defaultSupplierId:'',defaultSupplierNameSnapshot:'',active:true,notes:''}]} recordLoader={async()=>[]} saver={saver} confirmer={confirmer} today={()=>'31/07/2026'}/>} /></Routes></MemoryRouter>)
    await screen.findByRole('heading',{name:'冰工船 978'})
    fireEvent.click(screen.getByRole('button',{name:'确认新记录'}))
    expect(await screen.findByText('草稿')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'确认新记录'})).toBeDisabled()
    expect(screen.getByRole('button',{name:'确认记录'})).toBeEnabled()
    expect(saver).toHaveBeenCalledOnce()
  })
})
