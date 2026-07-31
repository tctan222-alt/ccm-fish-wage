import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { IceVesselPage } from './IceVesselPage'

describe('冰工船记录页', () => {
  it('保留中文业务数量名称，不自动计算油工金额，并把月尾费用标记为一次性结算', async () => {
    const saver=vi.fn(async record=>record)
    render(<MemoryRouter initialEntries={['/ice-department/v978']}><Routes><Route path="/ice-department/:vesselId" element={<IceVesselPage
      vesselLoader={async()=>[{id:'v978',vesselCode:'978',displayName:'978',defaultSupplierId:'',defaultSupplierNameSnapshot:'',active:true,notes:''}]}
      recordLoader={async()=>[]} saver={saver} today={()=>'2026-07-31'}/>} /></Routes></MemoryRouter>)
    expect(await screen.findByRole('heading',{name:'冰工船 978'})).toBeInTheDocument()
    expect(screen.getByLabelText('工厂木桶数量')).toBeInTheDocument()
    expect(screen.getByText('0.02 的币值和计量单位尚待确认，系统不会自动计算油工金额。')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('本月尾结算计入一次'))
    fireEvent.click(screen.getByRole('button',{name:'保存记录'}))
    expect(await screen.findByText('月尾已计入：船头费 RM 500.00；书记费 RM 250.00')).toBeInTheDocument()
    expect(saver).toHaveBeenCalledWith(expect.objectContaining({monthEndSettlement:true,oilWorkRateCents:null,oilWorkAmountCents:null,headmanFeeCents:50_000,clerkFeeCents:25_000}))
  })
})
