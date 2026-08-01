import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import { MemoryRouter,useLocation } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { applyEntryCreated,DEFAULT_FISH_SPECIES,newWeighingSession,type FishSpeciesRecord,type WeighingEntry,type WeighingSession } from '../lib/weighing'
import { createMemoryWeighingStore,type PendingWeighingOperation } from '../services/weighingOffline'
import { WeighingEntryPage } from './WeighingEntryPage'

const vessels=['978','833','2072','9633','4818','2031','1785','5202'].map((vesselCode,order)=>(
  {id:`v${vesselCode}`,vesselCode,displayName:vesselCode,defaultSupplierId:'',defaultSupplierNameSnapshot:'',active:true,order,notes:''}
))

afterEach(()=>{cleanup();vi.clearAllMocks()})

function Location(){return <output aria-label="route">{useLocation().pathname}</output>}
function setup(sync=remoteSync()){
  const store=createMemoryWeighingStore()
  render(<MemoryRouter initialEntries={['/weighing/new']}><Location/><WeighingEntryPage
    vesselLoader={async()=>vessels}
    speciesLoader={async()=>DEFAULT_FISH_SPECIES}
    openSessionLoader={async()=>null}
    closedSessionLoader={async()=>null}
    offlineStore={store}
    remoteSync={sync}
    today={()=> '2026-07-30'}
    now={()=> '2026-07-30T12:00:00.000+08:00'}
    idFactory={kind=>kind==='session'?'session-v978-20260730':`${kind}-1`}
  /></MemoryRouter>)
  return {store,sync}
}

