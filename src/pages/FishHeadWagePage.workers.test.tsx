import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
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

interface RawWorkerFixture {
  id:string
  name:string
  active:boolean
  order:number
  department?:string
  workerDepartment?:string
}

// These anonymized shapes preserve the fields and ordering observed in the
// production collection before the approved correction: no document had
// workerDepartment, and the first three had no department field either.
// Names and IDs are deliberately synthetic.
function legacyProductionWorkerShapes():RawWorkerFixture[]{
  return [
    ...Array.from({length:3},(_,index)=>({
      id:`unclassified-${index+1}`,name:`旧资料工人 ${index+1}`,active:true,order:index,
    })),
    ...Array.from({length:6},(_,index)=>({
      id:`legacy-cutting-${index+1}`,name:`已分类工人 ${index+1}`,active:true,order:index+3,department:'fish_head',
    })),
    ...Array.from({length:7},(_,index)=>({
      id:`legacy-ccm-${index+1}`,name:`CCM 工人 ${index+1}`,active:true,order:index+9,department:'CCM',
    })),
  ]
}

function mockActiveWorkerCollection(workers:RawWorkerFixture[]){
  getDocs.mockImplementation(async(query:unknown)=>{
    expect(query).toEqual({
      reference:{path:'workers'},constraints:[{field:'active',operator:'==',value:true}],
    })
    // Honor the actual Firestore query, rather than returning inactive records
    // as though production's active == true query would return them.
    return {docs:workers.filter(worker=>worker.active).reverse().map(({id,...fields})=>({
      id,data:()=>fields,
    }))}
  })
}

function displayedWorkerNames(){
  const section=screen.getByRole('heading',{name:'1. 工人'}).closest('section')!
  return within(section).getAllByRole('button').map(button=>button.textContent)
}

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

it('reproduces six cutting workers from the sixteen legacy production field shapes without guessing missing departments',async()=>{
  const workers=legacyProductionWorkerShapes()
  mockActiveWorkerCollection(workers)
  render(<MemoryRouter><FishHeadWagePage/></MemoryRouter>)

  await screen.findByRole('button',{name:'已分类工人 1'})
  expect(displayedWorkerNames()).toEqual(workers.slice(3,9).map(worker=>worker.name))
  for(const worker of [...workers.slice(0,3),...workers.slice(9)]){
    expect(screen.queryByRole('button',{name:worker.name})).not.toBeInTheDocument()
  }
})

it('shows and selects all nine cutting workers after the approved three-record classification and saves the selected ID and name',async()=>{
  // Match the approved data correction without changing how the mapper treats
  // workers whose department fields are still missing.
  const workers=legacyProductionWorkerShapes().map(worker=>worker.order<3?{
    ...worker,department:'fish_head',workerDepartment:'fish_head_cutting',
  }:worker)
  mockActiveWorkerCollection(workers)
  const batchSaver=vi.fn().mockResolvedValue(undefined)
  render(<MemoryRouter><FishHeadWagePage batchSaver={batchSaver}/></MemoryRouter>)

  await screen.findByRole('button',{name:'旧资料工人 1'})
  const cuttingWorkers=workers.slice(0,9)
  expect(displayedWorkerNames()).toEqual(cuttingWorkers.map(worker=>worker.name))
  for(const worker of cuttingWorkers){
    const button=screen.getByRole('button',{name:worker.name})
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-pressed','true')
  }
  expect(screen.queryByRole('button',{name:/CCM 工人/})).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button',{name:'7'}))
  fireEvent.click(screen.getByRole('button',{name:'4'}))
  fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
  fireEvent.click(screen.getByRole('button',{name:'确认并保存工人合计'}))
  await waitFor(()=>expect(batchSaver).toHaveBeenCalledOnce())
  expect(batchSaver.mock.calls[0][0]).toEqual([
    expect.objectContaining({workerId:'legacy-cutting-6',workerName:'已分类工人 6',weightKg:74,rateRm:'0.12',wageRm:'8.88'}),
  ])
})

it('keeps CCM, other, inactive and unclassified workers out and respects canonical department precedence',async()=>{
  const workers:RawWorkerFixture[]=[
    ...legacyProductionWorkerShapes(),
    {id:'canonical-ccm',name:'明确普通部门',active:true,order:16,workerDepartment:'ccm_general'},
    {id:'canonical-other',name:'明确其他部门',active:true,order:17,workerDepartment:'other'},
    {id:'inactive-cutting',name:'停用切鱼头工人',active:false,order:18,department:'fish_head'},
    {id:'reclassified',name:'已转其他部门',active:true,order:19,department:'fish_head',workerDepartment:'other'},
    {id:'blank',name:'空白部门工人',active:true,order:20,department:'',workerDepartment:''},
  ]
  mockActiveWorkerCollection(workers)
  render(<MemoryRouter><FishHeadWagePage/></MemoryRouter>)

  await screen.findByRole('button',{name:'已分类工人 1'})
  expect(displayedWorkerNames()).toEqual(workers.slice(3,9).map(worker=>worker.name))
  for(const worker of [...workers.slice(0,3),...workers.slice(9)]){
    expect(screen.queryByRole('button',{name:worker.name})).not.toBeInTheDocument()
  }
})
