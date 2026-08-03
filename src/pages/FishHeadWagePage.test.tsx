import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import { Link,MemoryRouter,Route,Routes } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { FishHeadWagePage } from './FishHeadWagePage'

const workers=[
  {id:'w1',name:'Ah Mei',active:true,order:1,workerDepartment:'fish_head_cutting' as const},
  {id:'w2',name:'Ali',active:true,order:2,workerDepartment:'fish_head_cutting' as const},
]

afterEach(()=>{
  cleanup()
  vi.clearAllMocks()
})

const setup=(batchSaver=vi.fn().mockResolvedValue(undefined),now=()=>1_000_000)=>{
  render(
    <MemoryRouter>
      <FishHeadWagePage workerLoader={async()=>workers} batchSaver={batchSaver} now={now}/>
    </MemoryRouter>,
  )
  return batchSaver
}

async function chooseWorkerAndEnter74Kg(){
  fireEvent.click(await screen.findByRole('button',{name:'Ah Mei'}))
  fireEvent.click(screen.getByRole('button',{name:'7'}))
  fireEvent.click(screen.getByRole('button',{name:'4'}))
}

describe('fish head worker session flow',()=>{
  it('keeps the wage page limited to wage entry and wage summaries',async()=>{
    setup()
    expect(await screen.findByRole('link',{name:'工钱录入'})).toBeInTheDocument()
    expect(screen.getByRole('link',{name:'工钱 Summary'})).toBeInTheDocument()
    expect(screen.getByRole('link',{name:'← 返回'})).toBeInTheDocument()
    expect(screen.queryByRole('link',{name:/Vessel Trips/i})).not.toBeInTheDocument()
    expect(screen.queryByRole('link',{name:/现场称重/i})).not.toBeInTheDocument()
    expect(screen.queryByRole('link',{name:/Purchases & Receiving/i})).not.toBeInTheDocument()
  })

  it('returns to the department and can render again after re-entry',async()=>{
    render(<MemoryRouter initialEntries={['/fish-head-wages']}><Routes>
      <Route path="/fish-head-wages" element={<FishHeadWagePage workerLoader={async()=>workers}/>}/>
      <Route path="/fish-department" element={<><h1>鱼头鱼仔部</h1><Link to="/fish-head-wages">切鱼头工钱</Link></>}/>
    </Routes></MemoryRouter>)
    expect(await screen.findByRole('heading',{name:'切鱼头工钱'})).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link',{name:'← 返回'}))
    expect(await screen.findByRole('heading',{name:'鱼头鱼仔部'})).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link',{name:'切鱼头工钱'}))
    expect(await screen.findByRole('heading',{name:'切鱼头工钱'})).toBeInTheDocument()
  })

  it('shows active workers and excludes inactive workers from wage entry',async()=>{
    render(<MemoryRouter><FishHeadWagePage workerLoader={async()=>[
      ...workers,{id:'w3',name:'Inactive Worker',active:false,order:3},
    ]} batchSaver={vi.fn()}/></MemoryRouter>)
    expect(await screen.findByRole('button',{name:'Ah Mei'})).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Inactive Worker'})).not.toBeInTheDocument()
  })

  it('只显示切鱼头工钱工人，且不会把未分类或其他部门工人误带入',async()=>{
    render(<MemoryRouter><FishHeadWagePage workerLoader={async()=>[
      {id:'cutting',name:'切鱼头工人',active:true,order:1,workerDepartment:'fish_head_cutting'},
      {id:'ccm',name:'CCM 工人',active:true,order:2,workerDepartment:'ccm_general'},
      {id:'other',name:'其他工人',active:true,order:3,workerDepartment:'other'},
      {id:'legacy',name:'未分类旧工人',active:true,order:4},
      {id:'legacy-cutting',name:'旧切鱼头工人',active:true,order:5,department:'fish_head'},
    ]} batchSaver={vi.fn()}/></MemoryRouter>)
    expect(await screen.findByRole('button',{name:'切鱼头工人'})).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'旧切鱼头工人'})).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'CCM 工人'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'其他工人'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'未分类旧工人'})).not.toBeInTheDocument()
  })

  it('可选择补录日期，并按所选日期保存完整工资日期字段和当日汇总链接',async()=>{
    const batchSaver=vi.fn().mockResolvedValue(undefined)
    render(<MemoryRouter><FishHeadWagePage workerLoader={async()=>workers} batchSaver={batchSaver}
      today={()=>'03/08/2026'} now={()=>1_000_000}/></MemoryRouter>)
    const date=await screen.findByLabelText('日期')
    expect(date).toHaveValue('2026-08-03')
    expect(screen.getByText('03/08/2026')).toBeInTheDocument()

    fireEvent.change(date,{target:{value:'2026-07-31'}})
    expect(screen.getByText('31/07/2026')).toBeInTheDocument()
    expect(screen.getByRole('link',{name:'工钱录入'})).toHaveAttribute('href','/today?date=2026-07-31')
    await chooseWorkerAndEnter74Kg()
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    fireEvent.click(screen.getByRole('button',{name:'确认并保存工人合计'}))

    await waitFor(()=>expect(batchSaver).toHaveBeenCalledOnce())
    expect(batchSaver.mock.calls[0][0][0]).toMatchObject({
      dateKey:'2026-07-31',businessDate:'31/07/2026',dateSortKey:20260731,monthKey:'07/2026',monthSortKey:202607,
    })
  })

  it('adds an entry locally, lists it, and keeps worker and rate selected',async()=>{
    const batchSaver=setup()
    await chooseWorkerAndEnter74Kg()

    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))

    expect(await screen.findByRole('status')).toHaveTextContent(
      '已加入：Ah Mei，74kg × RM0.12 = RM8.88',
    )
    expect(batchSaver).not.toHaveBeenCalled()
    expect(screen.getByText('74kg × RM0.12')).toBeInTheDocument()
    expect(screen.getByText('RM8.88',{selector:'.entry-wage'})).toBeInTheDocument()
    expect(screen.getByText('74kg',{selector:'.worker-subtotal strong'})).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Ah Mei'})).toHaveAttribute('aria-pressed','true')
    expect(screen.getByRole('button',{name:'Ali'})).toBeDisabled()
    expect(screen.getByRole('button',{name:/RM0\.12/})).toHaveAttribute('aria-pressed','true')
    expect(screen.getByLabelText('当前篮重')).toHaveTextContent('0 kg')
  })

  it('saves all current worker entries as one batch and resets for the next worker',async()=>{
    const batchSaver=setup()
    await chooseWorkerAndEnter74Kg()
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))

    fireEvent.click(screen.getByRole('button',{name:'7'}))
    fireEvent.click(screen.getByRole('button',{name:'1'}))
    fireEvent.click(screen.getByRole('button',{name:/RM0\.15/}))
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))

    fireEvent.click(screen.getByRole('button',{name:'确认并保存工人合计'}))

    await waitFor(()=>expect(batchSaver).toHaveBeenCalledOnce())
    const payload=batchSaver.mock.calls[0][0]
    expect(payload).toHaveLength(2)
    expect(payload[0]).toMatchObject({workerName:'Ah Mei',weightKg:74,rateRm:'0.12',wageRm:'8.88'})
    expect(payload[1]).toMatchObject({workerName:'Ah Mei',weightKg:71,rateRm:'0.15',wageRm:'10.65'})
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已保存 Ah Mei：2 篮，145kg，RM19.53',
    )
    expect(screen.queryByText('74kg × RM0.12')).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Ali'})).not.toBeDisabled()
  })

  it('removes a wrong entry before the worker total is saved',async()=>{
    setup()
    await chooseWorkerAndEnter74Kg()
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))

    const list=screen.getByRole('list')
    fireEvent.click(within(list).getByRole('button',{name:'移除第 1 篮'}))

    expect(screen.queryByText('74kg × RM0.12')).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'确认并保存工人合计'})).not.toBeInTheDocument()
  })

  it('warns before adding a rapid duplicate entry',async()=>{
    let time=1_000_000
    setup(undefined,()=>time)
    await chooseWorkerAndEnter74Kg()
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))

    time+=4000
    fireEvent.click(screen.getByRole('button',{name:'7'}))
    fireEvent.click(screen.getByRole('button',{name:'4'}))
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))

    const warning=await screen.findByRole('alert')
    expect(warning).toHaveTextContent('可能重复加入。')
    expect(screen.getAllByText('74kg × RM0.12')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button',{name:'仍然加入'}))
    expect(screen.getAllByText('74kg × RM0.12')).toHaveLength(2)
  })
})
