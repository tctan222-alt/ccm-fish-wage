import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { MemoryRouter,Route,Routes } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { PurchaseSettlementPage } from './PurchaseSettlementPage'
import { buildWeighingEntry,newWeighingSession,type FishSpeciesRecord,type WeighingEntry } from '../lib/weighing'
import { asSettlementSourceEntry,buildPurchaseSettlementLines,makeSettlementDraft,updateSettlementLinePrice,type PurchaseSettlementDraft } from '../lib/purchaseSettlement'

const now=()=>new Date('2026-10-16T00:00:00Z')
const session={...newWeighingSession({id:'source-978',productType:'fish_head',weighingDate:'05/10/2026',vesselId:'v978',vesselCodeSnapshot:'978',vesselNameSnapshot:'978'}),status:'completed' as const,revision:3,completedAt:new Date('2026-10-05T02:00:00Z')}
const entry=buildWeighingEntry({id:'entry-jin',sessionId:session.id,productType:'fish_head',fishSpeciesId:'jin',fishSpecies:{id:'jin',speciesCode:'jin_xian',displayName:'金线'},fishMealQuality:null,entryMode:'individual',sequenceNo:1,weightGrams:80000,remark:'',recordedAt:new Date('2026-10-05T01:00:00Z'),recordedAtClient:'2026-10-05T09:00:00+08:00',recordedBy:'u1'})
const master:FishSpeciesRecord={id:'jin',speciesCode:'jin_xian',displayName:'金线',active:true,order:0,notes:'',basePriceCentsPerKg:250}
const bundle={session,entries:[entry],actions:[]}
function page({species=master,saved=null,finalizer=vi.fn(async(draft:PurchaseSettlementDraft)=>({...draft,status:'settlement_finalized' as const,finalizedAt:now(),finalizedBy:'u1',revision:draft.revision+1})),clock=now,speciesReader,sourceEntries=bundle.entries}:{species?:FishSpeciesRecord;saved?:PurchaseSettlementDraft|null;finalizer?:(draft:PurchaseSettlementDraft)=>Promise<PurchaseSettlementDraft>;clock?:()=>Date;speciesReader?:()=>Promise<FishSpeciesRecord[]>;sourceEntries?:WeighingEntry[]}={}){
  const saver=vi.fn(async(draft:PurchaseSettlementDraft)=>({...draft,revision:draft.revision+1}))
  const loader=vi.fn(speciesReader??(async()=>[species]))
  const source={...bundle,entries:sourceEntries,session:{...session,fishHeadBasketCount:sourceEntries.length,fishHeadWeightGrams:sourceEntries.reduce((sum,line)=>sum+line.weightGrams,0),totalWeightGrams:sourceEntries.reduce((sum,line)=>sum+line.weightGrams,0)}}
  return {saver,loader,finalizer,...render(<MemoryRouter initialEntries={['/fish-head-settlement/source-978']}><Routes><Route path="/fish-head-settlement/:sessionId" element={<PurchaseSettlementPage productType="fish_head" vesselLoader={async()=>[]} bundleLoader={async()=>source} fishSpeciesLoader={loader} draftLoader={async()=>saved} draftSaver={saver} finalizer={finalizer} now={clock}/>}/></Routes></MemoryRouter>)}
}
function finalizedInvoice():PurchaseSettlementDraft {
  const lines=buildPurchaseSettlementLines([asSettlementSourceEntry(entry)],'fish_head','978',[master]).map(line=>updateSettlementLinePrice(line,'2.70'))
  return {...makeSettlementDraft({productType:'fish_head',businessDate:'05/10/2026',dateSortKey:20261005,monthKey:'10/2026',monthSortKey:202610,vesselId:'v978',vesselCodeSnapshot:'978',receiptNo:'',lines,sourceEntryIds:[entry.id],revision:2}),status:'settlement_finalized',finalizedAt:new Date('2026-10-05T02:00:00Z'),finalizedBy:'u1',sourceSessionId:session.id,sourceSessionRevision:3}
}
afterEach(()=>{cleanup();window.localStorage.clear();vi.useRealTimers()})

