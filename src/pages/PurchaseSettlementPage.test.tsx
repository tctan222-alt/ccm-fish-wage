import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { MemoryRouter,Route,Routes } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { PurchaseSettlementPage } from './PurchaseSettlementPage'
import type { PurchaseSettlementSource } from '../services/purchaseSettlements'
import type { WeighingEntry,WeighingSession } from '../lib/weighing'
import type { Vessel } from '../lib/purchasing'

const vessel:Vessel={id:'v978',vesselCode:'978',displayName:'978',defaultSupplierId:'',defaultSupplierNameSnapshot:'',active:true,order:0,notes:''}
const session:WeighingSession={id:'session-978',sessionCode:'FH-978-20260803-01',productType:'fish_head',weighingDate:'03/08/2026',monthKey:'08/2026',dateSortKey:20260803,monthSortKey:202608,
  externalSlipNo:'',vesselId:'v978',vesselCodeSnapshot:'978',vesselNameSnapshot:'978',status:'completed',lastSequenceNo:2,fishHeadBasketCount:2,fishHeadWeightGrams:160500,
  fishMealBucketBasketCount:0,fishMealBucketWeightGrams:0,fishMealBagBasketCount:0,fishMealBagWeightGrams:0,fishMealTotalWeightGrams:0,totalWeightGrams:160500,
  processedReceiptId:null,processedReceiptCode:null,notes:'',revision:1,voidReason:null}
const headEntry=(id:string,name='金线',code='jin_xian',weight=160500):WeighingEntry=>({id,clientEntryId:id,sessionId:session.id,weighingDate:'03/08/2026',businessDate:'03/08/2026',monthKey:'08/2026',dateSortKey:20260803,monthSortKey:202608,vesselId:'v978',vesselCodeSnapshot:'978',productType:'fish_head',
  fishSpeciesId:code,fishSpeciesCodeSnapshot:code,fishSpeciesNameSnapshot:name,fishMealQuality:null,displayNameSnapshot:name,entryMode:'individual',sequenceNo:1,weightGrams:weight,remark:'',recordedAtClient:'2026-08-03T10:00:00+08:00',recordedAt:'2026-08-03T10:00:00+08:00',recordedBy:'u1',syncStatus:'synced',voided:false,voidReason:null,revision:1})

function renderPage(productType:'fish_head'|'fish_meal',entries:WeighingEntry[],saver=vi.fn(async draft=>draft)){
  const sourceSession=productType==='fish_meal'?{...session,id:'meal-session',sessionCode:'FM-978-20260803-01',productType:'fish_meal' as const,fishHeadBasketCount:0,fishHeadWeightGrams:0,fishMealTotalWeightGrams:300000,totalWeightGrams:300000}:session
  const sourceLoader=vi.fn(async():Promise<PurchaseSettlementSource>=>({session:sourceSession,bundle:{session:sourceSession,entries}}))
  return {saver,sourceLoader,...render(<MemoryRouter><PurchaseSettlementPage productType={productType} vesselLoader={async()=>[vessel]} sourceLoader={sourceLoader} draftLoader={async()=>null} draftSaver={saver} today={()=>'03/08/2026'}/></MemoryRouter>)}
}

afterEach(()=>cleanup())

describe('purchase settlement MVP pages',()=>{
  it('shows a stable fish-head Excel table, default price, blank unmatched price, and recalculates edited cents',async()=>{
    const unmatched=headEntry('other','没有预设价','unknown',50)
    const result=renderPage('fish_head',[headEntry('jin'),unmatched])
    await waitFor(()=>expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.getByRole('columnheader',{name:'预设价'})).toBeInTheDocument()
    expect(screen.getByDisplayValue('2.10')).toBeInTheDocument()
    const unmatchedInput=screen.getByLabelText('没有预设价单价')
    expect(unmatchedInput).toHaveValue('')
    fireEvent.change(screen.getByLabelText('金线单价'),{target:{value:'1.20'}})
    expect(screen.getAllByText('RM 192.60').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button',{name:'保存结单草稿'}))
    await waitFor(()=>expect(result.saver).toHaveBeenCalled())
    expect(result.saver.mock.calls[0][0]).toMatchObject({productType:'fish_head',receiptNo:'',sourceEntryIds:['jin','other'],totalAmountCents:19260,lines:expect.arrayContaining([expect.objectContaining({defaultUnitPriceCentsPerKg:210,unitPriceCentsPerKg:120,priceWasEdited:true})])})
  })

  it('keeps fish-meal quality lines separate and does not invent baskets for total-weight records',async()=>{
    const mealEntry={...headEntry('meal-total'),sessionId:'meal-session',productType:'fish_meal' as const,fishSpeciesId:null,fishSpeciesCodeSnapshot:null,fishSpeciesNameSnapshot:null,fishMealQuality:'bag' as const,displayNameSnapshot:'包鱼仔',entryMode:'total' as const,sequenceNo:null,weightGrams:300000} as WeighingEntry
    const result=renderPage('fish_meal',[mealEntry])
    await waitFor(()=>expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.getByText('包鱼仔')).toBeInTheDocument()
    expect(screen.getByText('0篮 / 总重1条')).toBeInTheDocument()
    expect(screen.getByDisplayValue('0.73')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'保存结单草稿'}))
    await waitFor(()=>expect(result.saver).toHaveBeenCalled())
    expect(result.saver.mock.calls[0][0].lines[0]).toMatchObject({qualityCodeSnapshot:'bag',basketCount:0,totalWeightEntryCount:1,defaultUnitPriceCentsPerKg:73})
  })

  it('locks vessel and date to the source session when opened from a weighing record',async()=>{
    const sourceLoader=vi.fn(async():Promise<PurchaseSettlementSource>=>({session,bundle:{session,entries:[headEntry('jin')]}}))
    const bundleLoader=vi.fn(async()=>({session,entries:[headEntry('jin')]}))
    render(<MemoryRouter initialEntries={['/fish-head-settlement/session-978']}><Routes><Route path="/fish-head-settlement/:sessionId" element={<PurchaseSettlementPage productType="fish_head" vesselLoader={async()=>[vessel]} sourceLoader={sourceLoader} bundleLoader={bundleLoader} draftLoader={async()=>null} draftSaver={async draft=>draft} today={()=>'03/08/2026'} />} /></Routes></MemoryRouter>)
    await waitFor(()=>expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.getByLabelText('船号')).toBeDisabled()
    expect(screen.getByLabelText('日期')).toBeDisabled()
    expect(sourceLoader).not.toHaveBeenCalled()
  })
})
