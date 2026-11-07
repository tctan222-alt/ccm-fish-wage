import { act,cleanup,render,screen,waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter,Route,Routes,useNavigate } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { BusinessPartner } from '../lib/masterData'
import type { Vessel } from '../lib/purchasing'
import type { WeighingEntry,WeighingSession } from '../lib/weighing'
import type { WeighingBundle } from '../services/weighing'
import { WeighingReviewPage } from './WeighingReviewPage'
import { WeighingSessionsPage } from './WeighingSessionsPage'

const session:WeighingSession={
  id:'ws1',sessionCode:'FH-978-30072026-01',productType:'fish_head',weighingDate:'30/07/2026',monthKey:'07/2026',
  externalSlipNo:'P-1',vesselId:'v978',vesselCodeSnapshot:'978',vesselNameSnapshot:'船 978',
  status:'completed',lastSequenceNo:1,fishHeadBasketCount:1,fishHeadWeightGrams:80_000,
  fishMealBucketBasketCount:0,fishMealBucketWeightGrams:0,fishMealBagBasketCount:0,fishMealBagWeightGrams:0,
  fishMealTotalWeightGrams:0,totalWeightGrams:80_000,processedReceiptId:null,processedReceiptCode:null,
  notes:'',revision:1,voidReason:null,completedAt:new Date('2026-07-30T02:00:00Z'),
}
const entry:WeighingEntry={id:'e1',clientEntryId:'e1',sessionId:'ws1',productType:'fish_head',fishSpeciesId:'jin_xian',
  fishSpeciesCodeSnapshot:'jin_xian',fishSpeciesNameSnapshot:'金线',fishMealQuality:null,displayNameSnapshot:'金线',
  entryMode:'individual',sequenceNo:1,weightGrams:80_000,remark:'',recordedAtClient:'2026-07-30T08:01:00+08:00',
  recordedAt:null,recordedBy:'u1',syncStatus:'synced',voided:false,voidReason:null,revision:1}
const bundle:WeighingBundle={session,entries:[entry],actions:[]}
const supplier:BusinessPartner={id:'sup1',partnerCode:'SUP1',displayName:'供应商',legalName:'',supplier:true,customer:false,
  active:true,phone:'',registrationNo:'',paymentTermsDays:0,notes:'',inactiveBy:null}
const vessel:Vessel={id:'v978',vesselCode:'978',displayName:'船 978',defaultSupplierId:'',defaultSupplierNameSnapshot:'',active:true,order:1,notes:''}

function deferred<T>(){
  let resolve!:(value:T)=>void, reject!:(error:Error)=>void
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no})
  return {promise,resolve,reject}
}
function Navigation(){
  const navigate=useNavigate()
  return <button type="button" onClick={()=>navigate('/weighing/ws2/review')}>下一张现场单</button>
}
function reviewTree(props:ComponentProps<typeof WeighingReviewPage>){
  return <MemoryRouter initialEntries={['/weighing/ws1/review']}><Navigation/><Routes>
    <Route path="/weighing/:sessionId/review" element={<WeighingReviewPage {...props}/>}/>
    <Route path="/weighing/:sessionId" element={<p>篮重修改页</p>}/>
  </Routes></MemoryRouter>
}
function renderReview(overrides:ComponentProps<typeof WeighingReviewPage>={}){
  const props={bundleLoader:vi.fn(async()=>bundle),supplierLoader:vi.fn(async()=>[supplier]),vesselLoader:vi.fn(async()=>[vessel]),
    processor:vi.fn(async()=>({receiptId:'r1',receiptCode:'RC-1',alreadyProcessed:false})),
    reopener:vi.fn(async()=>({...session,status:'weighing' as const})),
    sessionUpdater:vi.fn(async()=>({...session,dateSortKey:20260730,monthSortKey:202607,lastActionId:'a-update',revision:2})),
    now:()=>new Date('2026-08-01T00:00:00Z'),...overrides}
  return {...render(reviewTree(props)),props}
}
afterEach(()=>{cleanup();vi.restoreAllMocks()})

