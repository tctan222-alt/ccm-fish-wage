import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { MonthlySummaryPage } from './MonthlySummaryPage'
import type { MonthlyWageData } from '../services/wages'

afterEach(()=>{
  cleanup()
  vi.clearAllMocks()
})

const data:MonthlyWageData={
  monthKey:'2026-07',
  entries:[
    {
      id:'e1',
      dateKey:'2026-07-01',
      workerId:'w1',
      workerName:'Ah Mei',
      weightKg:74,
      rateRm:'0.12',
      wageRm:'8.88',
      createdBy:'admin',
      deleted:false,
    },
    {
      id:'e2',
      dateKey:'2026-07-02',
      workerId:'w1',
      workerName:'Ah Mei',
      weightKg:71,
      rateRm:'0.15',
      wageRm:'10.65',
      createdBy:'admin',
      deleted:false,
    },
    {
      id:'e3',
      dateKey:'2026-07-02',
      workerId:'w2',
      workerName:'Ali',
      weightKg:80,
      rateRm:'0.18',
      wageRm:'14.40',
      createdBy:'admin',
      deleted:false,
    },
  ],
  voids:[
    {
      id:'v1',
      entryId:'e4',
      dateKey:'2026-07-03',
      workerId:'w2',
      workerName:'Ali',
      weightKg:60,
      rateRm:'0.12',
      wageRm:'7.20',
      voidReason:'Wrong kg',
      voidedBy:'admin',
    },
  ],
}

function setup(loader=vi.fn(async()=>data)){
  render(
    <MemoryRouter>
      <MonthlySummaryPage loader={loader}/>
    </MemoryRouter>,
  )
  return loader
}

describe('monthly summary',()=>{
  it('summarizes active wages by month, worker, and day',async()=>{
    setup()

    expect(await screen.findByRole('heading',{name:'Monthly Summary'})).toBeInTheDocument()
    expect(await screen.findByText('July 2026')).toBeInTheDocument()

    const grandTotal=screen.getByRole('region',{name:'Monthly totals'})
    expect(grandTotal).toHaveTextContent('Workers2')
    expect(grandTotal).toHaveTextContent('Work days2')
    expect(grandTotal).toHaveTextContent('Baskets3')
    expect(grandTotal).toHaveTextContent('Total kg225kg')
    expect(grandTotal).toHaveTextContent('Total wageRM33.93')
    expect(grandTotal).toHaveTextContent('Voided1')

    const ahMeiCard=screen.getByRole('heading',{name:'Ah Mei'}).closest('section')!
    expect(ahMeiCard).toHaveTextContent('Baskets2')
    expect(ahMeiCard).toHaveTextContent('Total kg145kg')
    expect(ahMeiCard).toHaveTextContent('Total wageRM19.53')
    expect(ahMeiCard).toHaveTextContent('RM0.12RM8.88')
    expect(ahMeiCard).toHaveTextContent('RM0.15RM10.65')
    expect(ahMeiCard).toHaveTextContent('RM0.18RM0.00')
    expect(ahMeiCard).toHaveTextContent('Custom rateRM0.00')

    fireEvent.click(within(ahMeiCard).getByText('View daily totals and basket details'))
    expect(ahMeiCard).toHaveTextContent('Wed, 1 Jul')
    expect(ahMeiCard).toHaveTextContent('1 basket')
    expect(ahMeiCard).toHaveTextContent('74kg')
    fireEvent.click(within(ahMeiCard).getByText(/Wed, 1 Jul/))
    expect(ahMeiCard).toHaveTextContent('74kg x RM0.12')

    const aliCard=screen.getByRole('heading',{name:'Ali'}).closest('section')!
    expect(aliCard).toHaveTextContent('80kg')
    expect(aliCard).toHaveTextContent('RM14.40')
  })

  it('reloads when the selected month changes',async()=>{
    const loader=setup()

    await waitFor(()=>expect(loader).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/)))
    fireEvent.change(screen.getByLabelText('Wage month'),{target:{value:'2026-06'}})

    await waitFor(()=>expect(loader).toHaveBeenLastCalledWith('2026-06'))
  })

  it('shows monthly void audit records',async()=>{
    setup()

    fireEvent.click(await screen.findByText('Voided records this month (1)'))

    expect(screen.getByText('Wrong kg')).toBeInTheDocument()
    expect(screen.getByText(/2026-07-03/)).toHaveTextContent('60kg x RM0.12')
  })
})
