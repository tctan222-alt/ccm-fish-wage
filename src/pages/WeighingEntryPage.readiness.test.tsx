import { act,cleanup,fireEvent,render,screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { DEFAULT_VESSELS,type Vessel } from '../lib/purchasing'
import { DEFAULT_FISH_SPECIES,newWeighingSession,type FishSpeciesRecord } from '../lib/weighing'
import type { WeighingBundle } from '../services/weighing'
import { createMemoryWeighingStore } from '../services/weighingOffline'
import { WeighingEntryPage } from './WeighingEntryPage'

const date='2026-09-30'
const now='2026-09-30T04:00:00.000Z'
const savedVessels=DEFAULT_VESSELS.map(item=>({...item,id:`saved-${item.vesselCode}`,createdBy:'test-owner'}))
const savedSpecies=DEFAULT_FISH_SPECIES.map(item=>({...item,id:`saved-${item.speciesCode}`,createdBy:'test-owner'}))
const customVessel:Vessel={...savedVessels[0],id:'custom-vessel',vesselCode:'TEST-1',displayName:'TEST-1'}
const customSpecies:FishSpeciesRecord={id:'custom-fish',speciesCode:'custom_fish',displayName:'测试鱼',active:true,order:99,notes:''}

function deferred<T>(){
  let resolve!:(value:T)=>void
  const promise=new Promise<T>(done=>{resolve=done})
  return {promise,resolve}
}

function afterThreeSeconds<T>(value:T){return new Promise<T>(resolve=>setTimeout(()=>resolve(value),3000))}
async function settle(){await act(async()=>{})}
async function advance(milliseconds:number){await act(async()=>{await vi.advanceTimersByTimeAsync(milliseconds)})}

function bundle(vesselId:string,status:'weighing'|'completed'|'processed'='weighing'):WeighingBundle{
  return {session:{...newWeighingSession({id:`existing-${vesselId}`,productType:'fish_head',vesselId,
    vesselCodeSnapshot:vesselId.replace('saved-',''),vesselNameSnapshot:vesselId,weighingDate:date}),
  status,...(status==='weighing'?{}:{completedAt:new Date(now)})},entries:[]}
}

function setup(options:Partial<ComponentProps<typeof WeighingEntryPage>>={}){
  const store=options.offlineStore??createMemoryWeighingStore()
  const commit=vi.spyOn(store,'commitOperation')
  const remoteSync=vi.fn(async()=>({}))
  const props:ComponentProps<typeof WeighingEntryPage>={
    fixedProductType:'fish_head',pageTitle:'鱼头购入',offlineStore:store,
    vesselLoader:async()=>savedVessels,speciesLoader:async()=>savedSpecies,
    vesselInitializer:async()=>savedVessels,speciesInitializer:async()=>savedSpecies,
    speciesCreator:async value=>value,openSessionLoader:async()=>null,closedSessionLoader:async()=>null,
    bundleLoader:async id=>bundle(id),remoteSync,today:()=>date,now:()=>now,
    idFactory:kind=>`${kind}-readiness`,...options,
  }
  render(<MemoryRouter><WeighingEntryPage {...props}/></MemoryRouter>)
  return {store,commit,remoteSync}
}

beforeEach(()=>{vi.useFakeTimers()})
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks()})