describe('iPhone 现场称重单页',()=>{
  it('在同一页显示中文船号、日期、产品、16 个鱼名、kg 和确认',async()=>{
    setup()
    expect(await screen.findByRole('heading',{name:'现场称重'})).toBeInTheDocument()
    expect(screen.getByRole('combobox',{name:'船号'})).toHaveValue('v978')
    for(const vessel of vessels)expect(screen.getByRole('option',{name:vessel.vesselCode})).toBeInTheDocument()
    expect(screen.getByText('30/07/2026')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'鱼头'})).toHaveAttribute('aria-pressed','true')
    const species=screen.getByRole('group',{name:'鱼名'})
    expect(within(species).getAllByRole('button')).toHaveLength(17)
    expect(within(species).getByRole('button',{name:'金线'})).toHaveAttribute('aria-pressed','true')
    expect(screen.getByLabelText('重量（kg）')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'确认加入'})).toBeInTheDocument()
    expect(screen.getByLabelText('route')).toHaveTextContent('/weighing/new')
    expect(document.body).not.toHaveTextContent('fish_head')
    expect(document.body).not.toHaveTextContent('jin_xian')
  })

  it('每篮先本地保存，成功后只清空 kg、保留鱼名并重新聚焦',async()=>{
    const {store}=setup()
    const weight=await screen.findByLabelText('重量（kg）')
    fireEvent.change(weight,{target:{value:'80'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))

    expect(await screen.findByText('已保存')).toBeInTheDocument()
    expect(weight).toHaveValue('')
    expect(weight).toHaveFocus()
    expect(screen.getByRole('button',{name:'金线'})).toHaveAttribute('aria-pressed','true')
    expect(screen.getByText('最近一篮')).toBeInTheDocument()
    expect(screen.getAllByText('金线').length).toBeGreaterThan(1)
    expect(screen.getAllByText('80 kg').length).toBeGreaterThan(0)
    expect(screen.getByText('1 篮')).toBeInTheDocument()
    expect((await store.getEntries('session-v978-20260730'))).toEqual([expect.objectContaining({receiptNoSnapshot:'FH-978-30072026-01'})])
  })

  it('切换船号会切换当天同产品的草稿单，不会混入或改写另一艘船的记录',async()=>{
    const store=createMemoryWeighingStore()
    let sessionNo=0,entryNo=0
    render(<MemoryRouter><WeighingEntryPage fixedProductType="fish_head" pageTitle="鱼头购入"
      vesselLoader={async()=>vessels} speciesLoader={async()=>DEFAULT_FISH_SPECIES} openSessionLoader={async()=>null} closedSessionLoader={async()=>null}
      offlineStore={store} remoteSync={remoteSync()} today={()=> '2026-07-30'} now={()=> '2026-07-30T12:00:00.000+08:00'}
      idFactory={kind=>kind==='session'?`session-${++sessionNo}`:`entry-${++entryNo}`}/></MemoryRouter>)

    const weight=await screen.findByLabelText('重量（kg）')
    fireEvent.change(weight,{target:{value:'80'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await screen.findByText('已保存')
    expect(screen.getByRole('region',{name:'现场汇总'})).toHaveTextContent('80 kg')

    fireEvent.change(screen.getByRole('combobox',{name:'船号'}),{target:{value:'v833'}})
    await waitFor(()=>expect(screen.getByRole('region',{name:'现场汇总'})).not.toHaveTextContent('80 kg'))
    await waitFor(()=>expect(screen.getByLabelText('重量（kg）')).not.toBeDisabled())
    fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:'60'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await waitFor(async()=>expect(await store.getEntries('session-2')).toHaveLength(1))

    fireEvent.change(screen.getByRole('combobox',{name:'船号'}),{target:{value:'v978'}})
    await waitFor(()=>expect(screen.getByRole('region',{name:'现场汇总'})).toHaveTextContent('80 kg'))
    expect(screen.getByRole('region',{name:'现场汇总'})).not.toHaveTextContent('60 kg')
    const firstSession=await store.getSession('session-1')
    expect(firstSession).toMatchObject({vesselId:'v978',vesselCodeSnapshot:'978',productType:'fish_head'})
    expect((await store.getEntries('session-1'))[0]).toMatchObject({vesselId:'v978',vesselCodeSnapshot:'978'})
  })

  it('鱼仔也按船号、日期和产品类型独立恢复草稿汇总',async()=>{
    const store=createMemoryWeighingStore()
    let sessionNo=0,entryNo=0
    render(<MemoryRouter><WeighingEntryPage fixedProductType="fish_meal" pageTitle="鱼仔购入"
      vesselLoader={async()=>vessels} speciesLoader={async()=>DEFAULT_FISH_SPECIES} openSessionLoader={async()=>null} closedSessionLoader={async()=>null}
      offlineStore={store} remoteSync={remoteSync()} today={()=> '2026-07-30'} now={()=> '2026-07-30T12:00:00.000+08:00'}
      idFactory={kind=>kind==='session'?`meal-session-${++sessionNo}`:`meal-entry-${++entryNo}`}/></MemoryRouter>)

    const weight=await screen.findByLabelText('重量（kg）')
    fireEvent.change(weight,{target:{value:'10'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await screen.findByText('已保存')
    fireEvent.change(screen.getByRole('combobox',{name:'船号'}),{target:{value:'v833'}})
    await waitFor(()=>expect(screen.getByLabelText('重量（kg）')).not.toBeDisabled())
    expect(screen.getByRole('region',{name:'现场汇总'})).not.toHaveTextContent('10 kg')
    fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:'20'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await waitFor(async()=>expect(await store.getEntries('meal-session-2')).toHaveLength(1))
    fireEvent.change(screen.getByRole('combobox',{name:'船号'}),{target:{value:'v978'}})
    await waitFor(()=>expect(screen.getByRole('region',{name:'现场汇总'})).toHaveTextContent('10 kg'))
    expect(await store.getSession('meal-session-1')).toMatchObject({productType:'fish_meal',vesselId:'v978',sessionCode:'FM-978-30072026-01'})
  })

  it('已结单的当前船单会明确锁定现场录入，而不会静默新建或混入草稿',async()=>{
    const settled={...newWeighingSession({id:'settled-978',productType:'fish_head',vesselId:'v978',vesselCodeSnapshot:'978',vesselNameSnapshot:'978',weighingDate:'2026-07-30'}),status:'processed' as const}
    render(<MemoryRouter><WeighingEntryPage fixedProductType="fish_head" pageTitle="鱼头购入"
      vesselLoader={async()=>vessels} speciesLoader={async()=>DEFAULT_FISH_SPECIES} openSessionLoader={async()=>null}
      closedSessionLoader={async()=>({session:settled,entries:[]})} offlineStore={createMemoryWeighingStore()} remoteSync={remoteSync()}
      today={()=> '2026-07-30'} now={()=> '2026-07-30T12:00:00.000+08:00'}/></MemoryRouter>)
    expect(await screen.findByText('这张单已结单。本版暂未支持同船同日新建第二张单，请在后台处理。')).toBeInTheDocument()
    expect(screen.getByLabelText('重量（kg）')).toBeDisabled()
    expect(screen.getByRole('button',{name:'确认加入'})).toBeDisabled()
  })

  it('延迟的旧草稿加载不会覆盖刚确认保存的第一篮',async()=>{
    const store=createMemoryWeighingStore()
    let release:(value:null)=>void=()=>{}
    const delayed=new Promise<null>(resolve=>{release=resolve})
    const loader=vi.fn(()=>delayed)
    render(<MemoryRouter><WeighingEntryPage vesselLoader={async()=>vessels} speciesLoader={async()=>DEFAULT_FISH_SPECIES}
      openSessionLoader={loader} closedSessionLoader={async()=>null} offlineStore={store} remoteSync={remoteSync()} today={()=> '2026-07-30'} now={()=> '2026-07-30T12:00:00.000+08:00'}
      idFactory={kind=>kind==='session'?'race-session':`${kind}-race`}/></MemoryRouter>)
    const weight=await screen.findByLabelText('重量（kg）')
    await waitFor(()=>expect(loader).toHaveBeenCalledOnce())
    fireEvent.change(weight,{target:{value:'80'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await screen.findByText('已保存')
    release(null)
    await waitFor(async()=>expect(await store.getEntries('race-session')).toHaveLength(1))
    expect(screen.getByRole('region',{name:'现场汇总'})).toHaveTextContent('80 kg')
  })

  it('支持 Enter 确认，并让鱼仔总重保留品质及 remark 而不增加篮数',async()=>{
    const {store}=setup()
    await screen.findByLabelText('重量（kg）')
    fireEvent.click(screen.getByRole('button',{name:'鱼仔'}))
    await waitFor(()=>expect(screen.getByLabelText('重量（kg）')).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button',{name:'包鱼仔'}))
    fireEvent.click(screen.getByRole('button',{name:'总重量'}))
    fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:'3568'}})
    fireEvent.change(screen.getByLabelText('备注'),{target:{value:'总共48包'}})
    fireEvent.keyDown(screen.getByLabelText('重量（kg）'),{key:'Enter'})

    await screen.findByText('已保存')
    const [saved]=await store.getEntries('session-v978-20260730')
    expect(saved).toMatchObject({fishMealQuality:'bag',entryMode:'total',sequenceNo:null,weightGrams:3_568_000,remark:'总共48包'})
    expect(screen.getByText('0 篮')).toBeInTheDocument()
    expect(screen.getByLabelText('route')).toHaveTextContent('/weighing/new')
  })

  it('保存期间锁定确认，双击也只产生一笔记录',async()=>{
    let release:(value:{session:WeighingSession;entry:WeighingEntry})=>void=()=>{}
    const sync=vi.fn((operation:PendingWeighingOperation)=>new Promise<{session:WeighingSession;entry:WeighingEntry}>(resolve=>{
      release=resolve
      void operation
    }))
    const {store}=setup(sync)
    fireEvent.change(await screen.findByLabelText('重量（kg）'),{target:{value:'70'}})
    const confirm=screen.getByRole('button',{name:'确认加入'})
    fireEvent.click(confirm);fireEvent.click(confirm)
    expect(confirm).toBeDisabled()
    await waitFor(async()=>expect(await store.getEntries('session-v978-20260730')).toHaveLength(1))
    await waitFor(()=>expect(sync).toHaveBeenCalledOnce())
    const operation=sync.mock.calls[0][0]
    const payload=operation.payload as {session:WeighingSession;entry:WeighingEntry}
    release({session:applyEntryCreated(payload.session,payload.entry),entry:payload.entry})
  })

  it('完成称重后锁定普通输入',async()=>{
    setup()
    fireEvent.change(await screen.findByLabelText('重量（kg）'),{target:{value:'60'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await screen.findByText('已保存')
    fireEvent.click(screen.getByRole('button',{name:'完成称重'}))
    fireEvent.click(screen.getByRole('button',{name:'确认完成'}))
    await waitFor(()=>expect(screen.getByText('已完成，等待同步')).toBeInTheDocument())
    expect(screen.getByLabelText('重量（kg）')).toBeDisabled()
    expect(screen.getByRole('button',{name:'确认加入'})).toBeDisabled()
  })

  it('曾在线载入后，离线重开仍可使用缓存的船号和鱼名继续录入',async()=>{
    const shared=new Map<string,unknown>(),firstStore=createMemoryWeighingStore(shared)
    const first=render(<MemoryRouter><WeighingEntryPage vesselLoader={async()=>vessels}
      speciesLoader={async()=>DEFAULT_FISH_SPECIES} openSessionLoader={async()=>null} closedSessionLoader={async()=>null}
      offlineStore={firstStore} remoteSync={remoteSync()} today={()=> '2026-07-30'}/></MemoryRouter>)
    expect(await screen.findByRole('button',{name:'金线'})).toBeInTheDocument()
    await waitFor(()=>expect(firstStore.getMeta('reference:vessels')).resolves.toBeTruthy())
    first.unmount()

    render(<MemoryRouter><WeighingEntryPage vesselLoader={async()=>{throw new Error('offline')}}
      speciesLoader={async()=>{throw new Error('offline')}} openSessionLoader={async()=>null} closedSessionLoader={async()=>null}
      offlineStore={createMemoryWeighingStore(shared)} remoteSync={remoteSync()} today={()=> '2026-07-30'}/></MemoryRouter>)
    expect(await screen.findByRole('button',{name:'金线'})).toBeInTheDocument()
    expect(screen.getByRole('combobox',{name:'船号'})).toHaveValue('v978')
    expect(screen.getByRole('alert')).toHaveTextContent('正在显示本机默认资料')
  })

  it('空鱼名主资料首次确认会等待默认鱼名建立，再保存每篮记录',async()=>{
    const store=createMemoryWeighingStore()
    let finishInitialization:(items:FishSpeciesRecord[])=>void=()=>{}
    const initialized=new Promise<FishSpeciesRecord[]>(resolve=>{finishInitialization=resolve})
    const speciesInitializer=vi.fn(()=>initialized)
    render(<MemoryRouter><WeighingEntryPage vesselLoader={async()=>vessels} speciesLoader={async()=>[]}
      speciesInitializer={speciesInitializer} openSessionLoader={async()=>null} closedSessionLoader={async()=>null} offlineStore={store} remoteSync={remoteSync()}
      today={()=> '2026-07-30'} now={()=> '2026-07-30T12:00:00.000+08:00'}
      idFactory={kind=>kind==='session'?'session-v978-20260730':`${kind}-1`}/></MemoryRouter>)

    const weight=await screen.findByLabelText('重量（kg）')
    fireEvent.change(weight,{target:{value:'80.125'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await waitFor(()=>expect(speciesInitializer).toHaveBeenCalledTimes(2))
    finishInitialization(DEFAULT_FISH_SPECIES)

    await screen.findByText('已保存')
    expect((await store.getEntries('session-v978-20260730'))[0]).toMatchObject({
      fishSpeciesId:'jin_xian',displayNameSnapshot:'金线',weightGrams:80125,
    })
  })

  it('鱼头采购不显示鱼名下拉、key-in 或现场价钱，并可把自定义鱼名保存到当前单',async()=>{
    const store=createMemoryWeighingStore()
    render(<MemoryRouter><WeighingEntryPage fixedProductType="fish_head" pageTitle="鱼头购入"
      vesselLoader={async()=>vessels} speciesLoader={async()=>DEFAULT_FISH_SPECIES} openSessionLoader={async()=>null} closedSessionLoader={async()=>null}
      offlineStore={store} remoteSync={remoteSync()} today={()=> '2026-07-30'} now={()=> '2026-07-30T12:00:00.000+08:00'}
      speciesCreator={async item=>item} idFactory={kind=>kind==='session'?'session-v978-20260730':`${kind}-1`}/></MemoryRouter>)
    expect(await screen.findByRole('heading',{name:'鱼头购入'})).toBeInTheDocument()
    expect(screen.queryByRole('group',{name:'产品类型'})).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox',{name:'鱼名'})).not.toBeInTheDocument()
    expect(within(screen.getByRole('group',{name:'鱼名'})).getAllByRole('button')).toHaveLength(17)
    fireEvent.click(screen.getByRole('button',{name:'其他'}))
    fireEvent.change(screen.getByLabelText('自定义鱼名'),{target:{value:'特别鱼'}})
    fireEvent.click(screen.getByRole('button',{name:'建立并选择'}))
    expect(await screen.findByRole('button',{name:'特别鱼'})).toHaveAttribute('aria-pressed','true')
    expect(screen.queryByText(/单价|金额|RM/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:'2.5'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await screen.findByText('已保存')
    expect((await store.getEntries('session-v978-20260730'))[0]).toMatchObject({weighingDate:'30/07/2026',monthKey:'07/2026',vesselId:'v978',vesselCodeSnapshot:'978',displayNameSnapshot:'特别鱼',weightGrams:2500})
    expect((await store.getEntries('session-v978-20260730'))[0]).not.toHaveProperty('unitPriceCentsPerKg')
  })

  it('鱼仔逐篮和总重不保存价钱，也不会为总重制造虚假篮数',async()=>{
    const store=createMemoryWeighingStore()
    render(<MemoryRouter><WeighingEntryPage fixedProductType="fish_meal" pageTitle="鱼仔购入"
      vesselLoader={async()=>vessels} speciesLoader={async()=>DEFAULT_FISH_SPECIES} openSessionLoader={async()=>null} closedSessionLoader={async()=>null}
      offlineStore={store} remoteSync={remoteSync()} today={()=> '2026-07-30'} now={()=> '2026-07-30T12:00:00.000+08:00'}
      idFactory={kind=>kind==='session'?'session-v978-20260730':`${kind}-${Math.random()}`}/></MemoryRouter>)
    await screen.findByRole('heading',{name:'鱼仔购入'})
    fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:'10'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await screen.findByText('已保存')
    fireEvent.click(screen.getByRole('button',{name:'包鱼仔'}))
    fireEvent.click(screen.getByRole('button',{name:'总重量'}))
    fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:'48'}})
    fireEvent.change(screen.getByLabelText('备注'),{target:{value:'总共48包'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await waitFor(async()=>expect(await store.getEntries('session-v978-20260730')).toHaveLength(2))
    expect(await store.getEntries('session-v978-20260730')).toEqual(expect.arrayContaining([
      expect.objectContaining({fishMealQuality:'bucket',entryMode:'individual',sequenceNo:1}),
      expect.objectContaining({fishMealQuality:'bag',entryMode:'total',sequenceNo:null,weightGrams:48000,remark:'总共48包'}),
    ]))
    expect(screen.getByText('1 篮')).toBeInTheDocument()
  })

  it('在鱼头重量下显示十进制 keypad，并以相同确认逻辑保存 grams',async()=>{
    const {store}=setup()
    await screen.findByLabelText('重量（kg）')
    for(const label of ['8','0','.','5'])fireEvent.click(screen.getByRole('button',{name:label}))
    expect(screen.getByLabelText('重量（kg）')).toHaveValue('80.5')
    fireEvent.click(screen.getByRole('button',{name:'.'}))
    expect(screen.getByLabelText('重量（kg）')).toHaveValue('80.5')
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await screen.findByText('已保存')
    expect((await store.getEntries('session-v978-20260730'))[0]).toMatchObject({weightGrams:80500})
    expect(screen.getByLabelText('重量（kg）')).toHaveValue('')
  })

  it('鱼仔逐篮和总重量都保留同一组十进制 keypad',async()=>{
    setup()
    await screen.findByLabelText('重量（kg）')
    fireEvent.click(screen.getByRole('button',{name:'鱼仔'}))
    const keypad=screen.getByRole('group',{name:'重量数字键盘'})
    for(const label of ['0','1','2','3','4','5','6','7','8','9','.','⌫','清空','确认加入']){
      expect(within(keypad).getByRole('button',{name:label})).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('button',{name:'总重量'}))
    expect(screen.getByRole('group',{name:'重量数字键盘'})).toBeInTheDocument()
  })

  it('非法重量保留在输入框并显示中文错误',async()=>{
    setup()
    const weight=await screen.findByLabelText('重量（kg）')
    fireEvent.change(weight,{target:{value:'80.1234'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('最多三位小数')
    expect(weight).toHaveValue('80.1234')
  })

  it('现场汇总只显示鱼名、重量和篮数，不显示价钱或金额',async()=>{
    setup()
    fireEvent.change(await screen.findByLabelText('重量（kg）'),{target:{value:'80.125'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await screen.findByText('已保存')
    const summary=screen.getByRole('region',{name:'现场汇总'})
    expect(summary).toHaveTextContent('金线')
    expect(summary).toHaveTextContent('80.125 kg')
    expect(summary).toHaveTextContent('1 篮')
    expect(summary).not.toHaveTextContent(/RM|单价|金额/)
  })
})

function remoteSync(){
  return vi.fn(async(operation:PendingWeighingOperation)=>{
    const payload=operation.payload as {session:WeighingSession;entry:WeighingEntry}
    if(operation.type==='entry_create')return {session:applyEntryCreated(payload.session,payload.entry),entry:payload.entry}
    if(operation.type==='complete')return {session:{...payload.session,status:'completed' as const}}
    return {}
  })
}
