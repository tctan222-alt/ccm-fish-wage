import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach,expect,it,vi } from 'vitest'
import { DEFAULT_FISH_SPECIES,newWeighingSession,type WeighingEntry,type WeighingSession } from '../lib/weighing'
import { createMemoryWeighingStore } from '../services/weighingOffline'
import { WeighingEntryPage } from './WeighingEntryPage'

const vessels=['978','833','2072','9633','4818','2031','1785','5202'].map((vesselCode,order)=>({
  id:`v${vesselCode}`,vesselCode,displayName:vesselCode,defaultSupplierId:'',defaultSupplierNameSnapshot:'',active:true,order,notes:'',
}))
afterEach(cleanup)
function mount(overrides:Partial<Parameters<typeof WeighingEntryPage>[0]>={}){
  const store=createMemoryWeighingStore()
  let sequence=0
  const remoteSync=vi.fn(async():Promise<{session?:WeighingSession;entry?:WeighingEntry}>=>{throw new Error('Offline fixture')})
  render(<MemoryRouter><WeighingEntryPage vesselLoader={async()=>vessels} speciesLoader={async()=>DEFAULT_FISH_SPECIES}
    vesselInitializer={async()=>vessels} speciesInitializer={async()=>DEFAULT_FISH_SPECIES}
    openSessionLoader={async()=>null} closedSessionLoader={async()=>null} bundleLoader={async()=>{throw new Error('Offline fixture')}}
    offlineStore={store} remoteSync={remoteSync} today={()=>'30/07/2026'} now={()=>'2026-07-30T04:00:00Z'}
    idFactory={kind=>`${kind}-${++sequence}`} {...overrides}/></MemoryRouter>)
  return {store,remoteSync}
}
async function ready(){await waitFor(()=>expect(screen.getByRole('button',{name:'确认加入'})).not.toBeDisabled())}
function typeWeight(value='80.5'){fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value}})}

it('keeps the unconfirmed kg when correcting the fish species',async()=>{
  mount();await ready();typeWeight()
  fireEvent.click(within(screen.getByRole('group',{name:'鱼名'})).getByRole('button',{name:'来戈'}))
  expect(screen.getByLabelText('重量（kg）')).toHaveValue('80.5')
  expect(screen.getByRole('button',{name:'来戈'})).toHaveAttribute('aria-pressed','true')
})

it('asks before switching vessels and cancellation retains the context and all unconfirmed fields',async()=>{
  mount();await ready();typeWeight()
  fireEvent.change(screen.getByLabelText('鱼头纸单号'),{target:{value:'PAPER-1'}})
  fireEvent.change(screen.getByLabelText('船号'),{target:{value:'v833'}})
  const dialog=screen.getByRole('alertdialog')
  expect(dialog).toHaveTextContent('目前有尚未确认的重量/资料，切换会清除。确定继续吗？')
  expect(screen.getByLabelText('船号')).toHaveValue('v978')
  expect(within(dialog).getByRole('button',{name:'取消，保留资料'})).toHaveFocus()
  fireEvent.click(within(dialog).getByRole('button',{name:'取消，保留资料'}))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByLabelText('重量（kg）')).toHaveValue('80.5')
  expect(screen.getByLabelText('鱼头纸单号')).toHaveValue('PAPER-1')
  expect(screen.getByLabelText('船号')).toHaveValue('v978')
})

it.each(['vessel','date','product'] as const)('clears only the old unconfirmed draft after an approved %s switch',async(kind)=>{
  const {store}=mount();await ready();typeWeight('40')
  fireEvent.click(screen.getByRole('button',{name:'确认加入'}));await screen.findByText('已保存')
  const committed=await store.getPending(),sessionId=committed[0].sessionId
  const savedEntries=await store.getEntries(sessionId),savedSession=await store.getSession(sessionId)
  typeWeight();fireEvent.change(screen.getByLabelText('鱼头纸单号'),{target:{value:'NOT-SAVED'}})
  if(kind==='vessel')fireEvent.change(screen.getByLabelText('船号'),{target:{value:'v833'}})
  if(kind==='date')fireEvent.change(screen.getByLabelText('日期'),{target:{value:'31/07/2026'}})
  if(kind==='product')fireEvent.click(screen.getByRole('button',{name:'鱼仔'}))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'继续切换'}))
  await ready()
  expect(screen.getByLabelText('重量（kg）')).toHaveValue('')
  expect(screen.getByLabelText(kind==='product'?'鱼仔纸单号':'鱼头纸单号')).toHaveValue('')
  expect(await store.getEntries(sessionId)).toEqual(savedEntries)
  expect(await store.getSession(sessionId)).toEqual(savedSession)
  expect(await store.getPending()).toEqual(committed)
})

it('retains kg when adjusting fish-meal quality and protects a total remark even without kg',async()=>{
  mount({fixedProductType:'fish_meal'});await ready()
  fireEvent.click(screen.getByRole('button',{name:'桶鱼仔'}));typeWeight('99')
  fireEvent.click(screen.getByRole('button',{name:'包鱼仔'}))
  expect(screen.getByLabelText('重量（kg）')).toHaveValue('99')
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  typeWeight('');fireEvent.click(screen.getByRole('button',{name:'总重量'}))
  fireEvent.change(screen.getByLabelText('备注'),{target:{value:'48包'}})
  fireEvent.change(screen.getByLabelText('日期'),{target:{value:'31/07/2026'}})
  fireEvent.keyDown(screen.getByRole('alertdialog'),{key:'Escape'})
  expect(screen.getByLabelText('日期')).toHaveValue('30/07/2026')
  expect(screen.getByLabelText('备注')).toHaveValue('48包')
  fireEvent.change(screen.getByLabelText('船号'),{target:{value:'v833'}})
  fireEvent.click(screen.getByRole('button',{name:'继续切换'}));await ready()
  expect(screen.getByLabelText('备注')).toHaveValue('')
})

