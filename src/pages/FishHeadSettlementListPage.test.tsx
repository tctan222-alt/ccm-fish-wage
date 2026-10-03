import { act,cleanup,fireEvent,render,screen,within } from '@testing-library/react'
import { MemoryRouter,Route,Routes,useLocation } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import type { WeighingEntry,WeighingSession } from '../lib/weighing'
import type { Vessel } from '../lib/purchasing'
import { SettlementListPage } from './SettlementListPage'
import { settlementSummaryFromSession,type SettlementPageLoader,type SettlementCursor,type SettlementSummary } from '../services/settlementSearch'
import { legacyIsoDateFromBusinessDate,businessDateFromLegacy } from '../lib/businessDate'
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

function LocationProbe(){
  const location=useLocation()
  return <p data-testid="current-path">{location.pathname}{location.search}</p>
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
    <Route path="/fish-head-settlement" element={<FishHeadSettlementListPage pageLoader={fixtureLoader(items)} vesselLoader={async()=>[vessel]} today={()=>"03/10/2026"}/>}/>
    <Route path="/fish-head-settlement/:sessionId" element={<PurchaseSettlementPage productType="fish_head"
      vesselLoader={async()=>[vessel]} bundleLoader={bundleLoader} sourceLoader={sourceLoader}
      draftLoader={draftLoader} draftSaver={draftSaver} today={()=>'03/10/2026'}
      now={()=>new Date('2026-10-04T00:00:00Z')}/>}/>
    <Route path="/weighing/:sessionId" element={<p>Existing weighing session</p>}/>
  </Routes></MemoryRouter>)
  return {bundleLoader,sourceLoader,draftLoader,draftSaver}
}

afterEach(()=>{cleanup();vi.restoreAllMocks()})

function fixtureLoader(items:WeighingSession[]):SettlementPageLoader {
  return async search=>({items:items.filter(item=>item.productType===search.productType&&item.status!=='voided'
    &&(search.status==='all'||item.status===search.status)&&(!search.vesselId||item.vesselId===search.vesselId)
    &&legacyIsoDateFromBusinessDate(businessDateFromLegacy(item.weighingDate))>=search.from&&legacyIsoDateFromBusinessDate(businessDateFromLegacy(item.weighingDate))<=search.to)
    .sort((a,b)=>b.weighingDate.localeCompare(a.weighingDate)).map(settlementSummaryFromSession),cursor:null})
}

