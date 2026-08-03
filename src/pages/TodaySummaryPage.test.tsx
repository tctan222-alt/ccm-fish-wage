import { render,screen } from '@testing-library/react'
import { MemoryRouter,Route,Routes } from 'react-router-dom'
import { describe,expect,it,vi } from 'vitest'
import { TodaySummaryPage } from './TodaySummaryPage'

describe('切鱼头工钱当日汇总',()=>{
  it('跟随所选日期读取，并兼容没有新日期字段的旧工资记录',async()=>{
    const loader=vi.fn(async()=>({entries:[{
      id:'legacy-wage',dateKey:'2026-07-31',workerId:'w1',workerName:'旧工人',weightKg:80,rateRm:'0.12',wageRm:'9.60',createdBy:'u1',deleted:false,
    }],voids:[]}))
    render(<MemoryRouter initialEntries={['/today?date=2026-07-31']}><Routes><Route path="/today" element={<TodaySummaryPage loader={loader}/>}/></Routes></MemoryRouter>)
    expect(await screen.findByRole('heading',{name:'Daily Summary'})).toBeInTheDocument()
    expect(loader).toHaveBeenCalledWith('2026-07-31')
    expect(screen.getByRole('heading',{name:'旧工人'})).toBeInTheDocument()
    expect(screen.getByText('80kg × RM0.12')).toBeInTheDocument()
  })
})