it('retains a paper slip typed while initial reference and session reads are pending',async()=>{
  let resolveVessels!:(value:typeof vessels)=>void
  const vesselLoader=()=>new Promise<typeof vessels>(resolve=>{resolveVessels=resolve})
  mount({vesselLoader})
  fireEvent.change(screen.getByLabelText('鱼头纸单号'),{target:{value:'EARLY-PAPER'}})
  resolveVessels(vessels);await ready()
  expect(screen.getByLabelText('鱼头纸单号')).toHaveValue('EARLY-PAPER')
  fireEvent.change(screen.getByLabelText('船号'),{target:{value:'v833'}})
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()
})

it('resolves the confirmed vessel by its code when Master Data IDs arrive while the dialog is open',async()=>{
  let resolveVessels!:(value:typeof vessels)=>void
  mount({vesselLoader:()=>new Promise<typeof vessels>(done=>{resolveVessels=done})})
  typeWeight()
  fireEvent.change(screen.getByLabelText('船号'),{target:{value:'833'}})
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  resolveVessels(vessels)
  await waitFor(()=>expect(screen.getByRole('option',{name:'833'})).toHaveValue('v833'))
  fireEvent.click(screen.getByRole('button',{name:'继续切换'}));await ready()
  expect(screen.getByLabelText('船号')).toHaveValue('v833')
  expect(screen.getByLabelText('重量（kg）')).toHaveValue('')
})

it('does not overwrite a typed paper correction when a delayed existing session arrives',async()=>{
  const existing=newWeighingSession({id:'existing',productType:'fish_head',vesselId:'v978',vesselCodeSnapshot:'978',vesselNameSnapshot:'978',weighingDate:'30/07/2026',externalSlipNo:'COMMITTED'})
  let resolve!:(value:{session:WeighingSession;entries:WeighingEntry[]})=>void
  const response=new Promise<{session:WeighingSession;entries:WeighingEntry[]}>(done=>{resolve=done})
  mount({openSessionLoader:async(id)=>id==='v978'?response:null})
  await waitFor(()=>expect(screen.getByLabelText('船号')).toHaveValue('v978'))
  fireEvent.change(screen.getByLabelText('鱼头纸单号'),{target:{value:'CORRECTION'}})
  resolve({session:existing,entries:[]});await ready()
  expect(screen.getByLabelText('鱼头纸单号')).toHaveValue('CORRECTION')
  fireEvent.change(screen.getByLabelText('日期'),{target:{value:'31/07/2026'}})
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()
})

it('ignores a same-day formatting change and switches a committed paper number without a false dirty prompt',async()=>{
  mount();await ready()
  fireEvent.change(screen.getByLabelText('鱼头纸单号'),{target:{value:' PAPER-1 '}})
  typeWeight();fireEvent.change(screen.getByLabelText('日期'),{target:{value:'2026-07-30'}})
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByLabelText('重量（kg）')).toHaveValue('80.5')
  fireEvent.click(screen.getByRole('button',{name:'确认加入'}));await screen.findByText('已保存')
  fireEvent.change(screen.getByLabelText('船号'),{target:{value:'v833'}});await ready()
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByLabelText('船号')).toHaveValue('v833')
  expect(screen.getByLabelText('鱼头纸单号')).toHaveValue('')
  fireEvent.change(screen.getByLabelText('船号'),{target:{value:'v978'}});await ready()
  expect(screen.getByLabelText('鱼头纸单号')).toHaveValue('PAPER-1')
})

it.each(['fish_head','fish_meal'] as const)('shows only %s totals and pending sync in the completion confirmation',async(productType)=>{
  mount({fixedProductType:productType});await ready()
  if(productType==='fish_meal')fireEvent.click(screen.getByRole('button',{name:'桶鱼仔'}))
  typeWeight('40');fireEvent.click(screen.getByRole('button',{name:'确认加入'}));await screen.findByText('已保存')
  if(productType==='fish_meal'){
    fireEvent.click(screen.getByRole('button',{name:'包鱼仔'}));typeWeight('50')
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await waitFor(()=>expect(screen.getByLabelText('重量（kg）')).toHaveValue(''))
  }
  await waitFor(()=>expect(screen.getByRole('button',{name:'完成称重'})).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button',{name:'完成称重'}))
  const dialog=screen.getByRole('dialog')
  expect(dialog).toHaveTextContent('978 · 30/07/2026')
  expect(dialog).toHaveTextContent('尚未同步')
  if(productType==='fish_head'){
    expect(dialog).toHaveTextContent('鱼头1 篮 · 40 kg')
    expect(dialog).not.toHaveTextContent('桶鱼仔');expect(dialog).not.toHaveTextContent('包鱼仔')
    expect(dialog).toHaveTextContent('总重量40 kg')
  }else{
    expect(dialog).not.toHaveTextContent('鱼头')
    expect(dialog).toHaveTextContent('桶鱼仔1 篮 · 40 kg')
    expect(dialog).toHaveTextContent('包鱼仔1 篮 · 50 kg')
    expect(dialog).toHaveTextContent('总重量90 kg')
  }
})
