import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { MemoryRouter,Route,Routes } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { PurchaseSettlementPage } from './PurchaseSettlementPage'
import { asSettlementSourceEntry,buildPurchaseSettlementLines,makeSettlementDraft,updateSettlementLinePrice } from '../lib/purchaseSettlement'
import { newWeighingSession,buildWeighingEntry } from '../lib/weighing'

afterEach(cleanup)

describe('settlement source identity on the page',()=>{
  it.each([
    {date:'02/10/2026',vesselId:'v833',vesselCode:'833',iso:'2026-10-02',dateSortKey:20261002,monthKey:'10/2026',monthSortKey:202610},
    {date:'01/10/2026',vesselId:'v978',vesselCode:'978',iso:'2026-10-01',dateSortKey:20261001,monthKey:'10/2026',monthSortKey:202610},
    {date:'02/10/2026',vesselId:'v978',vesselCode:'978',iso:'2026-10-02',dateSortKey:20261002,monthKey:'10/2026',monthSortKey:202610},
    {date:'01/11/2026',vesselId:'v978',vesselCode:'978',iso:'2026-11-01',dateSortKey:20261101,monthKey:'11/2026',monthSortKey:202611},
  ])('retains saved price and legacy ID after correction to $date / $vesselCode',async context=>{
    const original={...newWeighingSession({id:'same-source',weighingDate:'01/10/2026',vesselId:'v833',vesselCodeSnapshot:'833',vesselNameSnapshot:'833',externalSlipNo:'FH-001',productType:'fish_head'}),
      status:'completed' as const,completedAt:new Date('2026-10-01T00:00:00Z'),revision:2}
    const entry=buildWeighingEntry({id:'entry-1',clientEntryId:'entry-1',sessionId:original.id,productType:'fish_head',fishSpeciesId:'hong_mu_lin',fishSpecies:{id:'hong_mu_lin',speciesCode:'hong_mu_lin',displayName:'红目林'},fishMealQuality:null,entryMode:'individual',sequenceNo:1,weightGrams:100000,remark:'',recordedAt:new Date('2026-10-01T02:00:00Z'),recordedAtClient:'2026-10-01T10:00:00+08:00',recordedBy:'u1'})
    const saved={...makeSettlementDraft({productType:'fish_head',businessDate:'01/10/2026',dateSortKey:20261001,monthKey:'10/2026',monthSortKey:202610,vesselId:'v833',vesselCodeSnapshot:'833',receiptNo:'FH-001',
      lines:buildPurchaseSettlementLines([asSettlementSourceEntry(entry)],'fish_head','833').map(line=>updateSettlementLinePrice(line,'2.90')),sourceEntryIds:['entry-1'],revision:4}),draftId:'fish_head_20261001_v833',sourceSessionId:original.id,sourceSessionRevision:2}
    const corrected={...original,weighingDate:context.date,vesselId:context.vesselId,vesselCodeSnapshot:context.vesselCode,revision:3}
    const bundle={session:corrected,entries:[{...entry,weightGrams:80000}]}
    const draftLoader=vi.fn(async(source:unknown)=>typeof source==='object'&&source!==null&&'session' in source?saved:null)
    const draftSaver=vi.fn(async draft=>({...draft,revision:5}))
    render(<MemoryRouter initialEntries={['/fish-head-settlement/same-source']}><Routes><Route path="/fish-head-settlement/:sessionId" element={<PurchaseSettlementPage productType="fish_head" vesselLoader={async()=>[]} bundleLoader={async()=>bundle} draftLoader={draftLoader} draftSaver={draftSaver} now={()=>new Date('2026-10-03T00:00:00Z')}/>}/></Routes></MemoryRouter>)
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getByLabelText('红目林单价')).toHaveValue('2.90')
    expect(screen.getByLabelText('日期')).toHaveValue(context.iso)
    expect(screen.getByLabelText('船号')).toHaveValue(context.vesselId)
    expect(screen.getByText('80 kg')).toBeInTheDocument()
    expect(screen.getAllByText('RM 232.00').length).toBeGreaterThan(0)
    expect(screen.getByRole('cell',{name:'RM 2.75'})).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'保存结单草稿'}))
    await waitFor(()=>expect(draftSaver).toHaveBeenCalledTimes(1))
    expect(draftSaver.mock.calls[0][0]).toMatchObject({draftId:saved.draftId,sourceSessionId:'same-source',sourceSessionRevision:3,revision:4,
      businessDate:context.date,dateSortKey:context.dateSortKey,monthKey:context.monthKey,monthSortKey:context.monthSortKey,vesselId:context.vesselId,vesselCodeSnapshot:context.vesselCode,totalAmountCents:23200,
      lines:[expect.objectContaining({unitPriceCentsPerKg:290,defaultUnitPriceCentsPerKg:275,priceWasEdited:true})]})
    await screen.findByText('结单草稿已保存（第 5 版）。')
    fireEvent.click(screen.getByRole('button',{name:'保存结单草稿'}))
    await waitFor(()=>expect(draftSaver).toHaveBeenCalledTimes(2))
    expect(draftSaver.mock.calls[1][0]).toMatchObject({draftId:saved.draftId,sourceSessionId:'same-source',revision:5})
    expect(draftLoader).toHaveBeenCalledTimes(1)
  })

  it('shows identity lookup errors instead of building an empty replacement draft',async()=>{
    const session={...newWeighingSession({id:'same-source',weighingDate:'01/10/2026',vesselId:'v833',vesselCodeSnapshot:'833',vesselNameSnapshot:'833',externalSlipNo:'FH-001',productType:'fish_head'}),
      status:'completed' as const,completedAt:new Date('2026-10-01T00:00:00Z'),revision:2}
    const saver=vi.fn()
    render(<MemoryRouter initialEntries={['/fish-head-settlement/same-source']}><Routes><Route path="/fish-head-settlement/:sessionId" element={<PurchaseSettlementPage productType="fish_head" vesselLoader={async()=>[]} bundleLoader={async()=>({session,entries:[]})} draftLoader={async()=>{throw new Error('同一来源称重单存在多个结单草稿，请核查 IDs：draft-a, draft-b。')}} draftSaver={saver}/>}/></Routes></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('draft-a, draft-b')
    expect(screen.queryByRole('button',{name:'保存结单草稿'})).not.toBeInTheDocument()
    expect(saver).not.toHaveBeenCalled()
  })

  it('rejects a source bundle from another route before looking up drafts',async()=>{
    const session=newWeighingSession({id:'another-source',weighingDate:'01/10/2026',vesselId:'v833',vesselCodeSnapshot:'833',vesselNameSnapshot:'833',externalSlipNo:'FH-001',productType:'fish_head'})
    const loader=vi.fn(async()=>null)
    render(<MemoryRouter initialEntries={['/fish-head-settlement/same-source']}><Routes><Route path="/fish-head-settlement/:sessionId" element={<PurchaseSettlementPage productType="fish_head" vesselLoader={async()=>[]} bundleLoader={async()=>({session,entries:[]})} draftLoader={loader}/>}/></Routes></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('来源现场单与当前路径不一致')
    expect(loader).not.toHaveBeenCalled()
  })
})
