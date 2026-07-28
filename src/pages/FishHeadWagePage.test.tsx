import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { FishHeadWagePage } from './FishHeadWagePage'

const workers=[{id:'w1',name:'Ah Mei',active:true,order:1}]

afterEach(()=>{
  cleanup()
  vi.clearAllMocks()
})

const setup=(saver=vi.fn().mockResolvedValue(undefined),now=()=>1_000_000)=>{
  render(
    <MemoryRouter>
      <FishHeadWagePage workerLoader={async()=>workers} saver={saver} now={now}/>
    </MemoryRouter>,
  )
  return saver
}

async function chooseWorkerAndEnter74Kg(){
  fireEvent.click(await screen.findByRole('button',{name:'Ah Mei'}))
  fireEvent.click(screen.getByRole('button',{name:'7'}))
  fireEvent.click(screen.getByRole('button',{name:'4'}))
}

describe('fish head entry flow',()=>{
  it('keeps worker and rate, but clears weight after save',async()=>{
    const saver=setup()
    await chooseWorkerAndEnter74Kg()

    fireEvent.click(screen.getByRole('button',{name:/confirm entry/i}))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved: Ah Mei, 74kg × RM0.12 = RM8.88',
    )
    expect(saver).toHaveBeenCalledOnce()
    expect(screen.getByRole('button',{name:'Ah Mei'})).toHaveAttribute('aria-pressed','true')
    expect(screen.getByRole('button',{name:/RM0\.12/})).toHaveAttribute('aria-pressed','true')
    expect(screen.getByLabelText(/current basket weight/i)).toHaveTextContent('0 kg')
  })

  it('allows only one save from rapid double tap',async()=>{
    let finishSave:()=>void=()=>{}
    const saver=vi.fn(()=>new Promise<void>(resolve=>{finishSave=resolve}))
    setup(saver)
    await chooseWorkerAndEnter74Kg()
    const confirmButton=screen.getByRole('button',{name:/confirm entry/i})

    fireEvent.click(confirmButton)
    fireEvent.click(confirmButton)

    expect(saver).toHaveBeenCalledOnce()
    expect(screen.getByRole('button',{name:/saving/i})).toBeDisabled()
    finishSave()
    await waitFor(()=>expect(screen.getByRole('button',{name:/confirm entry/i})).toBeDisabled())
    expect(saver).toHaveBeenCalledOnce()
  })

  it('warns and explicitly confirms a possible duplicate within five seconds',async()=>{
    let time=1_000_000
    const saver=setup(undefined,()=>time)
    await chooseWorkerAndEnter74Kg()
    fireEvent.click(screen.getByRole('button',{name:/confirm entry/i}))
    await screen.findByRole('status')
    expect(saver).toHaveBeenCalledOnce()

    time+=4000
    fireEvent.click(screen.getByRole('button',{name:'7'}))
    fireEvent.click(screen.getByRole('button',{name:'4'}))
    fireEvent.click(screen.getByRole('button',{name:/confirm entry/i}))

    const warning=await screen.findByRole('alert')
    expect(warning).toHaveTextContent('Possible duplicate entry.')
    expect(saver).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button',{name:/save again/i}))
    await waitFor(()=>expect(saver).toHaveBeenCalledTimes(2))
  })
})