describe.each(['fish_head','fish_meal'] as const)('%s shared date-first search',productType=>{
  const item=(overrides:Partial<SettlementSummary>={}):SettlementSummary=>({...settlementSummaryFromSession(baseSession),productType,totalAmountCents:963,referenceNumber:'REFERENCE-1',...overrides})
  const renderSearch=(pageLoader:SettlementPageLoader=async()=>({items:[item()],cursor:null}),path='/list')=>render(<MemoryRouter initialEntries={[path]}><LocationProbe/><SettlementListPage productType={productType} pageLoader={pageLoader} vesselLoader={async()=>[vessel,{...vessel,id:'old',vesselCode:'旧船',active:false}]} today={()=>'03/10/2026'}/></MemoryRouter>)
  const search=()=>fireEvent.click(screen.getByRole('button',{name:'查询 Search'}))
  const ready=async()=>(await screen.findAllByRole('article'))[0]
  it('defaults to the selected month-to-today and all vessels with product isolation',async()=>{
    const loader=vi.fn<SettlementPageLoader>(async()=>({items:[item()],cursor:null}))
    renderSearch(loader);await ready()
    expect(loader).toHaveBeenCalledWith({productType,from:'2026-10-01',to:'2026-10-03',vesselId:'',status:'all'},null,expect.any(AbortSignal))
    expect(screen.getByLabelText('船号 Vessel')).toHaveValue('')
  })
  it('queries Today only after Search; changing controls never creates a request storm',async()=>{
    const loader=vi.fn<SettlementPageLoader>(async()=>({items:[item()],cursor:null}));renderSearch(loader);await ready()
    fireEvent.click(screen.getByRole('button',{name:'今天 Today'}));expect(loader).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('article')).not.toBeInTheDocument();search();await ready()
    expect(loader.mock.calls.at(-1)?.[0]).toMatchObject({from:'2026-10-03',to:'2026-10-03'})
  })
  it('queries Monday-Sunday and supports previous and next weeks',async()=>{
    const loader=vi.fn<SettlementPageLoader>(async()=>({items:[item()],cursor:null}));renderSearch(loader);await ready()
    fireEvent.click(screen.getByRole('button',{name:'按周 Week'}));expect(screen.getByText('28/09/2026 – 04/10/2026')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'上一周'}));search();await ready();expect(loader.mock.calls.at(-1)?.[0]).toMatchObject({from:'2026-09-21',to:'2026-09-27'})
    fireEvent.click(screen.getByRole('button',{name:'下一周'}));search();await ready();expect(loader.mock.calls.at(-1)?.[0]).toMatchObject({from:'2026-09-28',to:'2026-10-04'})
  })
  it('queries inclusive custom ranges without requiring a vessel',async()=>{
    const loader=vi.fn<SettlementPageLoader>(async()=>({items:[item()],cursor:null}));renderSearch(loader);await ready()
    fireEvent.change(screen.getByLabelText('开始日期 Start Date'),{target:{value:'2026-09-20'}})
    fireEvent.change(screen.getByLabelText('结束日期 End Date'),{target:{value:'2026-09-20'}});search();await ready()
    expect(loader.mock.calls.at(-1)?.[0]).toMatchObject({from:'2026-09-20',to:'2026-09-20',vesselId:''})
  })
  it('rejects a reversed range without an additional query or empty state',async()=>{
    const loader=vi.fn<SettlementPageLoader>(async()=>({items:[item()],cursor:null}));renderSearch(loader);await ready()
    fireEvent.change(screen.getByLabelText('开始日期 Start Date'),{target:{value:'2026-10-04'}})
    expect(screen.getByRole('alert')).toHaveTextContent('开始日期不能晚于结束日期')
    expect(screen.getByRole('button',{name:'查询 Search'})).toBeDisabled();expect(loader).toHaveBeenCalledTimes(1)
  })
  it('rejects missing custom dates',async()=>{
    renderSearch();await ready();fireEvent.change(screen.getByLabelText('开始日期 Start Date'),{target:{value:''}})
    expect(screen.getByRole('alert')).toHaveTextContent('请选择开始日期和结束日期')
  })
  it('retains full months, December-January navigation and leap February',async()=>{
    const loader=vi.fn<SettlementPageLoader>(async()=>({items:[item()],cursor:null}));renderSearch(loader,'/list?mode=month&month=2026-12');await ready()
    fireEvent.click(screen.getByRole('button',{name:'下一月'}));search();await ready();expect(loader.mock.calls.at(-1)?.[0]).toMatchObject({from:'2027-01-01',to:'2027-01-31'})
    fireEvent.change(screen.getByLabelText('月份 Month'),{target:{value:'2028-02'}});search();await ready();expect(loader.mock.calls.at(-1)?.[0]).toMatchObject({to:'2028-02-29'})
  })
  it('uses an optional inactive historical vessel and status as server criteria',async()=>{
    const loader=vi.fn<SettlementPageLoader>(async()=>({items:[item()],cursor:null}));renderSearch(loader);await ready()
    await screen.findByRole('option',{name:/旧船/});fireEvent.change(screen.getByLabelText('船号 Vessel'),{target:{value:'old'}})
    fireEvent.click(screen.getByRole('button',{name:'已结单'}));search();await ready()
    expect(loader.mock.calls.at(-1)?.[0]).toMatchObject({vesselId:'old',status:'processed'})
  })
  it('renders only summary data and preserves selected-session detail identity',async()=>{
    renderSearch();const row=await ready();expect(row).toHaveTextContent('160.5 kg');expect(row).toHaveTextContent('RM 9.63');expect(row).toHaveTextContent('REFERENCE-1')
    expect(within(row).getByRole('link',{name:'查看结单'})).toHaveAttribute('href',`/${productType==='fish_head'?'fish-head':'fish-meal'}-settlement/head-833-a`)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
  it('keeps weighing actions distinct from processed read-only details',async()=>{
    renderSearch(async()=>({items:[item({status:'weighing'}),item({id:'done',sessionCode:'DONE',status:'processed'})],cursor:null}));await ready()
    expect(screen.getByRole('link',{name:'继续称重'})).toHaveAttribute('href','/weighing/head-833-a')
    expect(screen.getByRole('link',{name:'查看结单'})).toHaveAttribute('href',`/${productType==='fish_head'?'fish-head':'fish-meal'}-settlement/done`)
  })
  it('keeps same-vessel same-date sessions separate and shows unknown RM instead of zero',async()=>{
    renderSearch(async()=>({items:[item({totalAmountCents:null}),item({id:'second',sessionCode:'SECOND'})],cursor:null}));await screen.findByRole('article',{name:'现场单 SECOND'})
    expect(screen.getAllByRole('article')).toHaveLength(2);expect(screen.getAllByRole('article')[0]).toHaveTextContent('RM —')
  })
  it('shows loading until summary resolution and then the explicit empty state',async()=>{
    const pending=deferred<{items:SettlementSummary[];cursor:null}>();renderSearch(()=>pending.promise)
    expect(screen.getByRole('status')).toHaveTextContent('正在载入');expect(screen.queryByText(/这个日期范围没有/)).not.toBeInTheDocument()
    await act(async()=>pending.resolve({items:[],cursor:null}));expect(screen.getByText(/这个日期范围没有/)).toBeInTheDocument()
  })
  it('shows query errors, retry and refresh instead of an empty result',async()=>{
    const loader=vi.fn<SettlementPageLoader>().mockRejectedValueOnce(new Error('permission-denied')).mockResolvedValue({items:[item()],cursor:null})
    renderSearch(loader);expect(await screen.findByRole('alert')).toHaveTextContent('permission-denied')
    fireEvent.click(screen.getByRole('button',{name:'重试'}));await ready();fireEvent.click(screen.getByRole('button',{name:'刷新'}));await ready();expect(loader).toHaveBeenCalledTimes(3)
  })
  it('ignores stale results and errors after query replacement',async()=>{
    const pending=deferred<{items:SettlementSummary[];cursor:null}>()
    const loader=vi.fn<SettlementPageLoader>().mockImplementationOnce(()=>pending.promise).mockResolvedValue({items:[item({sessionCode:'CURRENT'})],cursor:null})
    renderSearch(loader);fireEvent.change(screen.getByLabelText('开始日期 Start Date'),{target:{value:'2026-09-01'}});search()
    await screen.findByRole('article',{name:'现场单 CURRENT'});await act(async()=>pending.reject(new Error('old error')))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('restores filter URL state on remount without depending on previous navigation',async()=>{
    const loader=vi.fn<SettlementPageLoader>(async()=>({items:[item()],cursor:null}));renderSearch(loader,'/list?mode=custom&start=2026-09-01&end=2026-09-30&vessel=old&status=processed');await ready()
    expect(loader.mock.calls[0][0]).toMatchObject({from:'2026-09-01',to:'2026-09-30',vesselId:'old',status:'processed'})
    expect(screen.getByLabelText('船号 Vessel')).toHaveValue('old')
  })
  it('loads another cursor page, deduplicates IDs and preserves results on a retryable page error',async()=>{
    const cursor={fingerprint:'fixture',iso:{buffer:[],after:null,done:false},canonical:{buffer:[],after:null,done:true},monthIndex:0} satisfies SettlementCursor
    const loader=vi.fn<SettlementPageLoader>().mockResolvedValueOnce({items:[item()],cursor}).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({items:[item(),item({id:'second',sessionCode:'SECOND'})],cursor:null})
    renderSearch(loader);await ready();fireEvent.click(screen.getByRole('button',{name:/载入更多/}))
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');expect(screen.getAllByRole('article')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button',{name:/载入更多/}));await screen.findByRole('article',{name:'现场单 SECOND'});expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(loader.mock.calls[1][1]).toBe(cursor)
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
    const result=renderListWithDetail([weighing],"/fish-head-settlement?status=all")
    await screen.findByRole('article',{name:`现场单 ${weighing.sessionCode}`})
    fireEvent.click(within(card(weighing)).getByRole('link',{name:'继续称重'}))
    expect(await screen.findByText('Existing weighing session')).toBeInTheDocument()
    expect(screen.getByTestId('current-path')).toHaveTextContent('/weighing/existing-weighing')
    expect(result.bundleLoader).not.toHaveBeenCalled()
    expect(result.draftSaver).not.toHaveBeenCalled()
  })

  it('opens processed history through the real detail page while preserving its read-only controls',async()=>{
    const processed=makeSession({id:'processed',sessionCode:'FH-PROCESSED',status:'processed',processedReceiptId:'receipt-1'})
    const result=renderListWithDetail([processed],"/fish-head-settlement?status=all")
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
    const result=renderListWithDetail([baseSession],`/fish-head-settlement/${baseSession.id}?status=weighing&mode=custom&start=invalid&end=`)
    await screen.findByRole('table')
    expect(result.bundleLoader).toHaveBeenCalledWith(baseSession.id)
    expect(result.sourceLoader).not.toHaveBeenCalled()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.getByLabelText('金线单价')).toBeEnabled()
    expect(screen.getByLabelText('日期')).toBeDisabled()
  })
})
