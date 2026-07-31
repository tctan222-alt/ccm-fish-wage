import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { FishHeadWagePage } from './FishHeadWagePage'

const workers=[
  {id:'w1',name:'Ah Mei',active:true,order:1},
  {id:'w2',name:'Ali',active:true,order:2},
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
    expect(await screen.findByRole('link',{name:/Today \/ Daily Summary/i})).toBeInTheDocument()
    expect(screen.getByRole('link',{name:/Monthly Summary/i})).toBeInTheDocument()
    expect(screen.queryByRole('link',{name:/Vessel Trips/i})).not.toBeInTheDocument()
    expect(screen.queryByRole('link',{name:/现场称重/i})).not.toBeInTheDocument()
    expect(screen.queryByRole('link',{name:/Purchases & Receiving/i})).not.toBeInTheDocument()
  })

  it('shows active workers and excludes inactive workers from wage entry',async()=>{
    render(<MemoryRouter><FishHeadWagePage workerLoader={async()=>[
      ...workers,{id:'w3',name:'Inactive Worker',active:false,order:3},
    ]} batchSaver={vi.fn()}/></MemoryRouter>)
    expect(await screen.findByRole('button',{name:'Ah Mei'})).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Inactive Worker'})).not.toBeInTheDocument()
  })

  it('adds an entry locally, lists it, and keeps worker and rate selected',async()=>{
    const batchSaver=setup()
    await chooseWorkerAndEnter74Kg()

    fireEvent.click(screen.getByRole('button',{name:/confirm entry/i}))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Added: Ah Mei, 74kg × RM0.12 = RM8.88',
    )
    expect(batchSaver).not.toHaveBeenCalled()
    expect(screen.getByText('74kg × RM0.12')).toBeInTheDocument()
    expect(screen.getByText('RM8.88',{selector:'.entry-wage'})).toBeInTheDocument()
    expect(screen.getByText('74kg',{selector:'.worker-subtotal strong'})).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Ah Mei'})).toHaveAttribute('aria-pressed','true')
    expect(screen.getByRole('button',{name:'Ali'})).toBeDisabled()
    expect(screen.getByRole('button',{name:/RM0\.12/})).toHaveAttribute('aria-pressed','true')
    expect(screen.getByLabelText(/current basket weight/i)).toHaveTextContent('0 kg')
  })

  it('saves all current worker entries as one batch and resets for the next worker',async()=>{
    const batchSaver=setup()
    await chooseWorkerAndEnter74Kg()
    fireEvent.click(screen.getByRole('button',{name:/confirm entry/i}))

    fireEvent.click(screen.getByRole('button',{name:'7'}))
    fireEvent.click(screen.getByRole('button',{name:'1'}))
    fireEvent.click(screen.getByRole('button',{name:/RM0\.15/}))
    fireEvent.click(screen.getByRole('button',{name:/confirm entry/i}))

    fireEvent.click(screen.getByRole('button',{name:/confirm worker total/i}))

    await waitFor(()=>expect(batchSaver).toHaveBeenCalledOnce())
    const payload=batchSaver.mock.calls[0][0]
    expect(payload).toHaveLength(2)
    expect(payload[0]).toMatchObject({workerName:'Ah Mei',weightKg:74,rateRm:'0.12',wageRm:'8.88'})
    expect(payload[1]).toMatchObject({workerName:'Ah Mei',weightKg:71,rateRm:'0.15',wageRm:'10.65'})
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved Ah Mei: 2 baskets, 145kg, RM19.53',
    )
    expect(screen.queryByText('74kg × RM0.12')).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Ali'})).not.toBeDisabled()
  })

  it('removes a wrong entry before the worker total is saved',async()=>{
    setup()
    await chooseWorkerAndEnter74Kg()
    fireEvent.click(screen.getByRole('button',{name:/confirm entry/i}))

    const list=screen.getByRole('list')
    fireEvent.click(within(list).getByRole('button',{name:'Remove entry 1'}))

    expect(screen.queryByText('74kg × RM0.12')).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:/confirm worker total/i})).not.toBeInTheDocument()
  })

  it('warns before adding a rapid duplicate entry',async()=>{
    let time=1_000_000
    setup(undefined,()=>time)
    await chooseWorkerAndEnter74Kg()
    fireEvent.click(screen.getByRole('button',{name:/confirm entry/i}))

    time+=4000
    fireEvent.click(screen.getByRole('button',{name:'7'}))
    fireEvent.click(screen.getByRole('button',{name:'4'}))
    fireEvent.click(screen.getByRole('button',{name:/confirm entry/i}))

    const warning=await screen.findByRole('alert')
    expect(warning).toHaveTextContent('Possible duplicate entry.')
    expect(screen.getAllByText('74kg × RM0.12')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button',{name:/add anyway/i}))
    expect(screen.getAllByText('74kg × RM0.12')).toHaveLength(2)
  })
})
