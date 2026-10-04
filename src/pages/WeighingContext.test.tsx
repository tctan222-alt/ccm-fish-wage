import { act,cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
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
  const props:Parameters<typeof WeighingEntryPage>[0]={vesselLoader:async()=>vessels,speciesLoader:async()=>DEFAULT_FISH_SPECIES,
    vesselInitializer:async()=>vessels,speciesInitializer:async()=>DEFAULT_FISH_SPECIES,
    openSessionLoader:async()=>null,closedSessionLoader:async()=>null,bundleLoader:async()=>{throw new Error('Offline fixture')},
    offlineStore:store,remoteSync,today:()=> '30/07/2026',now:()=> '2026-07-30T04:00:00Z',
    idFactory:kind=>`${kind}-${++sequence}`,...overrides}
  const view=render(<MemoryRouter><WeighingEntryPage {...props}/></MemoryRouter>)
  return {store,remoteSync,props,...view}
}
async function ready(){await waitFor(()=>expect(screen.getByRole('button',{name:'确认加入'})).not.toBeDisabled())}
function typeWeight(value='80.5'){fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value}})}

it.each(['weight','remark','date','paper'] as const)('blocks completion with an unconfirmed %s, and explicit clear retains committed baskets/queue',async(kind)=>{
  const {store}=mount(kind==='remark'?{fixedProductType:'fish_meal'}:{});await ready()
  if(kind==='remark')fireEvent.click(screen.getByRole('button',{name:'桶鱼仔'}))
  typeWeight('80.5')
  fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
  await screen.findByText('第 1 篮')
  await waitFor(()=>expect(screen.getByRole('button',{name:'完成称重'})).not.toBeDisabled())
  const count=(await store.getPending()).length
  if(kind==='weight')typeWeight('38.5')
  else if(kind==='remark'){fireEvent.click(screen.getByRole('button',{name:'总重量'}));fireEvent.change(screen.getByLabelText('备注'),{target:{value:'未确认备注'}})}
  else if(kind==='date')fireEvent.change(screen.getByLabelText('日期'),{target:{value:'31/07/'}})
  else fireEvent.change(screen.getByLabelText('鱼头纸单号'),{target:{value:'UNSAVED'}})
  fireEvent.click(screen.getByRole('button',{name:'完成称重'}))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getAllByRole('alert').some(element=>element.textContent?.includes('尚未确认'))).toBe(true)
  expect((await store.getPending()).length).toBe(count)
  fireEvent.click(screen.getByRole('button',{name:'清除当前未确认输入'}))
  expect(screen.getByLabelText('重量（kg）')).toHaveValue('')
  expect(screen.getByLabelText(kind==='remark'?'鱼仔纸单号':'鱼头纸单号')).toHaveValue('')
  expect(screen.getByLabelText('日期')).toHaveValue('30/07/2026')
  expect(screen.getByText('第 1 篮')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'完成称重'}))
  expect(screen.getByRole('dialog')).toHaveTextContent('确认完成称重')
})

it('lets an operator type a complete date without switching or moving focus until blur',async()=>{
  const user=userEvent.setup(),openSessionLoader=vi.fn(async()=>null)
  mount({openSessionLoader});await ready()
  const input=screen.getByLabelText('日期'),reads=openSessionLoader.mock.calls.length
  await user.clear(input)
  await user.type(input,'31/07/2026')
  expect(input).toHaveValue('31/07/2026')
  expect(input).toHaveFocus()
  expect(openSessionLoader).toHaveBeenCalledTimes(reads)
  expect(screen.getByLabelText('重量（kg）')).toHaveValue('')
  expect(screen.getByRole('button',{name:'确认加入'})).toBeDisabled()
  await user.tab();await ready()
  expect(openSessionLoader).toHaveBeenLastCalledWith('v978','31/07/2026','fish_head')
})