describe('Fish Head Master suggestions and invoice-only actual prices',()=>{
  it('shows and edits existing finalized price snapshots without depending on an unavailable Master',async()=>{
    const result=page({saved:finalizedInvoice(),speciesReader:()=>new Promise(()=>{})})
    await screen.findByRole('table')
    expect(screen.getByLabelText('金线单价')).toHaveValue('2.70')
    expect(result.loader).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'修改结单 Edit'}))
    expect(screen.getByLabelText('金线单价')).toBeEnabled()
    expect(result.loader).not.toHaveBeenCalled()
  })
  it('keeps the finalized view on Master failure and retries only new-species defaults without resetting saved prices',async()=>{
    const extra={...entry,id:'entry-lai',clientEntryId:'entry-lai',fishSpeciesId:'lai',fishSpeciesCodeSnapshot:'lai_ge',fishSpeciesNameSnapshot:'来戈',displayNameSnapshot:'来戈',sequenceNo:2}
    const speciesReader=vi.fn<()=>Promise<FishSpeciesRecord[]>>().mockRejectedValueOnce(new Error('Master offline')).mockResolvedValue([master,{...master,id:'lai',speciesCode:'lai_ge',displayName:'来戈',basePriceCentsPerKg:300}])
    const result=page({saved:finalizedInvoice(),sourceEntries:[entry,extra],speciesReader})
    await screen.findByRole('table');expect(result.loader).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'修改结单 Edit'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('Master offline')
    expect(screen.getByRole('table')).toBeInTheDocument();expect(screen.getByLabelText('金线单价')).toHaveValue('2.70')
    expect(screen.getByLabelText('金线单价')).toBeDisabled();expect(result.saver).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'重新读取默认价并修改'}))
    await waitFor(()=>expect(screen.getByLabelText('来戈单价')).toHaveValue('3.05'))
    expect(screen.getByLabelText('金线单价')).toHaveValue('2.70');expect(speciesReader).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('bounds lazy Master editing reads without hiding finalized history',async()=>{
    vi.useFakeTimers()
    const extra={...entry,id:'entry-lai',fishSpeciesId:'lai',fishSpeciesCodeSnapshot:'lai_ge',fishSpeciesNameSnapshot:'来戈',displayNameSnapshot:'来戈',sequenceNo:2}
    page({saved:finalizedInvoice(),sourceEntries:[entry,extra],speciesReader:()=>new Promise(()=>{})})
    await act(async()=>{})
    fireEvent.click(screen.getByRole('button',{name:'修改结单 Edit'}))
    expect(screen.getByRole('status')).toHaveTextContent('正在读取新增鱼种默认价')
    await act(async()=>{await vi.advanceTimersByTimeAsync(15000)})
    expect(screen.getByRole('alert')).toHaveTextContent('15 秒')
    expect(screen.getByRole('table')).toBeInTheDocument();expect(screen.getByRole('button',{name:'重新读取默认价并修改'})).toBeEnabled()
    expect(screen.getByLabelText('金线单价')).toHaveValue('2.70')
  })
  it('auto-populates Master base plus premium, then recomputes and saves a local override without changing Master',async()=>{
    const original={...master}
    const {saver,loader}=page()
    await screen.findByRole('table')
    expect(screen.getByLabelText('金线单价')).toHaveValue('2.55')
    expect(screen.getByText('基础价 RM 2.50 · 船号加价 RM 0.05（默认快照）')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('金线单价'),{target:{value:'2.70'}})
    expect(screen.getAllByText('RM 216.00')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button',{name:'保存结单草稿'}))
    await screen.findByText('结单草稿已保存（第 1 版）。')
    expect(saver.mock.calls[0][0]).toMatchObject({sourceSessionId:session.id,totalAmountCents:21600,lines:[{baseUnitPriceCentsPerKg:250,vesselPremiumCentsPerKg:5,defaultUnitPriceCentsPerKg:255,unitPriceCentsPerKg:270,priceWasEdited:true}]})
    expect(master).toEqual(original);expect(loader).toHaveBeenCalledTimes(1)
    expect(screen.getByText('本单实际价仅用于这张结单，不会修改 Master 基础默认价。')).toBeInTheDocument()
  })
  it('renders a missing default and its weight, blocks Finalize by fish name, then finalizes a manually entered price',async()=>{
    const {finalizer,saver}=page({species:{...master,basePriceCentsPerKg:null}})
    await screen.findByRole('table')
    expect(screen.getByText('80 kg')).toBeInTheDocument()
    expect(screen.getByText('未设默认价')).toBeInTheDocument()
    expect(screen.getByRole('link',{name:'编辑 Master 默认价'})).toHaveAttribute('href','/fish-species#species-jin')
    expect(screen.getByLabelText('金线单价')).toHaveValue('')
    fireEvent.click(screen.getByRole('button',{name:'完成结单 Finalize'}))
    expect(screen.getByRole('alert')).toHaveTextContent('以下鱼种尚未填写价格：金线')
    expect(finalizer).not.toHaveBeenCalled();expect(saver).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'保存结单草稿'}))
    await screen.findByText('结单草稿已保存（第 1 版）。')
    fireEvent.change(screen.getByLabelText('金线单价'),{target:{value:'2.70'}})
    fireEvent.click(screen.getByRole('button',{name:'完成结单 Finalize'}))
    await screen.findByText('已完成结单（第 2 版）。')
    expect(finalizer).toHaveBeenCalledWith(expect.objectContaining({totalAmountCents:21600,lines:[expect.objectContaining({unitPriceCentsPerKg:270,defaultUnitPriceCentsPerKg:null})]}))
  })
  it('retains an invoice override on local restore even when Master changes after navigation',async()=>{
    const first=page();await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('金线单价'),{target:{value:'2.70'}})
    first.unmount()
    const second=page({species:{...master,basePriceCentsPerKg:260}})
    await screen.findByRole('heading',{name:'发现未完成草稿'})
    expect(screen.getByLabelText('金线单价')).toHaveValue('2.65')
    fireEvent.click(screen.getByRole('button',{name:'恢复草稿'}))
    expect(screen.getByLabelText('金线单价')).toHaveValue('2.70')
    expect(second.saver).not.toHaveBeenCalled()
  })
  it.each([90*86400000-1,90*86400000])('uses the original finalizedAt for price editing at age %i ms',async age=>{
    const finalizedAt=new Date('2026-10-05T02:00:00Z')
    const lines=buildPurchaseSettlementLines([asSettlementSourceEntry(entry)],'fish_head','978',[master]).map(line=>updateSettlementLinePrice(line,'2.70'))
    const saved={...makeSettlementDraft({productType:'fish_head',businessDate:'05/10/2026',dateSortKey:20261005,monthKey:'10/2026',monthSortKey:202610,vesselId:'v978',vesselCodeSnapshot:'978',receiptNo:'',lines,sourceEntryIds:[entry.id],revision:2}),status:'settlement_finalized' as const,finalizedAt,finalizedBy:'u1',sourceSessionId:session.id,sourceSessionRevision:3}
    const result=page({saved,species:{...master,basePriceCentsPerKg:999},clock:()=>new Date(finalizedAt.getTime()+age)})
    await screen.findByRole('table')
    expect(screen.getByLabelText('金线单价')).toHaveValue('2.70')
    const edit=screen.getByRole('button',{name:'修改结单 Edit'})
    if(age<90*86400000){
      fireEvent.click(edit);expect(screen.getByLabelText('金线单价')).toBeEnabled()
      fireEvent.change(screen.getByLabelText('金线单价'),{target:{value:'2.80'}})
      fireEvent.click(screen.getByRole('button',{name:'保存修改'}))
      await waitFor(()=>expect(result.saver).toHaveBeenCalledTimes(1))
      expect(result.saver.mock.calls[0][0].lines[0]).toMatchObject({unitPriceCentsPerKg:280,defaultUnitPriceCentsPerKg:255,baseUnitPriceCentsPerKg:250})
    }else{expect(edit).toBeDisabled();expect(screen.getByLabelText('金线单价')).toBeDisabled();expect(result.saver).not.toHaveBeenCalled()}
  })
})
