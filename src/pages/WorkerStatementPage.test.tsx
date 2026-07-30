import { cleanup,fireEvent,render,screen } from '@testing-library/react'
import { MemoryRouter,Route,Routes } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { WorkerStatementPage } from './WorkerStatementPage'
import type { WageMonthClosingData } from '../services/monthClosing'

afterEach(()=>{
  cleanup()
  vi.restoreAllMocks()
})

const data:WageMonthClosingData={
  month:{
    monthKey:'2026-07',status:'closed',closeVersion:2,workerCount:1,basketCount:3,
    totalWeightKg:205,totalWageCents:3153,paidCents:500,closedBy:'admin',reopenedBy:null,lastActionId:'payment_create_p1',
    closingToken:null,closingBy:null,closingAt:null,statementIds:['2_w1'],
  },
  statements:[{
    id:'2_w1',monthKey:'2026-07',closeVersion:2,workerId:'w1',workerName:'Ah Mei',
    basketCount:3,totalWeightKg:205,wageCents:3153,paidCents:500,
    rateBreakdown:{rate12Cents:888,rate15Cents:1065,rate18Cents:0,customCents:1200},createdBy:'admin',lastActionId:'payment_create_p1',
  }],
  payments:[{
    id:'p1',monthKey:'2026-07',closeVersion:2,workerId:'w1',workerName:'Ah Mei',
    statementId:'2_w1',amountCents:500,method:'cash',paymentDate:'2026-07-31',
    reference:'PAY-1',note:'Advance',createdBy:'admin',voided:false,voidReason:null,voidedBy:null,
  }],
}

describe('worker month statement',()=>{
  it('shows snapshot totals, rate breakdown, balance, and payment history',async()=>{
    render(<MemoryRouter initialEntries={['/monthly/2026-07/worker/w1/statement']}>
      <Routes><Route path="/monthly/:monthKey/worker/:workerId/statement" element={<WorkerStatementPage loader={vi.fn(async()=>data)}/>} /></Routes>
    </MemoryRouter>)

    expect(await screen.findByRole('heading',{name:'Worker Month Statement'})).toBeInTheDocument()
    expect(screen.getAllByText('CCM Fishery')).toHaveLength(2)
    expect(screen.getByText('Ah Mei')).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveTextContent('July 2026')
    expect(screen.getByRole('main')).toHaveTextContent('Baskets3')
    expect(screen.getByRole('main')).toHaveTextContent('Total kg205kg')
    expect(screen.getByRole('main')).toHaveTextContent('RM0.12RM8.88')
    expect(screen.getByRole('main')).toHaveTextContent('RM0.15RM10.65')
    expect(screen.getByRole('main')).toHaveTextContent('RM0.18RM0.00')
    expect(screen.getByRole('main')).toHaveTextContent('CustomRM12.00')
    expect(screen.getByRole('main')).toHaveTextContent('Gross wageRM31.53')
    expect(screen.getByRole('main')).toHaveTextContent('PaidRM5.00')
    expect(screen.getByRole('main')).toHaveTextContent('BalanceRM26.53')
    expect(screen.getByRole('main')).toHaveTextContent('2026-07-31')
    expect(screen.getByRole('main')).toHaveTextContent('PAY-1')
  })

  it('uses the browser print command',async()=>{
    const print=vi.spyOn(window,'print').mockImplementation(()=>{})
    render(<MemoryRouter initialEntries={['/monthly/2026-07/worker/w1/statement']}>
      <Routes><Route path="/monthly/:monthKey/worker/:workerId/statement" element={<WorkerStatementPage loader={vi.fn(async()=>data)}/>} /></Routes>
    </MemoryRouter>)
    fireEvent.click(await screen.findByRole('button',{name:'Print / Save PDF'}))
    expect(print).toHaveBeenCalledOnce()
  })
})
