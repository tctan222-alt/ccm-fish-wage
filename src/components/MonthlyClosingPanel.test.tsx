import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import type { StoredWageEntry } from '../services/wages'
import type { WageMonthClosingData } from '../services/monthClosing'
import { MonthlyClosingPanel } from './MonthlyClosingPanel'
import { BackButton } from './BackButton'
import { DirtyStateProvider } from './DirtyStateProvider'

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
  render(<MemoryRouter><DirtyStateProvider><BackButton/><MonthlyClosingPanel {...props}/></DirtyStateProvider></MemoryRouter>)
  return props
}

describe('monthly closing panel',()=>{
  it('shows an open month from live records and confirms close totals',()=>{
    renderPanel({month:null,statements:[],payments:[]})
    expect(screen.getByText('未结月 Open',{selector:'.month-status'})).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'结月 Close Month'}))
    const dialog=screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('July 2026')
    expect(dialog).toHaveTextContent('Workers1')
    expect(dialog).toHaveTextContent('Baskets1')
    expect(dialog).toHaveTextContent('74kg')
    expect(dialog).toHaveTextContent('RM8.88')
  })

  it('closes only after explicit confirmation',async()=>{
    const props=renderPanel({month:null,statements:[],payments:[]})
    fireEvent.click(screen.getByRole('button',{name:'结月 Close Month'}))
    fireEvent.click(screen.getByRole('button',{name:'确认结月 Confirm Close Month'}))
    await waitFor(()=>expect(props.onClose).toHaveBeenCalledWith('2026-07'))
  })

  it('shows partial and paid statuses from closed statement snapshots',()=>{
    renderPanel(closedData)
    expect(screen.getByText('已结月 Closed',{selector:'.month-status'})).toBeInTheDocument()
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

  it.each(['Mark Paid in Full','Add Partial Payment'])('keeps a newly opened %s form clean until edited',action=>{
    renderPanel(closedData)
    fireEvent.click(screen.getByRole('button',{name:action}))
    expect(screen.getByRole('form',{name:'Payment for Ah Mei'})).toBeInTheDocument()
    const unload=new Event('beforeunload',{cancelable:true});fireEvent(window,unload)
    expect(unload.defaultPrevented).toBe(false)
  })

  it.each([
    ['Amount (RM)','9.00'],['Payment method','bank'],['Payment date','2026-07-20'],
    ['Reference (optional)','REF-123'],['Note (optional)','Payment draft'],
  ])('guards a changed %s and clears the warning when reverted',(label,value)=>{
    renderPanel(closedData)
    fireEvent.click(screen.getByRole('button',{name:'Mark Paid in Full'}))
    const field=screen.getByLabelText(label),original=(field as HTMLInputElement).value
    fireEvent.change(field,{target:{value}})
    let unload=new Event('beforeunload',{cancelable:true});fireEvent(window,unload)
    expect(unload.defaultPrevented).toBe(true)
    fireEvent.change(field,{target:{value:original}})
    unload=new Event('beforeunload',{cancelable:true});fireEvent(window,unload)
    expect(unload.defaultPrevented).toBe(false)
  })

  it.each([true,false])('clears only a successfully saved payment draft (success=%s)',async succeeds=>{
    const props=renderPanel(closedData,{onPayment:vi.fn(async()=>{if(!succeeds)throw new Error('Local save failed')})})
    fireEvent.click(screen.getByRole('button',{name:'Add Partial Payment'}))
    fireEvent.change(screen.getByLabelText('Amount (RM)'),{target:{value:'5.00'}})
    let unload=new Event('beforeunload',{cancelable:true});fireEvent(window,unload)
    expect(unload.defaultPrevented).toBe(true)
    fireEvent.click(screen.getByRole('button',{name:'Save payment'}))
    await waitFor(()=>expect(props.onPayment).toHaveBeenCalledWith(expect.objectContaining({amountCents:500})))
    if(succeeds)await waitFor(()=>expect(screen.queryByRole('form',{name:'Payment for Ah Mei'})).not.toBeInTheDocument())
    else{
      expect(await screen.findByRole('alert')).toHaveTextContent('Local save failed')
      expect(screen.getByLabelText('Amount (RM)')).toHaveValue('5.00')
    }
    unload=new Event('beforeunload',{cancelable:true});fireEvent(window,unload)
    expect(unload.defaultPrevented).toBe(!succeeds)
  })

  it('establishes fresh defaults after cancelling and reopening a payment form',()=>{
    renderPanel(closedData)
    fireEvent.click(screen.getByRole('button',{name:'Add Partial Payment'}))
    fireEvent.change(screen.getByLabelText('Amount (RM)'),{target:{value:'5.00'}})
    fireEvent.change(screen.getByLabelText('Note (optional)'),{target:{value:'Cancelled draft'}})
    fireEvent.click(screen.getByRole('button',{name:'取消 Cancel'}))
    fireEvent.click(screen.getByRole('button',{name:'Mark Paid in Full'}))
    expect(screen.getByLabelText('Amount (RM)')).toHaveValue('14.53')
    expect(screen.getByLabelText('Note (optional)')).toHaveValue('')
    const unload=new Event('beforeunload',{cancelable:true});fireEvent(window,unload)
    expect(unload.defaultPrevented).toBe(false)
  })

  it('blocks reopen controls until all payments are voided',()=>{
    const {rerender}=render(<MemoryRouter><MonthlyClosingPanel
      monthKey="2026-07" liveEntries={liveEntries} data={closedData}
      onClose={vi.fn()} onPayment={vi.fn()} onVoidPayment={vi.fn()} onReopen={vi.fn()}
    /></MemoryRouter>)
    expect(screen.getByRole('button',{name:'重新开月 Reopen Month'})).toBeDisabled()

    rerender(<MemoryRouter><MonthlyClosingPanel
      monthKey="2026-07" liveEntries={liveEntries}
      data={{...closedData,month:{...closedData.month!,paidCents:0}}}
      onClose={vi.fn()} onPayment={vi.fn()} onVoidPayment={vi.fn()} onReopen={vi.fn()}
    /></MemoryRouter>)
    expect(screen.getByRole('button',{name:'重新开月 Reopen Month'})).toBeEnabled()
  })
})