it('waits for the complete typed date before asking to discard a basket and restores the date on cancel',async()=>{
  const user=userEvent.setup(),openSessionLoader=vi.fn(async()=>null)
  mount({openSessionLoader});await ready();typeWeight()
  fireEvent.change(screen.getByLabelText('鱼头纸单号'),{target:{value:'PAPER-DRAFT'}})
  const input=screen.getByLabelText('日期'),reads=openSessionLoader.mock.calls.length
  await user.clear(input);await user.type(input,'31/07/2026')
  expect(input).toHaveFocus()
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(openSessionLoader).toHaveBeenCalledTimes(reads)
  await user.tab()
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'取消，保留资料'}))
  expect(input).toHaveValue('30/07/2026')
  expect(screen.getByLabelText('重量（kg）')).toHaveValue('80.5')
  expect(screen.getByLabelText('鱼头纸单号')).toHaveValue('PAPER-DRAFT')
  expect(openSessionLoader).toHaveBeenCalledTimes(reads)
  fireEvent.change(input,{target:{value:'31/07/2026'}});fireEvent.keyDown(input,{key:'Enter'})
  fireEvent.click(screen.getByRole('button',{name:'继续切换'}));await ready()
  expect(input).toHaveValue('31/07/2026')
  expect(screen.getByLabelText('重量（kg）')).toHaveValue('')
  expect(openSessionLoader).toHaveBeenLastCalledWith('v978','31/07/2026','fish_head')
})

it('rejects an impossible completed date without querying or discarding the original draft',async()=>{
  const openSessionLoader=vi.fn(async()=>null)
  mount({openSessionLoader});await ready();typeWeight()
  const input=screen.getByLabelText('日期'),reads=openSessionLoader.mock.calls.length
  fireEvent.change(input,{target:{value:'31/02/2026'}});fireEvent.blur(input)
  expect(input).toHaveAttribute('aria-invalid','true')
  expect(screen.getByRole('alert')).toHaveTextContent('日期必须为有效的 DD/MM/YYYY 格式。')
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByLabelText('重量（kg）')).toHaveValue('80.5')
  expect(screen.getByRole('button',{name:'确认加入'})).toBeDisabled()
  expect(openSessionLoader).toHaveBeenCalledTimes(reads)
  fireEvent.change(input,{target:{value:'30/07/2026'}});fireEvent.blur(input)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button',{name:'确认加入'})).not.toBeDisabled()
})

it.each(['vessel','product'] as const)('protects an unfinished date edit before a %s change',async(kind)=>{
  const openSessionLoader=vi.fn(async()=>null)
  mount({openSessionLoader});await ready()
  const input=screen.getByLabelText('日期'),reads=openSessionLoader.mock.calls.length
  fireEvent.change(input,{target:{value:'31/07/'}});fireEvent.blur(input)
  const changeContext=()=>{
    if(kind==='vessel')fireEvent.change(screen.getByLabelText('船号'),{target:{value:'v833'}})
    else fireEvent.click(screen.getByRole('button',{name:'鱼仔'}))
  }
  changeContext()
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'取消，保留资料'}))
  expect(input).toHaveValue('31/07/')
  expect(input).toHaveAttribute('aria-invalid','true')
  expect(screen.getByLabelText('船号')).toHaveValue('v978')
  expect(screen.getByRole('button',{name:'鱼头'})).toHaveAttribute('aria-pressed','true')
  expect(openSessionLoader).toHaveBeenCalledTimes(reads)
  changeContext();fireEvent.click(screen.getByRole('button',{name:'继续切换'}));await ready()
  expect(input).toHaveValue('30/07/2026')
  expect(input).toHaveAttribute('aria-invalid','false')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  if(kind==='vessel')expect(screen.getByLabelText('船号')).toHaveValue('v833')
  else expect(screen.getByRole('button',{name:'鱼仔'})).toHaveAttribute('aria-pressed','true')
})

it.each([['vessel',true],['product',true],['vessel',false],['product',false]] as const)('keeps the valid date when blur is followed by a %s selection (basket draft: %s)',async(kind,dirty)=>{
  const openSessionLoader=vi.fn(async()=>null)
  mount({openSessionLoader});await ready();if(dirty)typeWeight()
  fireEvent.change(screen.getByLabelText('日期'),{target:{value:'31/07/2026'}})
  // Both handlers can run in the same direct date-to-selector interaction.
  act(()=>{
    fireEvent.blur(screen.getByLabelText('日期'))
    if(kind==='vessel')fireEvent.change(screen.getByLabelText('船号'),{target:{value:'v833'}})
    else fireEvent.click(screen.getByRole('button',{name:'鱼仔'}))
  })
  if(dirty)fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'继续切换'}))
  else expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  await ready()
  expect(screen.getByLabelText('日期')).toHaveValue('31/07/2026')
  expect(screen.getByLabelText('重量（kg）')).toHaveValue('')
  expect(openSessionLoader).toHaveBeenLastCalledWith(kind==='vessel'?'v833':'v978','31/07/2026',kind==='product'?'fish_meal':'fish_head')
})

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
  if(kind==='date'){fireEvent.change(screen.getByLabelText('日期'),{target:{value:'31/07/2026'}});fireEvent.blur(screen.getByLabelText('日期'))}
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
  fireEvent.blur(screen.getByLabelText('日期'))
  fireEvent.keyDown(screen.getByRole('alertdialog'),{key:'Escape'})
  expect(screen.getByLabelText('日期')).toHaveValue('30/07/2026')
  expect(screen.getByLabelText('备注')).toHaveValue('48包')
  fireEvent.change(screen.getByLabelText('船号'),{target:{value:'v833'}})
  fireEvent.click(screen.getByRole('button',{name:'继续切换'}));await ready()
  expect(screen.getByLabelText('备注')).toHaveValue('')
})

