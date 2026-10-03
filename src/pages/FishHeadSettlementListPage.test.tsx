import { act,cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import { MemoryRouter,Route,Routes,useLocation } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import type { WeighingEntry,WeighingSession } from '../lib/weighing'
import type { Vessel } from '../lib/purchasing'
import { FishHeadSettlementListPage } from './FishHeadSettlementListPage'
import { PurchaseSettlementPage } from './PurchaseSettlementPage'

const baseSession:WeighingSession={
  id:'head-833-a',sessionCode:'FH-833-20261003-01',productType:'fish_head',
  weighingDate:'03/10/2026',monthKey:'10/2026',dateSortKey:20261003,monthSortKey:202610,
  externalSlipNo:'SLIP-833-A',vesselId:'v833',vesselCodeSnapshot:'833',vesselNameSnapshot:'833',
  status:'completed',lastSequenceNo:2,fishHeadBasketCount:2,fishHeadWeightGrams:160500,
  fishMealBucketBasketCount:0,fishMealBucketWeightGrams:0,fishMealBagBasketCount:0,
  fishMealBagWeightGrams:0,fishMealTotalWeightGrams:0,totalWeightGrams:160500,
  processedReceiptId:null,processedReceiptCode:null,notes:'',revision:3,voidReason:null,
  createdAt:new Date('2026-10-03T01:00:00Z'),updatedAt:new Date('2026-10-03T02:00:00Z'),
  completedAt:new Date('2026-10-03T02:00:00Z'),
}
const makeSession=(overrides:Partial<WeighingSession>={}):WeighingSession=>({...baseSession,...overrides})
const card=(session:WeighingSession)=>screen.getByRole('article',{name:`现场单 ${session.sessionCode}`})
const vessel:Vessel={id:'v833',vesselCode:'833',displayName:'833',defaultSupplierId:'',defaultSupplierNameSnapshot:'',active:true,order:0,notes:''}

function deferred<T>(){
  let resolve!:(value:T)=>void
  let reject!:(reason:unknown)=>void
  const promise=new Promise<T>((resolvePromise,rejectPromise)=>{resolve=resolvePromise;reject=rejectPromise})
  return {promise,resolve,reject}
}

function renderList(loader:()=>Promise<WeighingSession[]>){
  return render(<MemoryRouter><FishHeadSettlementListPage loader={loader}/></MemoryRouter>)
}

function LocationProbe(){
  const location=useLocation()
  return <p data-testid="current-path">{location.pathname}</p>
}

function detailEntry(session:WeighingSession):WeighingEntry{
  return {
    id:`entry-${session.id}`,clientEntryId:`entry-${session.id}`,sessionId:session.id,
    weighingDate:session.weighingDate,businessDate:session.weighingDate,monthKey:session.monthKey,
    dateSortKey:session.dateSortKey,monthSortKey:session.monthSortKey,
    vesselId:session.vesselId,vesselCodeSnapshot:session.vesselCodeSnapshot,productType:'fish_head',
    fishSpeciesId:'jin_xian',fishSpeciesCodeSnapshot:'jin_xian',fishSpeciesNameSnapshot:'金线',
    fishMealQuality:null,displayNameSnapshot:'金线',entryMode:'individual',sequenceNo:1,
    weightGrams:160500,remark:'',recordedAtClient:'2026-10-03T10:00:00+08:00',
    recordedAt:'2026-10-03T10:00:00+08:00',recordedBy:'u1',syncStatus:'synced',
    voided:false,voidReason:null,revision:1,
  }
}

function renderListWithDetail(items:WeighingSession[],initialPath='/fish-head-settlement'){
  const bundleLoader=vi.fn(async(sessionId:string)=>{
    const selected=items.find(item=>item.id===sessionId)
    if(!selected)throw new Error('没有这张现场单。')
    return {session:selected,entries:[detailEntry(selected)]}
  })
  const sourceLoader=vi.fn(async()=>({session:items[0],bundle:{session:items[0],entries:[detailEntry(items[0])]}}))
  const draftLoader=vi.fn(async()=>null)
  const draftSaver=vi.fn(async draft=>draft)
  render(<MemoryRouter initialEntries={[initialPath]}><LocationProbe/><Routes>
    <Route path="/fish-head-settlement" element={<FishHeadSettlementListPage loader={async()=>items}/>}/>
    <Route path="/fish-head-settlement/:sessionId" element={<PurchaseSettlementPage productType="fish_head"
      vesselLoader={async()=>[vessel]} bundleLoader={bundleLoader} sourceLoader={sourceLoader}
      draftLoader={draftLoader} draftSaver={draftSaver} today={()=>'03/10/2026'}
      now={()=>new Date('2026-10-04T00:00:00Z')}/>}/>
    <Route path="/weighing/:sessionId" element={<p>Existing weighing session</p>}/>
  </Routes></MemoryRouter>)
  return {bundleLoader,sourceLoader,draftLoader,draftSaver}
}

afterEach(()=>{cleanup();vi.restoreAllMocks()})

describe('Fish Head Settlement session list',()=>{
  it('shows a completed fish-head session as pending with its date, weekday and source snapshots',async()=>{
    const loader=vi.fn(async()=>[baseSession])
    renderList(loader)
    const item=await screen.findByRole('article',{name:`现场单 ${baseSession.sessionCode}`})
    expect(loader).toHaveBeenCalledTimes(1)
    expect(item).toHaveTextContent('03/10/2026')
    expect(item).toHaveTextContent(/星期六|Sat/)
    expect(item).toHaveTextContent('833')
    expect(item).toHaveTextContent('SLIP-833-A')
    expect(item).toHaveTextContent(baseSession.sessionCode)
    expect(item).toHaveTextContent('2 篮')
    expect(item).toHaveTextContent('160.5 kg')
    expect(within(item).getByText('待结单')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('待结单 1 张')
    expect(within(item).getByRole('link',{name:'查看结单'})).toHaveAttribute('href','/fish-head-settlement/head-833-a')
    expect(screen.queryByLabelText('日期')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('船号')).not.toBeInTheDocument()
  })

  it('shows weighing and processed sessions with their distinct existing-session actions',async()=>{
    const weighing=makeSession({id:'weighing',sessionCode:'FH-WEIGHING',status:'weighing',completedAt:null})
    const processed=makeSession({id:'processed',sessionCode:'FH-PROCESSED',status:'processed',processedReceiptId:'receipt-1'})
    renderList(async()=>[weighing,processed])
    await screen.findByRole('article',{name:'现场单 FH-WEIGHING'})
    expect(within(card(weighing)).getByText('称重中')).toBeInTheDocument()
    expect(within(card(weighing)).getByRole('link',{name:'继续称重'})).toHaveAttribute('href','/weighing/weighing')
    expect(within(card(processed)).getByText('已结单')).toBeInTheDocument()
    expect(within(card(processed)).getByRole('link',{name:'查看结单'})).toHaveAttribute('href','/fish-head-settlement/processed')
    expect(within(card(processed)).queryByRole('link',{name:'继续称重'})).not.toBeInTheDocument()
  })

  it('excludes voided, fish-meal and untyped sessions by default',async()=>{
    const voided=makeSession({id:'voided',sessionCode:'FH-VOID',status:'voided'})
    const meal=makeSession({id:'meal',sessionCode:'FM-833',productType:'fish_meal'})
    const untyped=makeSession({id:'legacy-untyped',sessionCode:'LEGACY-UNTYPED',productType:undefined})
    renderList(async()=>[voided,meal,untyped,baseSession])
    await screen.findByRole('article',{name:`现场单 ${baseSession.sessionCode}`})
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.queryByText('FH-VOID')).not.toBeInTheDocument()
    expect(screen.queryByText('FM-833')).not.toBeInTheDocument()
    expect(screen.queryByText('LEGACY-UNTYPED')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('待结单 1 张')
  })

  it('sorts by newest business date before update time',async()=>{
    const older=makeSession({id:'older',sessionCode:'FH-OLD',weighingDate:'02/10/2026',dateSortKey:20261002,updatedAt:new Date('2026-10-04T02:00:00Z')})
    const newer=makeSession({id:'newer',sessionCode:'FH-NEW',weighingDate:'03/10/2026',dateSortKey:20261003,updatedAt:new Date('2026-10-03T00:00:00Z')})
    renderList(async()=>[older,newer])
    await screen.findByRole('article',{name:'现场单 FH-NEW'})
    expect(screen.getAllByRole('article').map(item=>item.getAttribute('aria-label'))).toEqual(['现场单 FH-NEW','现场单 FH-OLD'])
  })

  it('uses Firestore update timestamps and falls back to creation time for same-day ordering',async()=>{
    const earliest=makeSession({id:'early',sessionCode:'FH-EARLY',updatedAt:{toMillis:()=>Date.parse('2026-10-03T00:00:00Z')}})
    const latest=makeSession({id:'latest',sessionCode:'FH-LATEST',updatedAt:{toDate:()=>new Date('2026-10-03T05:00:00Z')}})
    const createdOnly=makeSession({id:'created-only',sessionCode:'FH-CREATED',updatedAt:undefined,createdAt:{seconds:Date.parse('2026-10-03T03:00:00Z')/1000}})
    renderList(async()=>[earliest,createdOnly,latest])
    await screen.findByRole('article',{name:'现场单 FH-LATEST'})
    expect(screen.getAllByRole('article').map(item=>item.getAttribute('aria-label'))).toEqual(['现场单 FH-LATEST','现场单 FH-CREATED','现场单 FH-EARLY'])
  })

  it('keeps two sessions from the same vessel and business date as separate navigation identities',async()=>{
    const second=makeSession({id:'head-833-b',sessionCode:'FH-833-20261003-02',externalSlipNo:'SLIP-833-B'})
    renderList(async()=>[baseSession,second])
    await screen.findByRole('article',{name:`现场单 ${baseSession.sessionCode}`})
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.getByRole('status')).toHaveTextContent('待结单 2 张')
    expect(within(card(baseSession)).getByRole('link',{name:'查看结单'})).toHaveAttribute('href','/fish-head-settlement/head-833-a')
    expect(within(card(second)).getByRole('link',{name:'查看结单'})).toHaveAttribute('href','/fish-head-settlement/head-833-b')
  })

  it('shows missing handwritten slip fallback and tolerates absent legacy timestamps',async()=>{
    const legacy=makeSession({externalSlipNo:'',weighingDate:'2026-10-03',dateSortKey:undefined,updatedAt:undefined,createdAt:undefined})
    renderList(async()=>[legacy])
    const item=await screen.findByRole('article',{name:`现场单 ${legacy.sessionCode}`})
    expect(item).toHaveTextContent('没有手写单号')
    expect(item).toHaveTextContent('03/10/2026')
    expect(item).toHaveTextContent(/星期六|Sat/)
    expect(within(item).getByRole('link',{name:'查看结单'})).toHaveAttribute('href',`/fish-head-settlement/${legacy.id}`)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows loading until the initial session query resolves',async()=>{
    const pending=deferred<WeighingSession[]>()
    renderList(()=>pending.promise)
    expect(screen.getByRole('status')).toHaveTextContent('正在载入鱼头现场单…')
    expect(screen.queryByText('目前没有待结单鱼头现场单。')).not.toBeInTheDocument()
    await act(async()=>pending.resolve([baseSession]))
    expect(card(baseSession)).toBeInTheDocument()
    expect(screen.queryByText('正在载入鱼头现场单…')).not.toBeInTheDocument()
  })

  it('shows the explicit empty state after a successful empty query',async()=>{
    renderList(async()=>[])
    expect(await screen.findByText('目前没有待结单鱼头现场单。')).toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('正在载入鱼头现场单…')).not.toBeInTheDocument()
  })

  it('shows no pending-settlement message without hiding weighing or processed history',async()=>{
    const weighing=makeSession({id:'weighing-only',sessionCode:'FH-WEIGHING-ONLY',status:'weighing',completedAt:null})
    const processed=makeSession({id:'processed-only',sessionCode:'FH-PROCESSED-ONLY',status:'processed'})
    renderList(async()=>[weighing,processed])
    expect(await screen.findByText('目前没有待结单鱼头现场单。')).toBeInTheDocument()
    expect(card(weighing)).toBeInTheDocument()
    expect(card(processed)).toBeInTheDocument()
  })

  it('shows a load error instead of a misleading empty state and retry loads records',async()=>{
    const loader=vi.fn<()=>Promise<WeighingSession[]>>()
      .mockRejectedValueOnce(new Error('permission-denied'))
      .mockResolvedValueOnce([baseSession])
    renderList(loader)
    expect(await screen.findByRole('alert')).toHaveTextContent(/无法|失败|permission-denied/)
    expect(screen.queryByText('目前没有待结单鱼头现场单。')).not.toBeInTheDocument()
    expect(screen.queryByText('正在载入鱼头现场单…')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'重试'}))
    await screen.findByRole('article',{name:`现场单 ${baseSession.sessionCode}`})
    expect(loader).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('refreshes the same mounted list after a weighing session completes',async()=>{
    const weighing=makeSession({status:'weighing',completedAt:null})
    const loader=vi.fn<()=>Promise<WeighingSession[]>>()
      .mockResolvedValueOnce([weighing]).mockResolvedValueOnce([baseSession])
    renderList(loader)
    await screen.findByRole('article',{name:`现场单 ${baseSession.sessionCode}`})
    expect(within(card(baseSession)).getByText('称重中')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'刷新'}))
    await waitFor(()=>expect(within(card(baseSession)).getByText('待结单')).toBeInTheDocument())
    expect(loader).toHaveBeenCalledTimes(2)
    expect(within(card(baseSession)).getByRole('link',{name:'查看结单'})).toHaveAttribute('href',`/fish-head-settlement/${baseSession.id}`)
  })

  it('queries again on returning to the list and immediately shows the newly completed session',async()=>{
    const weighing=makeSession({status:'weighing',completedAt:null})
    const loader=vi.fn<()=>Promise<WeighingSession[]>>()
      .mockResolvedValueOnce([weighing]).mockResolvedValueOnce([baseSession])
    const first=renderList(loader)
    await screen.findByRole('article',{name:`现场单 ${baseSession.sessionCode}`})
    first.unmount()
    renderList(loader)
    const item=await screen.findByRole('article',{name:`现场单 ${baseSession.sessionCode}`})
    expect(within(item).getByText('待结单')).toBeInTheDocument()
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('ignores a stale query result after the loader changes',async()=>{
    const oldRequest=deferred<WeighingSession[]>()
    const old=makeSession({id:'old',sessionCode:'FH-STALE'})
    const current=makeSession({id:'current',sessionCode:'FH-CURRENT'})
    const firstLoader=()=>oldRequest.promise
    const currentLoader=async()=>[current]
    const result=renderList(firstLoader)
    result.rerender(<MemoryRouter><FishHeadSettlementListPage loader={currentLoader}/></MemoryRouter>)
    await screen.findByRole('article',{name:'现场单 FH-CURRENT'})
    await act(async()=>oldRequest.resolve([old]))
    expect(card(current)).toBeInTheDocument()
    expect(screen.queryByText('FH-STALE')).not.toBeInTheDocument()
  })

  it('ignores a stale query error after a replacement query has succeeded',async()=>{
    const oldRequest=deferred<WeighingSession[]>()
    const result=renderList(()=>oldRequest.promise)
    const currentLoader=async()=>[baseSession]
    result.rerender(<MemoryRouter><FishHeadSettlementListPage loader={currentLoader}/></MemoryRouter>)
    await screen.findByRole('article',{name:`现场单 ${baseSession.sessionCode}`})
    await act(async()=>oldRequest.reject(new Error('old query failed')))
    expect(card(baseSession)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not revive a previous mount when its query settles after navigation away',async()=>{
    const oldRequest=deferred<WeighingSession[]>()
    const old=makeSession({id:'old-mount',sessionCode:'FH-OLD-MOUNT'})
    const first=renderList(()=>oldRequest.promise)
    first.unmount()
    renderList(async()=>[baseSession])
    await screen.findByRole('article',{name:`现场单 ${baseSession.sessionCode}`})
    await act(async()=>oldRequest.resolve([old]))
    expect(card(baseSession)).toBeInTheDocument()
    expect(screen.queryByText('FH-OLD-MOUNT')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Fish Head Settlement list to existing detail routes',()=>{
  it('opens the clicked same-vessel same-day session in the real existing settlement page',async()=>{
    const second=makeSession({id:'head-833-b',sessionCode:'FH-833-20261003-02',externalSlipNo:'SLIP-833-B'})
    const result=renderListWithDetail([baseSession,second])
    await screen.findByRole('article',{name:`现场单 ${second.sessionCode}`})
    fireEvent.click(within(card(second)).getByRole('link',{name:'查看结单'}))
    await screen.findByRole('table')
    expect(screen.getByTestId('current-path')).toHaveTextContent('/fish-head-settlement/head-833-b')
    expect(result.bundleLoader).toHaveBeenCalledWith('head-833-b')
    expect(result.sourceLoader).not.toHaveBeenCalled()
    expect(screen.getByLabelText('船号')).toBeDisabled()
    expect(screen.getByLabelText('日期')).toBeDisabled()
    expect(screen.getByLabelText('单号')).toHaveValue('SLIP-833-B')
    expect(screen.getByRole('link',{name:'修改称重（7 天内）'})).toHaveAttribute('href','/weighing/head-833-b/review')
    expect(result.draftSaver).not.toHaveBeenCalled()
  })

  it('continues weighing using the selected existing session ID',async()=>{
    const weighing=makeSession({id:'existing-weighing',sessionCode:'FH-EXISTING-WEIGHING',status:'weighing',completedAt:null})
    const result=renderListWithDetail([weighing])
    await screen.findByRole('article',{name:`现场单 ${weighing.sessionCode}`})
    fireEvent.click(within(card(weighing)).getByRole('link',{name:'继续称重'}))
    expect(await screen.findByText('Existing weighing session')).toBeInTheDocument()
    expect(screen.getByTestId('current-path')).toHaveTextContent('/weighing/existing-weighing')
    expect(result.bundleLoader).not.toHaveBeenCalled()
    expect(result.draftSaver).not.toHaveBeenCalled()
  })

  it('opens processed history through the real detail page while preserving its read-only controls',async()=>{
    const processed=makeSession({id:'processed',sessionCode:'FH-PROCESSED',status:'processed',processedReceiptId:'receipt-1'})
    const result=renderListWithDetail([processed])
    await screen.findByRole('article',{name:'现场单 FH-PROCESSED'})
    fireEvent.click(within(card(processed)).getByRole('link',{name:'查看结单'}))
    await screen.findByRole('table')
    expect(result.bundleLoader).toHaveBeenCalledWith('processed')
    expect(screen.getByLabelText('金线单价')).toBeDisabled()
    expect(screen.getByLabelText('单号')).toBeDisabled()
    expect(screen.getByRole('button',{name:'保存结单草稿'})).toBeDisabled()
    expect(screen.queryByRole('link',{name:'修改称重（7 天内）'})).not.toBeInTheDocument()
    expect(screen.getByText('本单已锁定或超过 7 天修改期，只能查看。')).toBeInTheDocument()
    expect(result.sourceLoader).not.toHaveBeenCalled()
    expect(result.draftSaver).not.toHaveBeenCalled()
  })

  it('continues to support a direct existing settlement URL without visiting the list',async()=>{
    const result=renderListWithDetail([baseSession],`/fish-head-settlement/${baseSession.id}`)
    await screen.findByRole('table')
    expect(result.bundleLoader).toHaveBeenCalledWith(baseSession.id)
    expect(result.sourceLoader).not.toHaveBeenCalled()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.getByLabelText('金线单价')).toBeEnabled()
    expect(screen.getByLabelText('日期')).toBeDisabled()
  })
})