describe('称重复核独立读取与恢复',()=>{
  it('供应商及船号读取失败不阻止原始记录、结单链接或不依赖 Master 的七天修改动作',async()=>{
    const processor=vi.fn(),sessionUpdater=vi.fn()
    renderReview({supplierLoader:vi.fn().mockRejectedValue(new Error('supplier offline')),
      vesselLoader:vi.fn().mockRejectedValue(new Error('vessel offline')),processor,sessionUpdater})
    expect(await screen.findByRole('link',{name:'查看鱼头结单'})).toHaveAttribute('href','/fish-head-settlement/ws1')
    expect(screen.getByRole('region',{name:'原始称重记录'})).toHaveTextContent('80 kg')
    expect(await screen.findByText('无法载入供应商；暂不可生成草稿采购单。')).toBeInTheDocument()
    expect(screen.getByText('无法载入船号；暂不可后台修改本单。')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'生成草稿采购单'})).toBeDisabled()
    expect(screen.getByRole('button',{name:'后台修改本单'})).toBeDisabled()
    expect(screen.getByRole('button',{name:'修改称重（7 天内）'})).toBeEnabled()
    await userEvent.click(screen.getByRole('button',{name:'生成草稿采购单'}))
    await userEvent.click(screen.getByRole('button',{name:'后台修改本单'}))
    expect(processor).not.toHaveBeenCalled();expect(sessionUpdater).not.toHaveBeenCalled()
  })

  it('挂起的辅助读取不阻止已处理单据与关联采购单只读查看',async()=>{
    const supplierRead=deferred<BusinessPartner[]>(),vesselRead=deferred<Vessel[]>()
    renderReview({bundleLoader:async()=>({...bundle,session:{...session,status:'processed',processedReceiptId:'r-old',processedReceiptCode:'RC-old'}}),
      supplierLoader:()=>supplierRead.promise,vesselLoader:()=>vesselRead.promise})
    expect(await screen.findByRole('link',{name:'RC-old'})).toHaveAttribute('href','/purchases/r-old')
    expect(screen.getByRole('region',{name:'原始称重记录'})).toHaveTextContent('80 kg')
    expect(screen.queryByRole('button',{name:'生成草稿采购单'})).not.toBeInTheDocument()
  })

  it('只重试失败供应商读取，保留输入单价且船号失败不阻止仅依赖供应商的生成动作',async()=>{
    const supplierLoader=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([supplier])
    const {props}=renderReview({supplierLoader,vesselLoader:vi.fn().mockRejectedValue(new Error('vessel offline'))})
    await screen.findByRole('button',{name:'重试供应商'})
    await userEvent.type(screen.getByLabelText('金线单价（RM/kg）'),'10.25')
    await userEvent.click(screen.getByRole('button',{name:'重试供应商'}))
    await waitFor(()=>expect(screen.getByLabelText('Supplier')).toBeEnabled())
    expect(screen.getByLabelText('金线单价（RM/kg）')).toHaveValue('10.25')
    expect(props.bundleLoader).toHaveBeenCalledOnce();expect(props.vesselLoader).toHaveBeenCalledOnce()
    expect(supplierLoader).toHaveBeenCalledTimes(2)
    await userEvent.selectOptions(screen.getByLabelText('Supplier'),'sup1')
    await userEvent.click(screen.getByRole('button',{name:'生成草稿采购单'}))
    expect(await screen.findByText('已生成草稿采购单 RC-1')).toBeInTheDocument()
    expect(props.processor).toHaveBeenCalledWith(expect.objectContaining({sessionId:'ws1',supplier,
      lines:[expect.objectContaining({unitPriceCentsPerKg:1025})]}))
  })

  it('只重试失败船号读取，供应商失败不阻止需要船号的后台修正',async()=>{
    const vesselLoader=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([vessel])
    const {props}=renderReview({vesselLoader,supplierLoader:vi.fn().mockRejectedValue(new Error('supplier offline'))})
    await userEvent.click(await screen.findByRole('button',{name:'重试船号'}))
    await waitFor(()=>expect(screen.getByRole('button',{name:'后台修改本单'})).toBeEnabled())
    expect(props.bundleLoader).toHaveBeenCalledOnce();expect(props.supplierLoader).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button',{name:'后台修改本单'}))
    await userEvent.click(screen.getByRole('button',{name:'保存后台修正'}))
    await waitFor(()=>expect(props.sessionUpdater).toHaveBeenCalledWith(expect.objectContaining({sessionId:'ws1',vessel})))
  })

  it('现场单读取失败可单独重试，并不把失败显示成空单或重读已成功 Master',async()=>{
    const bundleLoader=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(bundle)
    const {props}=renderReview({bundleLoader})
    expect(await screen.findByRole('alert')).toHaveTextContent('无法载入现场称重单。')
    expect(screen.queryByRole('region',{name:'原始称重记录'})).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button',{name:'重试现场称重单'}))
    expect(await screen.findByText(session.sessionCode)).toBeInTheDocument()
    expect(props.supplierLoader).toHaveBeenCalledOnce();expect(props.vesselLoader).toHaveBeenCalledOnce()
    expect(bundleLoader).toHaveBeenCalledTimes(2)
  })

  it('切换现场单清除旧输入、对话框和旧读取；迟到回包不能覆盖新单',async()=>{
    const first=deferred<WeighingBundle>(),oldSuppliers=deferred<BusinessPartner[]>(),oldVessels=deferred<Vessel[]>()
    const next={...session,id:'ws2',sessionCode:'FH-833-31072026-01',vesselId:'v833',vesselCodeSnapshot:'833'}
    const bundleLoader=vi.fn((id:string)=>id==='ws1'?first.promise:Promise.resolve({...bundle,session:next}))
    renderReview({bundleLoader,supplierLoader:vi.fn().mockReturnValueOnce(oldSuppliers.promise).mockResolvedValue([supplier]),
      vesselLoader:vi.fn().mockReturnValueOnce(oldVessels.promise).mockResolvedValue([vessel])})
    await userEvent.click(screen.getByRole('button',{name:'下一张现场单'}))
    expect(await screen.findByText(next.sessionCode)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('金线单价（RM/kg）'),'8')
    await act(async()=>{first.resolve(bundle);oldSuppliers.reject(new Error('old supplier'));oldVessels.reject(new Error('old vessel'))})
    expect(screen.queryByText(session.sessionCode)).not.toBeInTheDocument()
    expect(screen.getByLabelText('金线单价（RM/kg）')).toHaveValue('8')
    expect(screen.queryByText('无法载入供应商；暂不可生成草稿采购单。')).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'后台修改本单'})).toBeEnabled()
  })

  it('路由变化立即重置已载入单据输入与编辑对话框',async()=>{
    const next={...session,id:'ws2',sessionCode:'FH-next'}
    renderReview({bundleLoader:async id=>({...bundle,session:id==='ws1'?session:next})})
    await userEvent.click(await screen.findByRole('button',{name:'后台修改本单'}))
    await userEvent.type(screen.getByLabelText('后台备注'),'旧单草稿')
    await userEvent.click(screen.getByRole('button',{name:'下一张现场单'}))
    expect(await screen.findByText('FH-next')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('金线单价（RM/kg）')).toHaveValue('')
    expect(screen.getByLabelText('Supplier')).toHaveValue('')
  })

  it('旧单重开请求迟到时不能把用户从新单带回旧单',async()=>{
    const reopen=deferred<WeighingSession>()
    vi.spyOn(window,'prompt').mockReturnValue('修正篮重')
    renderReview({bundleLoader:async id=>({...bundle,session:id==='ws1'?session:{...session,id:'ws2',sessionCode:'FH-next'}}),reopener:()=>reopen.promise})
    await userEvent.click(await screen.findByRole('button',{name:'修改称重（7 天内）'}))
    await userEvent.click(screen.getByRole('button',{name:'下一张现场单'}))
    await screen.findByText('FH-next')
    await act(async()=>{reopen.resolve({...session,status:'weighing'})})
    expect(screen.getByText('FH-next')).toBeInTheDocument()
    expect(screen.queryByText('篮重修改页')).not.toBeInTheDocument()
  })
})

