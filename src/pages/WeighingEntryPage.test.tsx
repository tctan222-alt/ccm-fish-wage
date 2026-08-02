import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import { MemoryRouter,Route,Routes,useLocation } from 'react-router-dom'
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
  it('主资料读取仍在等待时也立即显示可操作的默认船号',async()=>{
    const never=()=>new Promise<typeof vessels>(()=>{})
    render(<MemoryRouter><WeighingEntryPage
      vesselLoader={never} speciesLoader={async()=>DEFAULT_FISH_SPECIES} openSessionLoader={async()=>null}
      closedSessionLoader={async()=>null} offlineStore={createMemoryWeighingStore()} remoteSync={remoteSync()}
      today={()=> '2026-07-30'}/></MemoryRouter>)
    const vesselField=screen.getByRole('combobox',{name:'船号'})
    expect(vesselField).toHaveValue('')
    expect(screen.getByRole('option',{name:'978'})).toBeInTheDocument()
    fireEvent.change(vesselField,{target:{value:'833'}})
    expect(vesselField).toHaveValue('833')
  })

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
    expect(screen.queryByRole('region',{name:'现场汇总'})).not.toBeInTheDocument()
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
    expect(screen.getAllByText('1 篮').length).toBeGreaterThan(0)
    expect((await store.getEntries('session-v978-20260730'))).toEqual([expect.not.objectContaining({receiptNoSnapshot:expect.any(String)})])
  })

  it('鱼头单号可以留空；有船号、鱼名和合法重量时仍会保存，并且不伪造正式单号快照',async()=>{
    const {store}=setup()
    const slip=await screen.findByLabelText('鱼头单号')
    expect(slip).toHaveValue('')
    fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:'80.5'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))

    await screen.findByText('已保存')
    expect(await store.getSession('session-v978-20260730')).toMatchObject({externalSlipNo:''})
    expect((await store.getEntries('session-v978-20260730'))[0]).not.toHaveProperty('receiptNoSnapshot')
  })

  it('切换船号后鱼头单号仍可输入，且会在下一篮保存到该草稿单',async()=>{
    const {store}=setup()
    await screen.findByLabelText('重量（kg）')
    fireEvent.change(screen.getByRole('combobox',{name:'船号'}),{target:{value:'v833'}})
    const slip=screen.getByLabelText('鱼头单号')
    await waitFor(()=>expect(slip).not.toBeDisabled())
    fireEvent.change(slip,{target:{value:'FH-833-A'}})
    fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:'60'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))

    await screen.findByText('已保存')
    expect(await store.getSession('session-v978-20260730')).toMatchObject({vesselId:'v833',externalSlipNo:'FH-833-A'})
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
    const firstSummary=screen.getByRole('region',{name:'现场汇总'})
    expect(firstSummary).toHaveTextContent('80 kg')
    expect(within(firstSummary).getByRole('columnheader',{name:'鱼名'})).toBeInTheDocument()
    expect(within(firstSummary).getByRole('columnheader',{name:'总重量'})).toBeInTheDocument()
    expect(within(firstSummary).getByRole('columnheader',{name:'篮子数'})).toBeInTheDocument()
    expect(within(firstSummary).getByRole('rowheader',{name:'金线'})).toBeInTheDocument()
    expect(within(firstSummary).getByText('1 篮')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox',{name:'船号'}),{target:{value:'v833'}})
    await waitFor(()=>expect(screen.queryByRole('region',{name:'现场汇总'})).not.toBeInTheDocument())
    await waitFor(()=>expect(screen.getByLabelText('重量（kg）')).not.toBeDisabled())
    fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:'60'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await waitFor(async()=>expect(await store.getEntries('session-2')).toHaveLength(1))
    expect(screen.getByRole('region',{name:'现场汇总'})).toHaveTextContent('60 kg')

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
    fireEvent.click(screen.getByRole('button',{name:'桶鱼仔'}))
    fireEvent.change(weight,{target:{value:'10'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await screen.findByText('已保存')
    fireEvent.change(screen.getByRole('combobox',{name:'船号'}),{target:{value:'v833'}})
    await waitFor(()=>expect(screen.getByLabelText('重量（kg）')).not.toBeDisabled())
    expect(screen.queryByRole('region',{name:'现场汇总'})).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:'20'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await waitFor(async()=>expect(await store.getEntries('meal-session-2')).toHaveLength(1))
    expect(screen.getByRole('region',{name:'现场汇总'})).toHaveTextContent('20 kg')
    fireEvent.change(screen.getByRole('combobox',{name:'船号'}),{target:{value:'v978'}})
    await waitFor(()=>expect(screen.getByRole('region',{name:'现场汇总'})).toHaveTextContent('10 kg'))
    expect(await store.getSession('meal-session-1')).toMatchObject({productType:'fish_meal',vesselId:'v978',sessionCode:'FM-978-30072026-01'})
  })

  it('鱼头 Summary 以鱼种代码分组，即使历史显示名相同也保留两行',async()=>{
    const store=createMemoryWeighingStore()
    const species=DEFAULT_FISH_SPECIES.map(item=>item.speciesCode==='lai_ge'?{...item,displayName:'金线'}:item)
    let entryNo=0
    render(<MemoryRouter><WeighingEntryPage fixedProductType="fish_head" pageTitle="鱼头购入"
      vesselLoader={async()=>vessels} speciesLoader={async()=>species} openSessionLoader={async()=>null} closedSessionLoader={async()=>null}
      offlineStore={store} remoteSync={remoteSync()} today={()=> '2026-07-30'} now={()=> '2026-07-30T12:00:00.000+08:00'}
      idFactory={kind=>kind==='session'?'same-name-session':`same-name-entry-${++entryNo}`}/></MemoryRouter>)

    const weight=await screen.findByLabelText('重量（kg）')
    fireEvent.change(weight,{target:{value:'80'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await screen.findByText('已保存')
    const speciesButtons=within(screen.getByRole('group',{name:'鱼名'})).getAllByRole('button',{name:'金线'})
    fireEvent.click(speciesButtons[1])
    await waitFor(()=>expect(speciesButtons[1]).toHaveAttribute('aria-pressed','true'))
    fireEvent.change(weight,{target:{value:'60'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await waitFor(async()=>expect(await store.getEntries('same-name-session')).toHaveLength(2))

    const summary=screen.getByRole('region',{name:'现场汇总'})
    expect(within(summary).getAllByRole('rowheader',{name:'金线'})).toHaveLength(2)
    expect(within(summary).getByText('80 kg')).toBeInTheDocument()
    expect(within(summary).getByText('60 kg')).toBeInTheDocument()
  })

  it('当前船所有称重记录作废后完全隐藏鱼头 Summary',async()=>{
    setup()
    const weight=await screen.findByLabelText('重量（kg）')
    fireEvent.change(weight,{target:{value:'80'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await screen.findByText('已保存')
    expect(screen.getByRole('region',{name:'现场汇总'})).toBeInTheDocument()

    const history=screen.getByRole('heading',{name:'完整历史记录'}).closest('section')!
    fireEvent.click(within(history).getByRole('button',{name:/第 1 篮.*金线/}))
    fireEvent.change(screen.getByLabelText('作废原因'),{target:{value:'输入错误'}})
    fireEvent.click(screen.getByRole('button',{name:'作废'}))

    await waitFor(()=>expect(screen.queryByRole('region',{name:'现场汇总'})).not.toBeInTheDocument())
  })

  it('编辑既有现场单时锁定上下文，避免把原单 Summary 显示到另一艘船',async()=>{
    const loadedSession=newWeighingSession({id:'loaded-session',productType:'fish_head',vesselId:'v978',vesselCodeSnapshot:'978',vesselNameSnapshot:'978',weighingDate:'2026-07-30'})
    const loadedEntry:WeighingEntry={
      id:'loaded-entry',clientEntryId:'loaded-entry',sessionId:'loaded-session',productType:'fish_head',fishSpeciesId:'jin_xian',
      fishSpeciesCodeSnapshot:'jin_xian',fishSpeciesNameSnapshot:'金线',fishMealQuality:null,displayNameSnapshot:'金线',entryMode:'individual',
      sequenceNo:1,weightGrams:80_000,remark:'',recordedAtClient:'2026-07-30T12:00:00.000+08:00',recordedAt:null,recordedBy:'u1',
      syncStatus:'synced',voided:false,voidReason:null,revision:1,
    }
    render(<MemoryRouter initialEntries={['/weighing/loaded-session']}><Routes><Route path="/weighing/:sessionId" element={<WeighingEntryPage
      fixedProductType="fish_head" pageTitle="鱼头购入" vesselLoader={async()=>vessels} speciesLoader={async()=>DEFAULT_FISH_SPECIES}
      bundleLoader={async()=>({session:loadedSession,entries:[loadedEntry]})} offlineStore={createMemoryWeighingStore()} remoteSync={remoteSync()}
      today={()=> '2026-07-30'} now={()=> '2026-07-30T12:00:00.000+08:00'}/>} /></Routes></MemoryRouter>)

    expect(await screen.findByRole('region',{name:'现场汇总'})).toHaveTextContent('80 kg')
    expect(screen.getByRole('combobox',{name:'船号'})).toBeDisabled()
    expect(screen.getByLabelText('日期')).toBeDisabled()
    expect(screen.getAllByText('80 kg').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1 篮').length).toBeGreaterThan(0)
  })

  it('鱼仔单号可以留空；未选桶鱼仔或包鱼仔时阻止保存，选择后会保存而不写正式单号快照',async()=>{
    const store=createMemoryWeighingStore()
    render(<MemoryRouter><WeighingEntryPage fixedProductType="fish_meal" pageTitle="鱼仔购入"
      vesselLoader={async()=>vessels} speciesLoader={async()=>DEFAULT_FISH_SPECIES} openSessionLoader={async()=>null} closedSessionLoader={async()=>null}
      offlineStore={store} remoteSync={remoteSync()} today={()=> '2026-07-30'} now={()=> '2026-07-30T12:00:00.000+08:00'}
      idFactory={kind=>kind==='session'?'meal-session-optional-slip':`${kind}-optional-slip`}/></MemoryRouter>)
    const slip=await screen.findByLabelText('鱼仔单号')
    expect(slip).toHaveValue('')
    fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:'10'}})
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('请选择桶鱼仔或包鱼仔')
    expect(screen.getByLabelText('重量（kg）')).toHaveValue('10')

    fireEvent.click(screen.getByRole('button',{name:'包鱼仔'}))
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await screen.findByText('已保存')
    expect(await store.getSession('meal-session-optional-slip')).toMatchObject({externalSlipNo:'',productType:'fish_meal'})
    expect((await store.getEntries('meal-session-optional-slip'))[0]).not.toHaveProperty('receiptNoSnapshot')
  })

  it('切换船号后鱼仔单号、品质和重量键盘仍可继续使用',async()=>{
    const store=createMemoryWeighingStore()
    render(<MemoryRouter><WeighingEntryPage fixedProductType="fish_meal" pageTitle="鱼仔购入"
      vesselLoader={async()=>vessels} speciesLoader={async()=>DEFAULT_FISH_SPECIES} openSessionLoader={async()=>null} closedSessionLoader={async()=>null}
      offlineStore={store} remoteSync={remoteSync()} today={()=> '2026-07-30'} now={()=> '2026-07-30T12:00:00.000+08:00'}
      idFactory={kind=>kind==='session'?'meal-session-switch':`${kind}-meal-switch`}/></MemoryRouter>)
    await screen.findByLabelText('重量（kg）')
    fireEvent.change(screen.getByRole('combobox',{name:'船号'}),{target:{value:'v833'}})
    const slip=screen.getByLabelText('鱼仔单号')
    await waitFor(()=>expect(slip).not.toBeDisabled())
    fireEvent.change(slip,{target:{value:'FM-833-A'}})
    fireEvent.click(screen.getByRole('button',{name:'桶鱼仔'}))
    fireEvent.click(screen.getByRole('button',{name:'8'}))
    expect(screen.getByLabelText('重量（kg）')).toHaveValue('8')
    fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
    await screen.findByText('已保存')
    expect(await store.getSession('meal-session-switch')).toMatchObject({vesselId:'v833',externalSlipNo:'FM-833-A'})
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
    await waitFor(()=>expect(screen.getByRole('combobox',{name:'船号'})).toHaveValue('v978'))
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
    fireEvent.click(screen.getByRole('button',{name:'桶鱼仔'}))
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
    expect(screen.getAllByText('1 篮').length).toBeGreaterThan(0)
    const summary=screen.getByRole('region',{name:'现场汇总'})
    expect(within(summary).getByRole('columnheader',{name:'品质'})).toBeInTheDocument()
    expect(within(summary).getByRole('columnheader',{name:'篮子数 / 总重记录'})).toBeInTheDocument()
    expect(within(summary).getByRole('rowheader',{name:'桶鱼仔'})).toBeInTheDocument()
    expect(within(summary).getByRole('rowheader',{name:'包鱼仔'})).toBeInTheDocument()
    expect(within(summary).getByText('总重 1 条')).toBeInTheDocument()
    expect(summary).not.toHaveTextContent('0 篮')
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
