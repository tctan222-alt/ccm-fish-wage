import { cleanup,render,screen,waitFor,within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter,Route,Routes } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import type { BusinessPartner } from '../lib/masterData'
import type { WeighingEntry,WeighingSession } from '../lib/weighing'
import { WeighingReviewPage } from './WeighingReviewPage'
import { WeighingSessionsPage } from './WeighingSessionsPage'

const session:WeighingSession={
  id:'ws1',sessionCode:'978-20260730-01',weighingDate:'2026-07-30',monthKey:'2026-07',
  externalSlipNo:'C3988',vesselId:'v978',vesselCodeSnapshot:'978',vesselNameSnapshot:'船 978',
  status:'completed',lastSequenceNo:3,fishHeadBasketCount:2,fishHeadWeightGrams:150_000,
  fishMealBucketBasketCount:1,fishMealBucketWeightGrams:50_000,fishMealBagBasketCount:0,
  fishMealBagWeightGrams:200_000,fishMealTotalWeightGrams:250_000,totalWeightGrams:400_000,
  processedReceiptId:null,processedReceiptCode:null,notes:'',revision:5,voidReason:null,
}

function entry(overrides:Partial<WeighingEntry>):WeighingEntry{
  return {id:'e1',clientEntryId:'e1',sessionId:'ws1',productType:'fish_head',fishSpeciesId:'jin_xian',
    fishSpeciesCodeSnapshot:'jin_xian',fishSpeciesNameSnapshot:'金线',fishMealQuality:null,
    displayNameSnapshot:'金线',entryMode:'individual',sequenceNo:1,weightGrams:80_000,remark:'',
    recordedAtClient:'2026-07-30T08:01:00+08:00',recordedAt:null,recordedBy:'u1',syncStatus:'synced',
    voided:false,voidReason:null,revision:1,...overrides}
}

const entries:WeighingEntry[]=[
  entry({id:'e1',sequenceNo:1,weightGrams:80_000}),
  entry({id:'e2',clientEntryId:'e2',sequenceNo:2,weightGrams:70_000}),
  entry({id:'e3',clientEntryId:'e3',productType:'fish_meal',fishSpeciesId:null,fishSpeciesCodeSnapshot:null,
    fishSpeciesNameSnapshot:null,fishMealQuality:'bucket',displayNameSnapshot:'桶鱼仔',sequenceNo:3,weightGrams:50_000}),
  entry({id:'e4',clientEntryId:'e4',productType:'fish_meal',fishSpeciesId:null,fishSpeciesCodeSnapshot:null,
    fishSpeciesNameSnapshot:null,fishMealQuality:'bag',displayNameSnapshot:'包鱼仔',entryMode:'total',sequenceNo:null,
    weightGrams:200_000,remark:'总共48包'}),
  entry({id:'e5',clientEntryId:'e5',sequenceNo:4,weightGrams:20_000,voided:true,voidReason:'重复'}),
]

const supplier:BusinessPartner={id:'sup1',partnerCode:'BP-SUP1',displayName:'海洋供应商',legalName:'',
  supplier:true,customer:false,active:true,phone:'',registrationNo:'',paymentTermsDays:0,notes:'',inactiveBy:null}

afterEach(()=>{cleanup();vi.restoreAllMocks()})

