import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { IceVesselPage } from './IceVesselPage'
describe('冰工船记录页',()=>{
  it('按公斤、半箱、柴油和材料费即时计算，再保存草稿',async()=>{
    const saver=vi.fn(async record=>record)
    render(<MemoryRouter initialEntries={['/ice-department/v978']}><Routes><Route path="/ice-department/:vesselId" element={<IceVesselPage vesselLoader={async()=>[{id:'v978',vesselCode:'978',displayName:'978',defaultSupplierId:'',defaultSupplierNameSnapshot:'',active:true,notes:''}]} recordLoader={async()=>[]} saver={saver} today={()=>'31/07/2026'}/>} /></Routes></MemoryRouter>)
    expect(await screen.findByRole('heading',{name:'冰工船 978'})).toBeInTheDocument();fireEvent.change(screen.getByLabelText('木斑什进厂重量（kg）'),{target:{value:'125.5'}});fireEvent.change(screen.getByLabelText('冰箱子数量（箱）'),{target:{value:'1.5'}});fireEvent.change(screen.getByLabelText('柴油数量（公升）'),{target:{value:'0.5'}});expect(screen.getByText('本次合计：RM 57.56')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));expect(await screen.findByText('草稿')).toBeInTheDocument();expect(saver).toHaveBeenCalledWith(expect.objectContaining({workDate:'31/07/2026',factoryIncomingWeightGrams:125_500,iceBoxHalfUnits:3,dieselVolumeMilliliters:500,recordTotalCents:5_756}))
  })
})
