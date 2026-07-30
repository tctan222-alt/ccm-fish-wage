import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import { MemoryRouter,useLocation } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { applyEntryCreated,DEFAULT_FISH_SPECIES,type WeighingEntry,type WeighingSession } from '../lib/weighing'
import { createMemoryWeighingStore,type PendingWeighingOperation } from '../services/weighingOffline'
import { WeighingEntryPage } from './WeighingEntryPage'

const vessels=[
  {id:'v978',vesselCode:'978',displayName:'978',defaultSupplierId:'',defaultSupplierNameSnapshot:'',active:true,notes:''},
  {id:'v833',vesselCode:'833',displayName:'833',defaultSupplierId:'',defaultSupplierNameSnapshot:'',active:true,notes:''},
]

afterEach(()=>{cleanup();vi.clearAllMocks()})

function Location(){return <output aria-label="route">{useLocation().pathname}</output>}
function setup(sync=remoteSync()){
  const store=createMemoryWeighingStore()
  render(<MemoryRouter initialEntries={['/weighing/new']}><Location/><WeighingEntryPage
    vesselLoader={async()=>vessels}
    speciesLoader={async()=>DEFAULT_FISH_SPECIES}
    openSessionLoader={async()=>null}
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
    expect(screen.getByLabelText('船号')).toHaveValue('v978')
    expect(screen.getByText('30/07/2026')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'鱼头'})).toHaveAttribute('aria-pressed','true')
    const species=screen.getByRole('group',{name:'鱼名'})
    expect(within(species).getAllByRole('button')).toHaveLength(16)
    expect(within(species).getByRole('button',{name:'金线'})).toHaveAttribute('aria-pressed','true')
    expect(screen.getByLabelText('重量（kg）')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'确认'})).toBeInTheDocument()
    expect(screen.getByLabelText('route')).toHaveTextContent('/weighing/new')
    expect(document.body).not.toHaveTextContent('fish_head')
    expect(document.body).not.toHaveTextContent('jin_xian')
  })

  it('每篮先本地保存，成功后只清空 kg、保留鱼名并重新聚焦',async()=>{
    const {store}=setup()
    const weight=await screen.findByLabelText('重量（kg）')
    fireEvent.change(weight,{target:{value:'80'}})
    fireEvent.click(screen.getByRole('button',{name:'确认'}))

    expect(await screen.findByText('已保存')).toBeInTheDocument()
    expect(weight).toHaveValue('')
    expect(weight).toHaveFocus()
    expect(screen.getByRole('button',{name:'金线'})).toHaveAttribute('aria-pressed','true')
    expect(screen.getByText('最近一篮')).toBeInTheDocument()
    expect(screen.getAllByText('金线').length).toBeGreaterThan(1)
    expect(screen.getAllByText('80 kg').length).toBeGreaterThan(0)
    expect(screen.getByText('1 篮')).toBeInTheDocument()
    expect((await store.getEntries('session-v978-20260730'))).toHaveLength(1)
  })

  it('支持 Enter 确认，并让鱼仔总重保留品质及 remark 而不增加篮数',async()=>{
    const {store}=setup()
    await screen.findByLabelText('重量（kg）')
    fireEvent.click(screen.getByRole('button',{name:'鱼仔'}))
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
    const confirm=screen.getByRole('button',{name:'确认'})
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
    fireEvent.click(screen.getByRole('button',{name:'确认'}))
    await screen.findByText('已保存')
    fireEvent.click(screen.getByRole('button',{name:'完成称重'}))
    fireEvent.click(screen.getByRole('button',{name:'确认完成'}))
    await waitFor(()=>expect(screen.getByText('已完成，等待同步')).toBeInTheDocument())
    expect(screen.getByLabelText('重量（kg）')).toBeDisabled()
    expect(screen.getByRole('button',{name:'确认'})).toBeDisabled()
  })

  it('曾在线载入后，离线重开仍可使用缓存的船号和鱼名继续录入',async()=>{
    const shared=new Map<string,unknown>(),firstStore=createMemoryWeighingStore(shared)
    const first=render(<MemoryRouter><WeighingEntryPage vesselLoader={async()=>vessels}
      speciesLoader={async()=>DEFAULT_FISH_SPECIES} openSessionLoader={async()=>null}
      offlineStore={firstStore} remoteSync={remoteSync()} today={()=> '2026-07-30'}/></MemoryRouter>)
    expect(await screen.findByRole('button',{name:'金线'})).toBeInTheDocument()
    await waitFor(()=>expect(firstStore.getMeta('reference:vessels')).resolves.toBeTruthy())
    first.unmount()

    render(<MemoryRouter><WeighingEntryPage vesselLoader={async()=>{throw new Error('offline')}}
      speciesLoader={async()=>{throw new Error('offline')}} openSessionLoader={async()=>null}
      offlineStore={createMemoryWeighingStore(shared)} remoteSync={remoteSync()} today={()=> '2026-07-30'}/></MemoryRouter>)
    expect(await screen.findByRole('button',{name:'金线'})).toBeInTheDocument()
    expect(screen.getByLabelText('船号')).toHaveValue('v978')
    expect(screen.getByText('目前离线，已使用本机船号和鱼名资料。')).toBeInTheDocument()
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