describe('现场称重电脑端复核',()=>{
  it('按日期、船号及状态筛选现场单',async()=>{
    render(<MemoryRouter><WeighingSessionsPage loader={async()=>[
      session,{...session,id:'ws2',sessionCode:'833-20260729-01',weighingDate:'2026-07-29',
        vesselId:'v833',vesselCodeSnapshot:'833',vesselNameSnapshot:'船 833',status:'weighing'},
    ]}/></MemoryRouter>)
    expect(await screen.findByText('978-20260730-01')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('状态'),'weighing')
    expect(screen.queryByText('978-20260730-01')).not.toBeInTheDocument()
    expect(screen.getByText('833-20260729-01')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('船号'),'v978')
    expect(screen.queryByText('833-20260729-01')).not.toBeInTheDocument()
  })

  it('永久显示逐篮、总重、作废记录，并按鱼名和鱼仔品质分别汇总',async()=>{
    renderReview()
    expect(await screen.findByText('978-20260730-01')).toBeInTheDocument()
    const history=screen.getByRole('region',{name:'原始称重记录'})
    expect(within(history).getByText('第 1 篮')).toBeInTheDocument()
    expect(within(history).getByText('第 2 篮')).toBeInTheDocument()
    expect(within(history).getByText('总重')).toBeInTheDocument()
    expect(within(history).getByText('总共48包')).toBeInTheDocument()
    expect(within(history).getByText('已作废：重复')).toBeInTheDocument()
    const summary=screen.getByRole('region',{name:'分类汇总与单价'})
    expect(within(summary).getByText('金线')).toBeInTheDocument()
    expect(within(summary).getByText('桶鱼仔')).toBeInTheDocument()
    expect(within(summary).getByText('包鱼仔')).toBeInTheDocument()
    expect(within(summary).getByText('0 篮 · 200 kg')).toBeInTheDocument()
    const audit=screen.getByRole('region',{name:'修改与作废历史'})
    expect(within(audit).getByText('作废称重')).toBeInTheDocument()
    expect(within(audit).getByText('原因：重复')).toBeInTheDocument()
  })

  it('桶鱼仔和包鱼仔可使用不同单价并只生成一张 Draft Purchase Receipt',async()=>{
    const processor=vi.fn().mockResolvedValue({receiptId:'r1',receiptCode:'RC-12345678',alreadyProcessed:false})
    renderReview(processor)
    const user=userEvent.setup()
    await screen.findByText('978-20260730-01')
    await user.selectOptions(screen.getByLabelText('Supplier'),'sup1')
    await user.type(screen.getByLabelText('金线单价（RM/kg）'),'10')
    await user.type(screen.getByLabelText('桶鱼仔单价（RM/kg）'),'2')
    await user.type(screen.getByLabelText('包鱼仔单价（RM/kg）'),'1.50')
    await user.click(screen.getByRole('button',{name:'生成草稿采购单'}))
    await waitFor(()=>expect(processor).toHaveBeenCalledOnce())
    const input=processor.mock.calls[0][0]
    expect(input.lines.map((line:{categoryNameSnapshot:string;unitPriceCentsPerKg:number})=>[
      line.categoryNameSnapshot,line.unitPriceCentsPerKg,
    ])).toEqual([['金线',1000],['桶鱼仔',200],['包鱼仔',150]])
    expect(await screen.findByText('已生成草稿采购单 RC-12345678')).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'生成草稿采购单'})).not.toBeInTheDocument()
  })

  it('已处理的现场单显示关联采购单且不能重开或再次生成',async()=>{
    renderReview(undefined,{...session,status:'processed',processedReceiptId:'r1',processedReceiptCode:'RC-12345678'})
    expect(await screen.findByRole('link',{name:'RC-12345678'})).toHaveAttribute('href','/purchases/r1')
    expect(screen.queryByRole('button',{name:'重开称重'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'生成草稿采购单'})).not.toBeInTheDocument()
    expect(screen.getByText('已处理，原始称重记录继续永久保留。')).toBeInTheDocument()
  })

  it('后台修改本单是受控动作，并保留修改原因而不是现场切换船号',async()=>{
    const updater=vi.fn().mockResolvedValue({...session,productType:'fish_head' as const,sessionCode:'FH-978-30072026-01'})
    renderReview(undefined,{...session,productType:'fish_head',sessionCode:'FH-978-30072026-01'},updater)
    const user=userEvent.setup()
    await user.click(await screen.findByRole('button',{name:'后台修改本单'}))
    await user.clear(screen.getByLabelText('修改原因'))
    await user.type(screen.getByLabelText('修改原因'),'修正手写单号')
    await user.click(screen.getByRole('button',{name:'保存后台修正'}))
    await waitFor(()=>expect(updater).toHaveBeenCalledOnce())
    expect(updater.mock.calls[0][0]).toMatchObject({sessionId:'ws1',sessionCode:'FH-978-30072026-01',reason:'修正手写单号',vessel:{id:'v978'}})
  })
})

function renderReview(
  processor=vi.fn().mockResolvedValue({receiptId:'r1',receiptCode:'RC-12345678',alreadyProcessed:false}),
  current=session,
  sessionUpdater=vi.fn().mockResolvedValue(current),
){
  render(<MemoryRouter initialEntries={['/weighing/ws1/review']}><Routes>
    <Route path="/weighing/:sessionId/review" element={<WeighingReviewPage
      bundleLoader={async()=>({session:current,entries,actions:[{id:'a1',type:'entry_void',entryId:'e5',reason:'重复',
        performedAt:null,beforeSnapshot:{revision:1,voided:false},afterSnapshot:{revision:2,voided:true}}]})}
      supplierLoader={async()=>[supplier]}
      vesselLoader={async()=>[{id:'v978',vesselCode:'978',displayName:'船 978',defaultSupplierId:'',defaultSupplierNameSnapshot:'',active:true,order:1,notes:''}]}
      processor={processor}
      reopener={vi.fn().mockResolvedValue({...current,status:'weighing'})}
      voider={vi.fn().mockResolvedValue({...current,status:'voided'})}
      sessionUpdater={sessionUpdater}
    />}/>
  </Routes></MemoryRouter>)
}
