import { act,cleanup,fireEvent,render,screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { MemoryRouter,Route,Routes,useNavigate } from 'react-router-dom'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { PurchaseSettlementPage } from './PurchaseSettlementPage'
import { asSettlementSourceEntry,buildPurchaseSettlementLines,makeSettlementDraft,updateSettlementLinePrice,type PurchaseSettlementDraft } from '../lib/purchaseSettlement'
import { buildWeighingEntry,newWeighingSession } from '../lib/weighing'
import type { Vessel } from '../lib/purchasing'
import { createSettlementLocalDraftStore } from '../services/settlementLocalDrafts'
import type { WeighingBundle } from '../services/weighing'

type PageProps=ComponentProps<typeof PurchaseSettlementPage>
const vessel:Vessel={id:'v978',vesselCode:'978',displayName:'978',active:true,order:0,notes:'',defaultSupplierId:'',defaultSupplierNameSnapshot:''}
const fixedNow=()=>new Date('2026-10-03T00:00:00Z')
function deferred<T>(){
  let resolve!:(value:T)=>void
  const promise=new Promise<T>(accept=>{resolve=accept})
  return {promise,resolve}
}
function bundle(id='source-978',weightGrams=80_000):WeighingBundle{
  const session={...newWeighingSession({id,productType:'fish_head',weighingDate:'01/10/2026',vesselId:'v978',vesselCodeSnapshot:'978',vesselNameSnapshot:'978',externalSlipNo:id}),status:'completed' as const,revision:1,completedAt:new Date('2026-10-01T00:00:00Z')}
  const entry=buildWeighingEntry({id:'entry-'+id,sessionId:id,productType:'fish_head',fishSpeciesId:'jin_xian',fishSpecies:{id:'jin_xian',speciesCode:'jin_xian',displayName:'金线'},fishMealQuality:null,entryMode:'individual',sequenceNo:1,weightGrams,remark:'',recordedAt:new Date('2026-10-01T02:00:00Z'),recordedAtClient:'2026-10-01T10:00:00+08:00',recordedBy:'u1'})
  return {session,entries:[entry]}
}
function draftFor(source:WeighingBundle,price='2.10'):PurchaseSettlementDraft{
  return {...makeSettlementDraft({productType:'fish_head',businessDate:'01/10/2026',dateSortKey:20261001,monthKey:'10/2026',monthSortKey:202610,vesselId:'v978',vesselCodeSnapshot:'978',receiptNo:'SERVER',
    lines:buildPurchaseSettlementLines(source.entries.map(asSettlementSourceEntry),'fish_head','978').map(line=>updateSettlementLinePrice(line,price)),sourceEntryIds:source.entries.map(entry=>entry.id),revision:0}),sourceSessionId:source.session.id,sourceSessionRevision:1}
}
function Navigation(){
  const navigate=useNavigate()
  return <><button type="button" onClick={()=>navigate('/fish-head-settlement/source-next')}>另一来源</button><button type="button" onClick={()=>navigate(-1)}>浏览器返回</button></>
}
function renderPage(overrides:Partial<PageProps>={},path='/fish-head-settlement/source-978'){
  const props:PageProps={productType:'fish_head',vesselLoader:async()=>[vessel],bundleLoader:async id=>bundle(id),draftLoader:async()=>null,legacyDraftLoader:async()=>null,fishSpeciesLoader:async()=>[],today:()=> '01/10/2026',now:fixedNow,...overrides}
  return render(<MemoryRouter initialEntries={[path]}><Navigation/><Routes><Route path="/fish-head-settlement/:sessionId?" element={<PurchaseSettlementPage {...props}/>}/></Routes></MemoryRouter>)
}
async function flushReads(){await act(async()=>{await vi.advanceTimersByTimeAsync(0)})}
async function advance(milliseconds:number){await act(async()=>{await vi.advanceTimersByTimeAsync(milliseconds)})}
function expectNotLoading(){expect(screen.queryByText(/正在载入结单资料/)).not.toBeInTheDocument()}

beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(fixedNow())})
afterEach(()=>{cleanup();window.localStorage.clear();vi.useRealTimers();vi.restoreAllMocks()})

