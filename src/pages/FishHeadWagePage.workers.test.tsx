import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach,expect,it,vi } from 'vitest'

const getDocs=vi.hoisted(()=>vi.fn())
vi.mock('../firebase',()=>({db:{},auth:{currentUser:null},firebaseConfigured:true}))
vi.mock('firebase/firestore',()=>({
  collection:(_db:unknown,path:string)=>({path}),
  where:(field:string,operator:string,value:unknown)=>({field,operator,value}),
  query:(reference:unknown,...constraints:unknown[])=>({reference,constraints}),
  getDocs,
}))

import { FishHeadWagePage } from './FishHeadWagePage'

afterEach(()=>{cleanup();vi.clearAllMocks()})

it('loads cutting workers beyond the sixth from a mixed-department roster and saves the selected worker',async()=>{
  // Fourteen other-department workers sort ahead of the cutting crew. A global
  // twenty-worker cap would leave only the first six cutting workers available.
  const cuttingWorkers=Array.from({length:26},(_,index)=>({
    id:`cutting-${index+1}`,name:`切鱼头工人 ${index+1}`,active:true,order:index+15,workerDepartment:'fish_head_cutting',
  }))
  const otherWorkers=Array.from({length:14},(_,index)=>({
    id:`other-${index+1}`,name:`其他部门工人 ${index+1}`,active:true,order:index+1,workerDepartment:'ccm_general',
  }))
  getDocs.mockResolvedValue({docs:[...otherWorkers,...cuttingWorkers].reverse().map(worker=>({
    id:worker.id,data:()=>worker,
  }))})
  const batchSaver=vi.fn().mockResolvedValue(undefined)

  // Exercise the real default worker loader so its truncation cannot be hidden
  // by injecting an already-complete roster into the page.
  render(<MemoryRouter><FishHeadWagePage batchSaver={batchSaver}/></MemoryRouter>)

  const seventh=await screen.findByRole('button',{name:'切鱼头工人 7'})
  expect(screen.getAllByRole('button',{name:/^切鱼头工人 /}).map(button=>button.textContent))
    .toEqual(cuttingWorkers.map(worker=>worker.name))
  expect(screen.queryByRole('button',{name:/其他部门工人/})).not.toBeInTheDocument()
  fireEvent.click(seventh)
  expect(seventh).toHaveAttribute('aria-pressed','true')

  const last=screen.getByRole('button',{name:'切鱼头工人 26'})
  fireEvent.click(last)
  expect(last).toHaveAttribute('aria-pressed','true')
  fireEvent.click(screen.getByRole('button',{name:'7'}))
  fireEvent.click(screen.getByRole('button',{name:'4'}))
  fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
  expect(seventh).toBeDisabled()
  fireEvent.click(screen.getByRole('button',{name:'确认并保存工人合计'}))

  await waitFor(()=>expect(batchSaver).toHaveBeenCalledOnce())
  expect(batchSaver.mock.calls[0][0]).toEqual([
    expect.objectContaining({workerId:'cutting-26',workerName:'切鱼头工人 26',weightKg:74,rateRm:'0.12',wageRm:'8.88'}),
  ])
  expect(seventh).toBeEnabled()
})