it.each(['vessel','date','product'] as const)('protects a hidden fish-meal remark after switching to individual mode before a %s change',async(kind)=>{
  mount();await ready();fireEvent.click(screen.getByRole('button',{name:'鱼仔'}));await ready()
  fireEvent.click(screen.getByRole('button',{name:'总重量'}))
  fireEvent.change(screen.getByLabelText('备注'),{target:{value:'未确认的48包'}})
  fireEvent.click(screen.getByRole('button',{name:'逐篮'}))
  expect(screen.queryByLabelText('备注')).not.toBeInTheDocument()
  const request=()=>{
    if(kind==='vessel')fireEvent.change(screen.getByLabelText('船号'),{target:{value:'v833'}})
    if(kind==='date'){fireEvent.change(screen.getByLabelText('日期'),{target:{value:'31/07/2026'}});fireEvent.blur(screen.getByLabelText('日期'))}
    if(kind==='product')fireEvent.click(screen.getByRole('button',{name:'鱼头'}))
  }
  request();fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'取消，保留资料'}))
  fireEvent.click(screen.getByRole('button',{name:'总重量'}))
  expect(screen.getByLabelText('备注')).toHaveValue('未确认的48包')
  fireEvent.click(screen.getByRole('button',{name:'逐篮'}));request()
  fireEvent.click(screen.getByRole('button',{name:'继续切换'}));await ready()
  if(kind==='product'){fireEvent.click(screen.getByRole('button',{name:'鱼仔'}));await ready()}
  fireEvent.click(screen.getByRole('button',{name:'总重量'}))
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
  fireEvent.blur(screen.getByLabelText('日期'))
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()
})

it('protects a paper edit made during asynchronous species initialization instead of marking it committed',async()=>{
  let resolve!:(value:typeof DEFAULT_FISH_SPECIES)=>void
  const initialization=new Promise<typeof DEFAULT_FISH_SPECIES>(done=>{resolve=done})
  const speciesInitializer=vi.fn(()=>initialization)
  const {store,props,rerender}=mount({speciesLoader:async()=>[],speciesInitializer})
  await ready()
  fireEvent.change(screen.getByLabelText('鱼头纸单号'),{target:{value:'COMMIT-A'}});typeWeight()
  fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
  await waitFor(()=>expect(speciesInitializer).toHaveBeenCalledTimes(2))
  fireEvent.change(screen.getByLabelText('鱼头纸单号'),{target:{value:'UNSAVED-B'}})
  await act(async()=>resolve(DEFAULT_FISH_SPECIES));await screen.findByText('已保存')
  const saved=await store.getSession((await store.getPending())[0].sessionId)
  expect(saved?.externalSlipNo).toBe('COMMIT-A')
  expect(screen.getByLabelText('鱼头纸单号')).toHaveValue('UNSAVED-B')
  // Recheck the same local context as a changed loader/reference would do.
  rerender(<MemoryRouter><WeighingEntryPage {...props} bundleLoader={async()=>({session:saved!,entries:await store.getEntries(saved!.id)})}/></MemoryRouter>)
  await ready()
  expect(screen.getByLabelText('鱼头纸单号')).toHaveValue('UNSAVED-B')
  fireEvent.change(screen.getByLabelText('船号'),{target:{value:'v833'}})
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()
})

it('ignores a same-day formatting change and switches a committed paper number without a false dirty prompt',async()=>{
  mount();await ready()
  fireEvent.change(screen.getByLabelText('鱼头纸单号'),{target:{value:' PAPER-1 '}})
  typeWeight();fireEvent.change(screen.getByLabelText('日期'),{target:{value:'2026-07-30'}})
  fireEvent.blur(screen.getByLabelText('日期'))
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