describe('现场称重单列表读取恢复',()=>{
  it('失败显示错误而不是空记录；重试保留筛选并显示真实结果',async()=>{
    const loader=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([session])
    render(<MemoryRouter><WeighingSessionsPage loader={loader}/></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('无法载入现场称重单。')
    expect(screen.queryByText('没有符合条件的现场称重单。')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('纸单号或系统现场单号'),'P-1')
    await userEvent.click(screen.getByRole('button',{name:'重试现场称重单'}))
    expect(await screen.findByText(session.sessionCode)).toBeInTheDocument()
    expect(screen.getByLabelText('纸单号或系统现场单号')).toHaveValue('P-1')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(loader).toHaveBeenCalledTimes(2)
  })

  it.each(['resolve','reject'] as const)('新的载入结果不受旧 %s 回包覆盖',async result=>{
    const old=deferred<WeighingSession[]>(),newLoader=vi.fn(async()=>[{...session,sessionCode:'FH-new'}])
    const view=render(<MemoryRouter><WeighingSessionsPage loader={()=>old.promise}/></MemoryRouter>)
    await act(async()=>{})
    view.rerender(<MemoryRouter><WeighingSessionsPage loader={newLoader}/></MemoryRouter>)
    await screen.findByText('FH-new')
    await act(async()=>{if(result==='resolve')old.resolve([session]);else old.reject(new Error('stale'))})
    expect(screen.getByText('FH-new')).toBeInTheDocument()
    expect(screen.queryByText(session.sessionCode)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