describe('settlement pending-read recovery',()=>{
  it('clears loading after a successful source and draft read without waiting for a timer',async()=>{
    const source=deferred<WeighingBundle>()
    renderPage({bundleLoader:()=>source.promise})
    expect(screen.getByRole('status')).toHaveTextContent('正在读取称重来源')
    await act(async()=>source.resolve(bundle()))
    await flushReads()
    expectNotLoading()
    expect(screen.getByRole('table',{name:'鱼头结单检查表'})).toHaveTextContent('80 kg')
    expect(screen.getByRole('button',{name:'保存结单草稿'})).toBeEnabled()
    expect(screen.queryByRole('button',{name:'重新载入结单'})).not.toBeInTheDocument()
  })

  it('distinguishes an absent tuple source from a failed or permanently pending read',async()=>{
    const legacyDraftLoader=vi.fn(async()=>null)
    renderPage({sourceLoader:async()=>({session:null,bundle:null}),legacyDraftLoader},'/fish-head-settlement')
    await flushReads()
    expectNotLoading()
    expect(screen.getByText(/找不到 978.*的已完成称重单/)).toBeInTheDocument()
    expect(screen.getByText('当前没有称重资料，不能结单。')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(legacyDraftLoader).toHaveBeenCalledExactlyOnceWith('fish_head',20261001,'v978')
  })

  it.each(['找不到现场称重单。','称重来源读取失败。'])('clears loading and offers retry when the source rejects: %s',async(message)=>{
    const draftLoader=vi.fn(async()=>null)
    renderPage({bundleLoader:async()=>{throw new Error(message)},draftLoader})
    await flushReads()
    expectNotLoading()
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('button',{name:'重新载入结单'})).toBeEnabled()
    expect(screen.queryByText('当前没有称重资料，不能结单。')).not.toBeInTheDocument()
    expect(draftLoader).not.toHaveBeenCalled()
  })

  it('waits while the source is pending, then exposes recovery at exactly 15 seconds',async()=>{
    const source=deferred<WeighingBundle>()
    const bundleLoader=vi.fn(()=>source.promise)
    renderPage({bundleLoader})
    await advance(14_999)
    expect(screen.getByRole('status')).toHaveTextContent('正在读取称重来源')
    expect(screen.queryByRole('button',{name:'重新载入结单'})).not.toBeInTheDocument()
    await advance(1)
    expectNotLoading()
    expect(screen.getByRole('alert')).toHaveTextContent('读取称重来源较慢，已超过 15 秒')
    expect(screen.getByRole('button',{name:'重新载入结单'})).toBeEnabled()
    expect(bundleLoader).toHaveBeenCalledExactlyOnceWith('source-978')
  })

  it('clears loading after a rejected draft read instead of constructing a replacement draft',async()=>{
    renderPage({draftLoader:async()=>{throw new Error('结单读取失败，请重试。')}})
    await flushReads()
    expectNotLoading()
    expect(screen.getByRole('alert')).toHaveTextContent('结单读取失败，请重试。')
    expect(screen.getByRole('button',{name:'重新载入结单'})).toBeEnabled()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'保存结单草稿'})).not.toBeInTheDocument()
  })

  it('identifies a pending draft read and makes it retryable after its own 15-second deadline',async()=>{
    const source=deferred<WeighingBundle>(),draft=deferred<PurchaseSettlementDraft|null>()
    renderPage({bundleLoader:()=>source.promise,draftLoader:()=>draft.promise})
    await advance(10_000)
    await act(async()=>source.resolve(bundle()))
    await flushReads()
    expect(screen.getByRole('status')).toHaveTextContent('正在读取结单')
    await advance(14_999)
    expect(screen.getByRole('status')).toHaveTextContent('正在读取结单')
    await advance(1)
    expectNotLoading()
    expect(screen.getByRole('alert')).toHaveTextContent('读取结单较慢，已超过 15 秒')
    expect(screen.getByRole('button',{name:'重新载入结单'})).toBeEnabled()
  })

  it('shows the legacy lookup stage before a pending legacy draft reaches its deadline',async()=>{
    const legacy=deferred<PurchaseSettlementDraft|null>()
    const draftLoader:NonNullable<PageProps['draftLoader']>=async(_source,_product,onLegacyRead)=>{onLegacyRead?.();return legacy.promise}
    renderPage({draftLoader})
    await flushReads()
    expect(screen.getByRole('status')).toHaveTextContent('正在核对历史资料')
    await advance(15_000)
    expectNotLoading()
    expect(screen.getByRole('alert')).toHaveTextContent('核对历史资料较慢，已超过 15 秒')
    expect(screen.getByRole('button',{name:'重新载入结单'})).toBeEnabled()
  })

  it('bounds the legacy-only read when no tuple source exists',async()=>{
    const legacy=deferred<PurchaseSettlementDraft|null>()
    renderPage({sourceLoader:async()=>({session:null,bundle:null}),legacyDraftLoader:()=>legacy.promise},'/fish-head-settlement')
    await flushReads()
    expect(screen.getByRole('status')).toHaveTextContent('正在核对历史资料')
    await advance(15_000)
    expectNotLoading()
    expect(screen.getByRole('alert')).toHaveTextContent('核对历史资料较慢，已超过 15 秒')
    expect(screen.queryByText('当前没有称重资料，不能结单。')).not.toBeInTheDocument()
  })

  it('shows a recoverable vessel timeout on the list route rather than waiting for vessels forever',async()=>{
    const vessels=deferred<Vessel[]>()
    const sourceLoader=vi.fn(async()=>({session:null,bundle:null}))
    renderPage({vesselLoader:()=>vessels.promise,sourceLoader},'/fish-head-settlement')
    await flushReads()
    expect(screen.getByRole('status')).toHaveTextContent('正在读取船号资料')
    await advance(15_000)
    expectNotLoading()
    expect(screen.getByRole('alert')).toHaveTextContent('读取船号资料较慢，已超过 15 秒')
    expect(screen.getByRole('button',{name:'重试船号'})).toBeEnabled()
    expect(sourceLoader).not.toHaveBeenCalled()
  })

  it('retries vessels independently without replacing an already edited source price or paper number',async()=>{
    const vessels=deferred<Vessel[]>()
    const vesselLoader=vi.fn().mockImplementationOnce(()=>vessels.promise).mockResolvedValue([vessel])
    const bundleLoader=vi.fn(async()=>bundle()),draftLoader=vi.fn(async()=>null)
    renderPage({vesselLoader,bundleLoader,draftLoader})
    await flushReads()
    fireEvent.change(screen.getByLabelText('金线单价'),{target:{value:'1.23'}})
    fireEvent.change(screen.getByLabelText('鱼头纸单号'),{target:{value:'LOCAL-123'}})
    await advance(15_000)
    expect(screen.getByRole('alert')).toHaveTextContent('读取船号资料较慢')
    fireEvent.click(screen.getByRole('button',{name:'重试船号'}))
    await flushReads()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('金线单价')).toHaveValue('1.23')
    expect(screen.getByLabelText('鱼头纸单号')).toHaveValue('LOCAL-123')
    expect(bundleLoader).toHaveBeenCalledTimes(1)
    expect(draftLoader).toHaveBeenCalledTimes(1)
    expect(vesselLoader).toHaveBeenCalledTimes(2)
  })

  it('retries the same session and recovers its existing local draft without deleting or silently applying it',async()=>{
    const source=bundle(),saved=draftFor(source,'1.23')
    const store=createSettlementLocalDraftStore('recovery-test')
    store.save({version:1,productType:'fish_head',sourceSessionId:source.session.id,sourceSessionRevision:1,settlementRevision:0,businessDate:'01/10/2026',vesselId:'v978',vesselCodeSnapshot:'978',receiptNo:'LOCAL-123',priceInputs:{['entry-'+source.session.id]:'1.23'},lines:saved.lines,updatedAt:'2026-10-03T00:00:00Z'})
    const originalLocal=window.localStorage.getItem(window.localStorage.key(0)!)
    const pending=deferred<WeighingBundle>()
    const bundleLoader=vi.fn().mockImplementationOnce(()=>pending.promise).mockResolvedValue(source)
    const saver=vi.fn()
    renderPage({bundleLoader,localDraftStore:store,draftSaver:saver})
    await advance(15_000)
    expect(window.localStorage.getItem(window.localStorage.key(0)!)).toBe(originalLocal)
    fireEvent.click(screen.getByRole('button',{name:'重新载入结单'}))
    await flushReads()
    expectNotLoading()
    expect(bundleLoader.mock.calls).toEqual([['source-978'],['source-978']])
    expect(screen.getByRole('heading',{name:'发现未完成草稿'})).toBeInTheDocument()
    expect(screen.getByLabelText('金线单价')).toHaveValue('2.10')
    expect(window.localStorage.getItem(window.localStorage.key(0)!)).toBe(originalLocal)
    fireEvent.click(screen.getByRole('button',{name:'恢复草稿'}))
    expect(screen.getByLabelText('金线单价')).toHaveValue('1.23')
    expect(screen.getByLabelText('鱼头纸单号')).toHaveValue('LOCAL-123')
    expect(saver).not.toHaveBeenCalled()
  })

  it('ignores a timed-out source response after the same-session retry has succeeded',async()=>{
    const oldSource=deferred<WeighingBundle>()
    const bundleLoader=vi.fn().mockImplementationOnce(()=>oldSource.promise).mockResolvedValue(bundle())
    const draftLoader=vi.fn(async()=>null)
    renderPage({bundleLoader,draftLoader})
    await advance(15_000)
    fireEvent.click(screen.getByRole('button',{name:'重新载入结单'}))
    await flushReads()
    fireEvent.change(screen.getByLabelText('金线单价'),{target:{value:'1.23'}})
    await act(async()=>oldSource.resolve(bundle('source-978',110_000)))
    await flushReads()
    expectNotLoading()
    expect(screen.getByText('80 kg')).toBeInTheDocument()
    expect(screen.queryByText('110 kg')).not.toBeInTheDocument()
    expect(screen.getByLabelText('金线单价')).toHaveValue('1.23')
    expect(draftLoader).toHaveBeenCalledTimes(1)
  })

  it('ignores a timed-out draft response after retry displays the current draft',async()=>{
    const oldDraft=deferred<PurchaseSettlementDraft|null>(),source=bundle()
    const draftLoader=vi.fn().mockImplementationOnce(()=>oldDraft.promise).mockResolvedValue(draftFor(source,'1.23'))
    renderPage({draftLoader})
    await flushReads()
    await advance(15_000)
    fireEvent.click(screen.getByRole('button',{name:'重新载入结单'}))
    await flushReads()
    expect(screen.getByLabelText('金线单价')).toHaveValue('1.23')
    await act(async()=>oldDraft.resolve(draftFor(source,'9.99')))
    await flushReads()
    expectNotLoading()
    expect(screen.getByLabelText('金线单价')).toHaveValue('1.23')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('ignores a pending response after navigation switches to another source',async()=>{
    const oldSource=deferred<WeighingBundle>()
    const bundleLoader=vi.fn((id:string)=>id==='source-978'?oldSource.promise:Promise.resolve(bundle(id,90_000)))
    const draftLoader=vi.fn(async()=>null)
    renderPage({bundleLoader,draftLoader})
    await flushReads()
    fireEvent.click(screen.getByRole('button',{name:'另一来源'}))
    await flushReads()
    expect(screen.getByText('90 kg')).toBeInTheDocument()
    await act(async()=>oldSource.resolve(bundle('source-978',110_000)))
    await flushReads()
    expect(screen.getByText('90 kg')).toBeInTheDocument()
    expect(screen.queryByText('110 kg')).not.toBeInTheDocument()
    expect(screen.getByLabelText('鱼头纸单号')).toHaveValue('source-next')
    expect(draftLoader).toHaveBeenCalledTimes(1)
    await advance(15_000)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reloads the original source on browser Back and ignores late responses from the abandoned source',async()=>{
    const abandoned=deferred<WeighingBundle>()
    const bundleLoader=vi.fn((id:string)=>id==='source-next'?abandoned.promise:Promise.resolve(bundle(id)))
    renderPage({bundleLoader})
    await flushReads()
    fireEvent.click(screen.getByRole('button',{name:'另一来源'}))
    await flushReads()
    expect(screen.getByRole('status')).toHaveTextContent('正在读取称重来源')
    fireEvent.click(screen.getByRole('button',{name:'浏览器返回'}))
    await flushReads()
    expectNotLoading()
    expect(screen.getByText('80 kg')).toBeInTheDocument()
    expect(screen.getByLabelText('鱼头纸单号')).toHaveValue('source-978')
    await act(async()=>abandoned.resolve(bundle('source-next',110_000)))
    await flushReads()
    expect(screen.queryByText('110 kg')).not.toBeInTheDocument()
    expect(screen.getByLabelText('鱼头纸单号')).toHaveValue('source-978')
    expect(bundleLoader.mock.calls).toEqual([['source-978'],['source-next'],['source-978']])
  })

  it('clears loading after local storage throws, blocks editing and exposes an explicit local retry',async()=>{
    const store=createSettlementLocalDraftStore('storage-test')
    const load=vi.spyOn(store,'load').mockImplementationOnce(()=>{throw new Error('无法读取本机草稿，草稿未被删除。')})
    renderPage({localDraftStore:store})
    await flushReads()
    expectNotLoading()
    expect(screen.getByRole('alert')).toHaveTextContent('无法读取本机草稿，草稿未被删除。')
    expect(screen.getByRole('table',{name:'鱼头结单检查表'})).toBeInTheDocument()
    expect(screen.getByLabelText('金线单价')).toBeDisabled()
    expect(screen.getByRole('button',{name:'保存结单草稿'})).toBeDisabled()
    expect(screen.queryByRole('button',{name:'重新载入结单'})).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'重试本机草稿'}))
    await flushReads()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('金线单价')).toBeEnabled()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