describe('鱼头采购输入与保存准备状态',()=>{
  it('无缓存且两份主资料延迟 3 秒时，默认船鱼和 kg/keypad 立即可用；刷新保留选择和重量',async()=>{
    setup({vesselLoader:()=>afterThreeSeconds(savedVessels),speciesLoader:()=>afterThreeSeconds(savedSpecies)})
    const vessel=screen.getByRole('combobox',{name:'船号'})
    const weight=screen.getByLabelText('重量（kg）')
    expect(vessel).toHaveValue('978')
    expect(screen.getByRole('button',{name:'金线'})).toHaveAttribute('aria-pressed','true')
    expect(weight).not.toBeDisabled()
    fireEvent.change(vessel,{target:{value:'833'}})
    fireEvent.click(screen.getByRole('button',{name:'来戈'}))
    fireEvent.click(screen.getByRole('button',{name:'8'}))
    fireEvent.click(screen.getByRole('button',{name:'0'}))
    expect(weight).toHaveValue('80')
    await advance(2999)
    expect(vessel).toHaveValue('833')
    expect(weight).toHaveValue('80')
    await advance(1)
    expect(vessel).toHaveValue('saved-833')
    expect(screen.getByRole('button',{name:'来戈'})).toHaveAttribute('aria-pressed','true')
    expect(weight).toHaveValue('80')
  })

  it('有缓存时在远端 3 秒返回前载入自定义船鱼及 lastVesselId，并能输入重量',async()=>{
    const store=createMemoryWeighingStore()
    await store.putMeta('reference:vessels',JSON.stringify([...savedVessels,customVessel]))
    await store.putMeta('reference:species',JSON.stringify([...savedSpecies,customSpecies]))
    await store.putMeta('lastVesselId',customVessel.id)
    setup({offlineStore:store,vesselLoader:()=>afterThreeSeconds([...savedVessels,customVessel]),
      speciesLoader:()=>afterThreeSeconds([...savedSpecies,customSpecies])})
    await settle()
    expect(screen.getByRole('combobox',{name:'船号'})).toHaveValue(customVessel.id)
    fireEvent.click(screen.getByRole('button',{name:customSpecies.displayName}))
    fireEvent.click(screen.getByRole('button',{name:'8'}))
    await advance(2999)
    expect(screen.getByLabelText('重量（kg）')).toHaveValue('8')
    await advance(1)
    expect(screen.getByRole('combobox',{name:'船号'})).toHaveValue(customVessel.id)
    expect(screen.getByRole('button',{name:customSpecies.displayName})).toHaveAttribute('aria-pressed','true')
    expect(screen.getByLabelText('重量（kg）')).toHaveValue('8')
  })

  it('用户已选船鱼并输入 kg 后，迟到的缓存 lastVesselId 不覆盖输入',async()=>{
    const store=createMemoryWeighingStore(),cached=deferred<string|undefined>()
    const getMeta=store.getMeta.bind(store)
    vi.spyOn(store,'getMeta').mockImplementation(key=>key==='lastVesselId'?cached.promise:getMeta(key))
    await store.putMeta('reference:vessels',JSON.stringify(savedVessels))
    await store.putMeta('reference:species',JSON.stringify(savedSpecies))
    setup({offlineStore:store,vesselLoader:()=>afterThreeSeconds(savedVessels),speciesLoader:()=>afterThreeSeconds(savedSpecies)})
    fireEvent.change(screen.getByRole('combobox',{name:'船号'}),{target:{value:'833'}})
    fireEvent.click(screen.getByRole('button',{name:'来戈'}))
    fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:'42.5'}})
    await act(async()=>{cached.resolve('saved-978')})
    await advance(3000)
    expect(screen.getByRole('combobox',{name:'船号'})).toHaveValue('saved-833')
    expect(screen.getByRole('button',{name:'来戈'})).toHaveAttribute('aria-pressed','true')
    expect(screen.getByLabelText('重量（kg）')).toHaveValue('42.5')
  })

  it('核对当前现场单时可输入，确认和 Enter 都不能提前保存；核对后保存原 kg',async()=>{
    const checked=deferred<WeighingBundle|null>()
    const {commit}=setup({openSessionLoader:()=>checked.promise})
    await settle()
    const weight=screen.getByLabelText('重量（kg）'),confirm=screen.getByRole('button',{name:'确认加入'})
    expect(weight).not.toBeDisabled()
    expect(screen.getByText(/正在核对现场单/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'8'}))
    expect(weight).toHaveValue('8')
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    fireEvent.keyDown(weight,{key:'Enter'})
    await settle()
    expect(commit).not.toHaveBeenCalled()
    await act(async()=>{checked.resolve(null)})
    expect(confirm).not.toBeDisabled()
    expect(weight).toHaveValue('8')
    fireEvent.click(confirm)
    await settle()
    expect(commit).toHaveBeenCalledOnce()
    expect(commit.mock.calls[0][0].entry).toMatchObject({vesselId:'saved-978',weightGrams:8000})
  })

  it('切换船号后可立即继续使用 kg/keypad，待新船核对完成再允许保存',async()=>{
    const next=deferred<WeighingBundle|null>()
    const {commit}=setup({openSessionLoader:async id=>id==='saved-833'?next.promise:null})
    await settle()
    fireEvent.change(screen.getByRole('combobox',{name:'船号'}),{target:{value:'saved-833'}})
    const weight=screen.getByLabelText('重量（kg）')
    expect(weight).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button',{name:'6'}))
    expect(weight).toHaveValue('6')
    expect(screen.getByRole('button',{name:'确认加入'})).toBeDisabled()
    fireEvent.keyDown(weight,{key:'Enter'})
    await settle()
    expect(commit).not.toHaveBeenCalled()
    await act(async()=>{next.resolve(null)})
    expect(weight).toHaveValue('6')
    expect(screen.getByRole('button',{name:'确认加入'})).not.toBeDisabled()
  })

  it.each(['completed','processed'] as const)('核对后发现 %s 现场单时，锁定输入并禁止新建重复单',async status=>{
    const closed=deferred<WeighingBundle|null>()
    const {commit}=setup({closedSessionLoader:()=>closed.promise})
    await settle()
    const weight=screen.getByLabelText('重量（kg）')
    expect(weight).not.toBeDisabled()
    fireEvent.change(weight,{target:{value:'80'}})
    expect(screen.getByRole('button',{name:'确认加入'})).toBeDisabled()
    await act(async()=>{closed.resolve(bundle('saved-978',status))})
    expect(weight).toBeDisabled()
    expect(screen.getByRole('button',{name:'8'})).toBeDisabled()
    expect(screen.getByRole('button',{name:'确认加入'})).toBeDisabled()
    fireEvent.keyDown(weight,{key:'Enter'})
    await settle()
    expect(commit).not.toHaveBeenCalled()
  })

  it('旧船迟到的 locked response 不会锁定新船或替换新输入',async()=>{
    const old=deferred<WeighingBundle|null>(),current=deferred<WeighingBundle|null>()
    const load=vi.fn(async(id:string)=>id==='saved-833'?current.promise:old.promise)
    setup({openSessionLoader:load})
    await settle()
    fireEvent.change(screen.getByRole('combobox',{name:'船号'}),{target:{value:'saved-833'}})
    fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:'60'}})
    await settle()
    await act(async()=>{current.resolve(null)})
    await act(async()=>{old.resolve(bundle('saved-978','processed'))})
    expect(screen.getByRole('combobox',{name:'船号'})).toHaveValue('saved-833')
    expect(screen.getByLabelText('重量（kg）')).toHaveValue('60')
    expect(screen.getByLabelText('重量（kg）')).not.toBeDisabled()
    expect(screen.getByRole('button',{name:'确认加入'})).not.toBeDisabled()
    expect(screen.queryByText('已结单，现场录入已锁定。')).not.toBeInTheDocument()
  })

  it('默认船解析成 canonical ID 后必须等该 ID 核对完成，再加入既有单',async()=>{
    const existing=deferred<WeighingBundle|null>()
    const load=vi.fn(async(id:string)=>id==='saved-978'?existing.promise:null)
    const {commit}=setup({vesselLoader:()=>afterThreeSeconds(savedVessels),
      speciesLoader:()=>afterThreeSeconds(savedSpecies),openSessionLoader:load})
    fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:'80'}})
    await advance(3000)
    expect(load).toHaveBeenCalledWith('saved-978',date,'fish_head')
    expect(screen.getByRole('button',{name:'确认加入'})).toBeDisabled()
    fireEvent.keyDown(screen.getByLabelText('重量（kg）'),{key:'Enter'})
    await settle()
    expect(commit).not.toHaveBeenCalled()
    await act(async()=>{existing.resolve(bundle('saved-978'))})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await settle()
    expect(commit).toHaveBeenCalledOnce()
    expect(commit.mock.calls[0][0].session.id).toBe('existing-saved-978')
    expect(commit.mock.calls[0][0].entry).toMatchObject({sessionId:'existing-saved-978',weightGrams:80000})
  })

  it('只输入默认船的重量后，迟到的 lastVesselId 也不会把篮重移到另一艘船',async()=>{
    const store=createMemoryWeighingStore(),preference=deferred<string|undefined>()
    const getMeta=store.getMeta.bind(store)
    await store.putMeta('reference:vessels',JSON.stringify(savedVessels))
    await store.putMeta('reference:species',JSON.stringify(savedSpecies))
    vi.spyOn(store,'getMeta').mockImplementation(key=>key==='lastVesselId'?preference.promise:getMeta(key))
    setup({offlineStore:store,vesselLoader:()=>afterThreeSeconds(savedVessels),speciesLoader:()=>afterThreeSeconds(savedSpecies)})
    fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:'47.5'}})
    await act(async()=>{preference.resolve('saved-833')})
    expect(screen.getByRole('combobox',{name:'船号'})).toHaveValue('saved-978')
    expect(screen.getByLabelText('重量（kg）')).toHaveValue('47.5')
    await advance(3000)
    expect(screen.getByRole('combobox',{name:'船号'})).toHaveValue('saved-978')
    expect(screen.getByLabelText('重量（kg）')).toHaveValue('47.5')
  })

  it('鱼名刷新失败时，迟到的旧船缓存不能覆盖已成功更新的服务器船号',async()=>{
    const store=createMemoryWeighingStore(),oldVessels=deferred<string|undefined>()
    const getMeta=store.getMeta.bind(store)
    await store.putMeta('reference:species',JSON.stringify([...savedSpecies,customSpecies]))
    vi.spyOn(store,'getMeta').mockImplementation(key=>key==='reference:vessels'?oldVessels.promise:getMeta(key))
    setup({offlineStore:store,vesselLoader:async()=>[...savedVessels,customVessel],
      speciesLoader:async()=>{throw new Error('species offline')}})
    await settle()
    expect(screen.getByRole('combobox',{name:'船号'})).toHaveValue('saved-978')
    expect(screen.getByRole('option',{name:customVessel.vesselCode})).toBeInTheDocument()
    const staleRows=savedVessels.map(item=>({...item,id:`old-${item.vesselCode}`}))
    await act(async()=>{oldVessels.resolve(JSON.stringify([...staleRows,{...customVessel,id:'old-only',vesselCode:'OLD'}]))})
    expect(screen.getByRole('combobox',{name:'船号'})).toHaveValue('saved-978')
    expect(screen.getByRole('option',{name:customVessel.vesselCode})).toBeInTheDocument()
    expect(screen.queryByRole('option',{name:'OLD'})).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:customSpecies.displayName})).toBeInTheDocument()
  })

  it('日期输入到一半保留旧 kg 且不能保存，提交有效日期才确认切换',async()=>{
    const {commit}=setup()
    await settle()
    const dateInput=screen.getByLabelText('日期'),weight=screen.getByLabelText('重量（kg）')
    fireEvent.change(weight,{target:{value:'25'}})
    fireEvent.change(dateInput,{target:{value:'2026-'}})
    fireEvent.blur(dateInput)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('日期必须为有效的 DD/MM/YYYY 格式。')
    expect(weight).toHaveValue('25')
    expect(weight).not.toBeDisabled()
    expect(screen.getByRole('button',{name:'确认加入'})).toBeDisabled()
    fireEvent.keyDown(weight,{key:'Enter'})
    await settle()
    expect(commit).not.toHaveBeenCalled()
    fireEvent.change(dateInput,{target:{value:'2026-10-01'}})
    fireEvent.keyDown(dateInput,{key:'Enter'})
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(weight).toHaveValue('25')
    fireEvent.click(screen.getByRole('button',{name:'继续切换'}))
    await settle()
    expect(screen.getByRole('button',{name:'确认加入'})).not.toBeDisabled()
    expect(weight).toHaveValue('')
    fireEvent.change(weight,{target:{value:'25'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await settle()
    expect(commit).toHaveBeenCalledOnce()
    expect(commit.mock.calls[0][0].session).toMatchObject({weighingDate:'01/10/2026'})
    expect(commit.mock.calls[0][0].entry).toMatchObject({weightGrams:25000})
  })

  it('默认船初始化改为真实 ID 后保留 kg，重新核对后由用户确认加入原单',async()=>{
    const initialized=deferred<Vessel[]>(),existing=deferred<WeighingBundle|null>()
    const {commit}=setup({vesselLoader:async()=>[],vesselInitializer:()=>initialized.promise,
      openSessionLoader:async id=>id==='saved-978'?existing.promise:null})
    await settle()
    const weight=screen.getByLabelText('重量（kg）')
    fireEvent.change(weight,{target:{value:'80'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await settle()
    expect(commit).not.toHaveBeenCalled()
    await act(async()=>{initialized.resolve(savedVessels)})
    expect(screen.getByRole('combobox',{name:'船号'})).toHaveValue('saved-978')
    expect(weight).toHaveValue('80')
    expect(screen.getByRole('button',{name:'确认加入'})).toBeDisabled()
    expect(commit).not.toHaveBeenCalled()
    await act(async()=>{existing.resolve(bundle('saved-978'))})
    expect(commit).not.toHaveBeenCalled()
    expect(weight).toHaveValue('80')
    expect(screen.getByRole('button',{name:'确认加入'})).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await settle()
    expect(commit).toHaveBeenCalledOnce()
    expect(commit.mock.calls[0][0].session.id).toBe('existing-saved-978')
    expect(commit.mock.calls[0][0].entry).toMatchObject({sessionId:'existing-saved-978',weightGrams:80000})
  })

  it('默认鱼名初始化仍在等待时连续确认和 Enter 只保存一篮',async()=>{
    const initialized=deferred<FishSpeciesRecord[]>()
    const {commit,store}=setup({speciesLoader:async()=>[],speciesInitializer:()=>initialized.promise})
    await settle()
    const weight=screen.getByLabelText('重量（kg）'),confirm=screen.getByRole('button',{name:'确认加入'})
    fireEvent.change(weight,{target:{value:'80'}})
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    fireEvent.keyDown(weight,{key:'Enter'})
    await settle()
    expect(commit).not.toHaveBeenCalled()
    await act(async()=>{initialized.resolve(DEFAULT_FISH_SPECIES)})
    expect(commit).toHaveBeenCalledOnce()
    expect(commit.mock.calls[0][0].entry).toMatchObject({weightGrams:80000})
    expect(await store.getEntries('session-readiness')).toHaveLength(1)
  })
})
