import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import type { StoredWageEntry } from '../services/wages'
import type { WageMonthClosingData } from '../services/monthClosing'
import { MonthlyClosingPanel } from './MonthlyClosingPanel'

afterEach(cleanup)

const liveEntries:StoredWageEntry[]=[
  {id:'e1',dateKey:'2026-07-01',workerId:'w1',workerName:'Ah Mei',weightKg:74,rateRm:'0.12',wageRm:'8.88',createdBy:'admin',deleted:false},
]

const closedData:WageMonthClosingData={
  month:{
    monthKey:'2026-07',status:'closed',closeVersion:1,workerCount:2,basketCount:3,
    totalWeightKg:225,totalWageCents:3393,paidCents:888,closedBy:'admin',reopenedBy:null,lastActionId:'close_1',
    closingToken:null,closingBy:null,closingAt:null,statementIds:['1_w1','1_w2'],
  },
  statements:[
    {
      id:'1_w1',monthKey:'2026-07',closeVersion:1,workerId:'w1',workerName:'Ah Mei',
      basketCount:2,totalWeightKg:145,wageCents:1953,paidCents:500,
      rateBreakdown:{rate12Cents:888,rate15Cents:1065,rate18Cents:0,customCents:0},createdBy:'admin',lastActionId:'close_1',
    },
    {
      id:'1_w2',monthKey:'2026-07',closeVersion:1,workerId:'w2',workerName:'Ali',
      basketCount:1,totalWeightKg:80,wageCents:1440,paidCents:1440,
      rateBreakdown:{rate12Cents:0,rate15Cents:0,rate18Cents:1440,customCents:0},createdBy:'admin',lastActionId:'close_1',
    },
  ],
  payments:[],
}

function renderPanel(data:WageMonthClosingData,overrides:Partial<Parameters<typeof MonthlyClosingPanel>[0]>={}){
  const props={
    monthKey:'2026-07',
    liveEntries,
    data,
    onClose:vi.fn(async()=>{}),
    onPayment:vi.fn(async()=>{}),
    onVoidPayment:vi.fn(async()=>{}),
    onReopen:vi.fn(async()=>{}),
    ...overrides,
  }
  render(<MemoryRouter><MonthlyClosingPanel {...props}/></MemoryRouter>)
  return props
}

describe('monthly closing panel',()=>{
  it('shows an open month from live records and confirms close totals',()=>{
    renderPanel({month:null,statements:[],payments:[]})
    expect(screen.getByText('Open',{selector:'.month-status'})).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Close Month'}))
    const dialog=screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('July 2026')
    expect(dialog).toHaveTextContent('Workers1')
    expect(dialog).toHaveTextContent('Baskets1')
    expect(dialog).toHaveTextContent('74kg')
    expect(dialog).toHaveTextContent('RM8.88')
  })

  it('closes only after explicit confirmation',async()=>{
    const props=renderPanel({month:null,statements:[],payments:[]})
    fireEvent.click(screen.getByRole('button',{name:'Close Month'}))
    fireEvent.click(screen.getByRole('button',{name:'Confirm Close Month'}))
    await waitFor(()=>expect(props.onClose).toHaveBeenCalledWith('2026-07'))
  })

  it('shows partial and paid statuses from closed statement snapshots',()=>{
    renderPanel(closedData)
    expect(screen.getByText('Closed',{selector:'.month-status'})).toBeInTheDocument()
    const ahMei=screen.getByRole('heading',{name:'Ah Mei'}).closest('section')!
    expect(ahMei).toHaveTextContent('Partial')
    expect(ahMei).toHaveTextContent('PaidRM5.00')
    expect(ahMei).toHaveTextContent('BalanceRM14.53')
    const ali=screen.getByRole('heading',{name:'Ali'}).closest('section')!
    expect(ali).toHaveTextContent('Paid')
  })

  it('defaults Mark Paid in Full to the statement balance',async()=>{
    const props=renderPanel(closedData)
    const card=screen.getByRole('heading',{name:'Ah Mei'}).closest('section')!
    fireEvent.click(within(card).getByRole('button',{name:'Mark Paid in Full'}))
    const form=screen.getByRole('form',{name:'Payment for Ah Mei'})
    expect(within(form).getByLabelText('Amount (RM)')).toHaveValue('14.53')
    fireEvent.click(within(form).getByRole('button',{name:'Save payment'}))
    await waitFor(()=>expect(props.onPayment).toHaveBeenCalledWith(expect.objectContaining({
      monthKey:'2026-07',statementId:'1_w1',amountCents:1453,
    })))
  })

  it('blocks reopen controls until all payments are voided',()=>{
    const {rerender}=render(<MemoryRouter><MonthlyClosingPanel
      monthKey="2026-07" liveEntries={liveEntries} data={closedData}
      onClose={vi.fn()} onPayment={vi.fn()} onVoidPayment={vi.fn()} onReopen={vi.fn()}
    /></MemoryRouter>)
    expect(screen.getByRole('button',{name:'Reopen Month'})).toBeDisabled()

    rerender(<MemoryRouter><MonthlyClosingPanel
      monthKey="2026-07" liveEntries={liveEntries}
      data={{...closedData,month:{...closedData.month!,paidCents:0}}}
      onClose={vi.fn()} onPayment={vi.fn()} onVoidPayment={vi.fn()} onReopen={vi.fn()}
    /></MemoryRouter>)
    expect(screen.getByRole('button',{name:'Reopen Month'})).toBeEnabled()
  })
})
