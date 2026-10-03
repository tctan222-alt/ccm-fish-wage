import { act,cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { MonthlySummaryPage } from './MonthlySummaryPage'
import type { MonthlyWageData } from '../services/wages'
import type { WageMonthClosingData } from '../services/monthClosing'

afterEach(()=>{
  vi.useRealTimers()
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

function setup(loader=vi.fn(async()=>data),requestTimeoutMs?:number){
  const closingLoader=vi.fn(async():Promise<WageMonthClosingData>=>({month:null,statements:[],payments:[]}))
  render(
    <MemoryRouter>
      <MonthlySummaryPage loader={loader} closingLoader={closingLoader} requestTimeoutMs={requestTimeoutMs}/>
    </MemoryRouter>,
  )
  return loader
}

it('places the month overview, worker and daily summaries before reconciliation and closing administration',async()=>{
  setup(); await screen.findByText('个人、每日与整月工钱已核对一致。 Worker, daily and month totals match.')
  const overview=screen.getByLabelText('整月总览 Monthly totals'),worker=screen.getByRole('heading',{name:'个人月总结 Monthly Summary by Worker'})
  const daily=screen.getByLabelText('每日全体工钱 Daily Wages'),reconciliation=screen.getByText('个人、每日与整月工钱已核对一致。 Worker, daily and month totals match.')
  const closing=document.querySelector('.month-closing')!
  expect(screen.getByRole('heading',{name:'切鱼头月结 Monthly Summary'})).toBeInTheDocument()
  expect(screen.getByLabelText('工资月份 Wage month')).toBeInTheDocument()
  expect(overview).toHaveTextContent('工人数 Workers');expect(overview).toHaveTextContent('总重量 Total kg');expect(overview).toHaveTextContent('总工钱 Total wage')
  for(const [first,next] of [[overview,worker],[worker,daily],[daily,reconciliation],[reconciliation,closing]]) expect(first.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('shows worker work days and daily all-worker totals with exact month cross-check and no payment or remark controls', async () => {
  setup(); await screen.findByText('个人、每日与整月工钱已核对一致。 Worker, daily and month totals match.')
  expect(screen.getByRole('heading', { name: '个人月总结 Monthly Summary by Worker' })).toBeInTheDocument()
  const daily = screen.getByLabelText('每日全体工钱 Daily Wages')
  expect(within(daily).getByRole('link', { name: /1 Jul/ })).toHaveAttribute('href', '/today?date=2026-07-01')
  expect(daily).toHaveTextContent('RM8.88'); expect(daily).toHaveTextContent('RM25.05')
  expect(screen.getByLabelText('整月总览 Monthly totals')).toHaveTextContent('RM33.93')
  expect(screen.getAllByText('工作天数 Work days')).toHaveLength(3)
  expect(screen.queryByText(/^Paid|Not Paid|Unpaid|Outstanding$/i)).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: /remark|备注/i })).not.toBeInTheDocument()
})

it.each(['workerCount','basketCount','totalWeightKg'] as const)('flags a closed snapshot %s mismatch even if wage cents match',async field=>{
  const month={monthKey:'2026-07',status:'closed' as const,closeVersion:1,workerCount:2,basketCount:3,totalWeightKg:225,totalWageCents:3393,paidCents:0,closedBy:'admin',reopenedBy:null,lastActionId:'close',closingToken:null,closingBy:null,statementIds:[],[field]:999}
  render(<MemoryRouter><MonthlySummaryPage loader={async()=>data} closingLoader={async()=>({month,statements:[],payments:[]})}/></MemoryRouter>)
  expect(await screen.findByRole('alert')).toHaveTextContent('请核对')
  expect(screen.queryByText('个人、每日与整月工钱已核对一致。 Worker, daily and month totals match.')).not.toBeInTheDocument()
})

function deferred<T>(){
  let resolve!:(value:T)=>void
  let reject!:(reason?:unknown)=>void
  const promise=new Promise<T>((resolvePromise,rejectPromise)=>{
    resolve=resolvePromise
    reject=rejectPromise
  })
  return {promise,resolve,reject}
}

function dataWithWorker(workerName:string):MonthlyWageData{
  return {
    ...data,
    entries:[{...data.entries[0],id:`entry-${workerName}`,workerId:`worker-${workerName}`,workerName}],
    voids:[],
  }
}

describe('monthly summary',()=>{
  it('summarizes active wages by month, worker, and day',async()=>{
    setup()

    expect(await screen.findByRole('heading',{name:'切鱼头月结 Monthly Summary'})).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('工资月份 Wage month'),{target:{value:'2026-07'}})
    expect(await screen.findByText('July 2026')).toBeInTheDocument()

    const grandTotal=screen.getByRole('region',{name:'整月总览 Monthly totals'})
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

    fireEvent.click(within(ahMeiCard).getByText('查看每日汇总及篮重明细 View daily totals and basket details'))
    expect(ahMeiCard).toHaveTextContent('Wed, 1 Jul')
    expect(ahMeiCard).toHaveTextContent('1 篮 Baskets')
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
    fireEvent.change(screen.getByLabelText('工资月份 Wage month'),{target:{value:'2026-06'}})

    await waitFor(()=>expect(loader).toHaveBeenLastCalledWith('2026-06'))
  })

  it('shows monthly void audit records',async()=>{
    setup()

    fireEvent.click(await screen.findByText('本月作废记录 Voided records this month (1)'))

    expect(screen.getByText('Wrong kg')).toBeInTheDocument()
    expect(screen.getByText(/2026-07-03/)).toHaveTextContent('60kg x RM0.12')
  })

  it('starts only one effective refresh when tapped twice rapidly',async()=>{
    const refresh=deferred<MonthlyWageData>()
    const loader=vi.fn()
      .mockResolvedValueOnce(data)
      .mockReturnValueOnce(refresh.promise)

    setup(loader)

    expect(await screen.findByRole('button',{name:'刷新月份 Refresh month'})).toBeEnabled()
    const button=screen.getByRole('button',{name:'刷新月份 Refresh month'})

    fireEvent.click(button)
    fireEvent.click(button)

    expect(loader).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button',{name:'正在载入… Loading...'})).toBeDisabled()

    refresh.resolve(data)
    await waitFor(()=>expect(screen.getByRole('button',{name:'刷新月份 Refresh month'})).toBeEnabled())
  })

  it('releases loading after a successful refresh',async()=>{
    const refresh=deferred<MonthlyWageData>()
    const loader=vi.fn()
      .mockResolvedValueOnce(data)
      .mockReturnValueOnce(refresh.promise)

    setup(loader)

    fireEvent.click(await screen.findByRole('button',{name:'刷新月份 Refresh month'}))
    expect(screen.getByRole('button',{name:'正在载入… Loading...'})).toBeDisabled()

    refresh.resolve(dataWithWorker('Fresh Worker'))

    await waitFor(()=>expect(screen.getByRole('button',{name:'刷新月份 Refresh month'})).toBeEnabled())
    expect(screen.queryByText('正在载入月记录… Loading monthly records...')).not.toBeInTheDocument()
    expect(screen.getByRole('heading',{name:'Fresh Worker'})).toBeInTheDocument()
  })

  it('releases loading and shows an error after a failed refresh',async()=>{
    const loader=vi.fn()
      .mockResolvedValueOnce(data)
      .mockRejectedValueOnce(new Error('network failed'))

    setup(loader)

    fireEvent.click(await screen.findByRole('button',{name:'刷新月份 Refresh month'}))

    expect(await screen.findByRole('alert')).toHaveTextContent('Monthly records could not be loaded')
    expect(screen.getByRole('button',{name:'刷新月份 Refresh month'})).toBeEnabled()
  })

  it('releases loading after a refresh timeout',async()=>{
    const refresh=deferred<MonthlyWageData>()
    const loader=vi.fn()
      .mockResolvedValueOnce(data)
      .mockReturnValueOnce(refresh.promise)

    setup(loader,100)

    const button=await screen.findByRole('button',{name:'刷新月份 Refresh month'})
    vi.useFakeTimers()
    fireEvent.click(button)
    expect(screen.getByRole('button',{name:'正在载入… Loading...'})).toBeDisabled()

    await act(async()=>{
      vi.advanceTimersByTime(101)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('Monthly records timed out')
    expect(screen.getByRole('button',{name:'刷新月份 Refresh month'})).toBeEnabled()
  })

  it('can retry after timeout and ignores the stale timed-out response',async()=>{
    const timedOut=deferred<MonthlyWageData>()
    const retry=deferred<MonthlyWageData>()
    const loader=vi.fn()
      .mockResolvedValueOnce(data)
      .mockReturnValueOnce(timedOut.promise)
      .mockReturnValueOnce(retry.promise)

    setup(loader,100)

    const button=await screen.findByRole('button',{name:'刷新月份 Refresh month'})
    vi.useFakeTimers()
    fireEvent.click(button)
    await act(async()=>{
      vi.advanceTimersByTime(101)
    })

    expect(screen.getByRole('button',{name:'刷新月份 Refresh month'})).toBeEnabled()

    fireEvent.click(screen.getByRole('button',{name:'刷新月份 Refresh month'}))
    expect(loader).toHaveBeenCalledTimes(3)

    await act(async()=>{
      retry.resolve(dataWithWorker('Retry Worker'))
    })
    expect(screen.getByRole('heading',{name:'Retry Worker'})).toBeInTheDocument()

    await act(async()=>{
      timedOut.resolve(dataWithWorker('Stale Worker'))
    })

    expect(screen.queryByRole('heading',{name:'Stale Worker'})).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'刷新月份 Refresh month'})).toBeEnabled()
  })
})
