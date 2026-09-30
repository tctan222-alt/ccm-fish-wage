import { act,cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { DEFAULT_VESSELS } from '../lib/purchasing'
import {
  applyEntryCreated,buildWeighingEntry,DEFAULT_FISH_SPECIES,newWeighingSession,weighingDraftKey,
  type FishSpeciesRecord,type WeighingEntry,type WeighingSession,
} from '../lib/weighing'
import { createMemoryWeighingStore,type PendingWeighingOperation } from '../services/weighingOffline'
import { savePurchaseSettlementDraft } from '../services/purchaseSettlements'
import { WeighingEntryPage } from './WeighingEntryPage'

vi.mock('../services/purchaseSettlements',()=>({savePurchaseSettlementDraft:vi.fn()}))

const date='2026-09-30',now='2026-09-30T04:00:00.000Z'
const vessels=DEFAULT_VESSELS.map(item=>({...item,id:`saved-${item.vesselCode}`,createdBy:'test-owner'}))
const unknownFish:FishSpeciesRecord={id:'unpriced',speciesCode:'unpriced',displayName:'未定价测试鱼',active:true,order:99,notes:''}

function setup(options:Partial<ComponentProps<typeof WeighingEntryPage>>={}){
  const store=options.offlineStore??createMemoryWeighingStore()
  const commit=vi.spyOn(store,'commitOperation')
  const sync=vi.fn(async(operation:PendingWeighingOperation)=>{
    const payload=operation.payload as {session:WeighingSession;entry:WeighingEntry}
    return operation.type==='entry_create'?{session:applyEntryCreated(payload.session,payload.entry),entry:payload.entry}:{}
  })
  let entryNo=0
  const props:ComponentProps<typeof WeighingEntryPage>={
    fixedProductType:'fish_head',pageTitle:'鱼头购入',offlineStore:store,remoteSync:sync,
    vesselLoader:async()=>vessels,speciesLoader:async()=>DEFAULT_FISH_SPECIES,
    vesselInitializer:async()=>vessels,speciesInitializer:async()=>DEFAULT_FISH_SPECIES,
    openSessionLoader:async()=>null,closedSessionLoader:async()=>null,
    bundleLoader:async()=>{throw new Error('offline')},today:()=>date,now:()=>now,
    idFactory:kind=>kind==='session'?'live-session':`entry-${++entryNo}`,...options,
  }
  render(<MemoryRouter><WeighingEntryPage {...props}/></MemoryRouter>)
  return {store,commit,sync}
}

async function saveBasket(weight:string,fishName?:string){
  if(fishName)fireEvent.click(within(screen.getByRole('group',{name:'鱼名'})).getByRole('button',{name:fishName}))
  fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:weight}})
  await waitFor(()=>expect(screen.getByRole('button',{name:'确认加入'})).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
  await waitFor(()=>expect(screen.getByLabelText('重量（kg）')).toHaveValue(''))
  await waitFor(()=>expect(screen.getByRole('button',{name:'确认加入'})).not.toBeDisabled())
}

function summaryRow(fishName:string){
  return within(screen.getByRole('region',{name:'现场汇总'})).getByRole('rowheader',{name:fishName}).closest('tr')!
}

afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks()})

describe('鱼头采购现场估值',()=>{
  it('保存一篮就显示默认价格和 half-up 金额，仍然称重且不写入价格快照',async()=>{
    const {store,commit,sync}=setup()
    await saveBasket('80.125')
    const summary=screen.getByRole('region',{name:'现场汇总'})
    for(const name of ['鱼名','篮数','总 kg','单价 RM/kg','金额 RM']){
      expect(within(summary).getByRole('columnheader',{name})).toBeInTheDocument()
    }
    expect(summaryRow('金线')).toHaveTextContent('RM 2.10/kg')
    expect(summaryRow('金线')).toHaveTextContent('RM 168.26')
    const total=screen.getByRole('group',{name:'现场金额总计'})
    expect(total).toHaveTextContent('当前总金额')
    expect(total).toHaveTextContent('RM 168.26')
    expect(await store.getSession('live-session')).toMatchObject({status:'weighing'})
    expect(commit).toHaveBeenCalledOnce()
    const entry=commit.mock.calls[0][0].entry!
    expect(entry).not.toHaveProperty('unitPriceCentsPerKg')
    expect(entry).not.toHaveProperty('amountCents')
    expect(sync.mock.calls.map(([operation])=>operation.type)).toEqual(['entry_create'])
    expect(savePurchaseSettlementDraft).not.toHaveBeenCalled()
    expect(screen.queryByRole('link',{name:/结单/})).not.toBeInTheDocument()
  })

  it('多篮同鱼合并，新增另一鱼种后即时更新整单篮数、kg 和金额',async()=>{
    setup()
    await saveBasket('80.5')
    await saveBasket('20.5')
    await saveBasket('10','来戈')
    const gold=summaryRow('金线'),lai=summaryRow('来戈')
    expect(gold).toHaveTextContent('2 篮')
    expect(gold).toHaveTextContent('101 kg')
    expect(gold).toHaveTextContent('RM 212.10')
    expect(lai).toHaveTextContent('1 篮')
    expect(lai).toHaveTextContent('10 kg')
    expect(lai).toHaveTextContent('RM 2.50/kg')
    expect(lai).toHaveTextContent('RM 25.00')
    const total=screen.getByRole('group',{name:'现场金额总计'})
    expect(total).toHaveTextContent('3 篮')
    expect(total).toHaveTextContent('111 kg')
    expect(total).toHaveTextContent('当前总金额：RM 237.10')
    expect(total).not.toHaveTextContent('未定价')
  })

  it('无默认价鱼种可继续保存，行内显示破折号，总计明确只包含已知金额',async()=>{
    const {store}=setup({speciesLoader:async()=>[...DEFAULT_FISH_SPECIES,unknownFish]})
    await saveBasket('2')
    await saveBasket('4',unknownFish.displayName)
    const unknown=summaryRow(unknownFish.displayName)
    expect(within(unknown).getAllByRole('cell',{name:'—'})).toHaveLength(2)
    expect(unknown).not.toHaveTextContent('RM 0.00')
    expect(summaryRow('金线')).toHaveTextContent('RM 4.20')
    const total=screen.getByRole('group',{name:'现场金额总计'})
    expect(total).toHaveTextContent('2 篮')
    expect(total).toHaveTextContent('6 kg')
    expect(total).toHaveTextContent('已知金额：RM 4.20')
    expect(total).toHaveTextContent('尚有 1 个鱼种未定价')
    expect(total).not.toHaveTextContent('当前总金额')
    expect(await store.getEntries('live-session')).toHaveLength(2)
    expect(await store.getSession('live-session')).toMatchObject({status:'weighing'})
  })

  it('现有撤回和作废都会移除该篮估值，全部作废时隐藏现场汇总且记录仍保留',async()=>{
    const {store}=setup()
    vi.spyOn(window,'confirm').mockReturnValue(true)
    await saveBasket('10')
    await saveBasket('20')
    expect(screen.getByRole('group',{name:'现场金额总计'})).toHaveTextContent('RM 63.00')
    fireEvent.click(screen.getByRole('button',{name:'撤回'}))
    await waitFor(()=>expect(screen.getByRole('group',{name:'现场金额总计'})).toHaveTextContent('RM 21.00'))
    expect(summaryRow('金线')).toHaveTextContent('1 篮')
    expect(summaryRow('金线')).toHaveTextContent('10 kg')
    const history=screen.getByRole('heading',{name:'完整历史记录'}).closest('section')!
    fireEvent.click(within(history).getByRole('button',{name:/第 1 篮.*金线/}))
    fireEvent.change(screen.getByLabelText('作废原因'),{target:{value:'重复称重'}})
    fireEvent.click(screen.getByRole('button',{name:'作废'}))
    await waitFor(()=>expect(screen.queryByRole('region',{name:'现场汇总'})).not.toBeInTheDocument())
    const entries=await store.getEntries('live-session')
    expect(entries).toHaveLength(2)
    expect(entries.every(entry=>entry.voided)).toBe(true)
  })

  it('通过现有记录编辑修改鱼名和 kg 后重新计算当前默认价，不残留旧鱼汇总',async()=>{
    const {store}=setup()
    await saveBasket('10')
    const history=screen.getByRole('heading',{name:'完整历史记录'}).closest('section')!
    fireEvent.click(within(history).getByRole('button',{name:/第 1 篮.*金线/}))
    const dialog=screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button',{name:'来戈'}))
    fireEvent.change(within(dialog).getByLabelText('重量（kg）'),{target:{value:'12.5'}})
    fireEvent.click(within(dialog).getByRole('button',{name:'保存修改'}))
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(summaryRow('来戈')).toHaveTextContent('12.5 kg')
    expect(summaryRow('来戈')).toHaveTextContent('RM 2.50/kg')
    expect(summaryRow('来戈')).toHaveTextContent('RM 31.25')
    expect(within(screen.getByRole('region',{name:'现场汇总'})).queryByRole('rowheader',{name:'金线'})).not.toBeInTheDocument()
    expect(screen.getByRole('group',{name:'现场金额总计'})).toHaveTextContent('当前总金额：RM 31.25')
    expect(await store.getEntries('live-session')).toEqual([expect.objectContaining({revision:2,weightGrams:12500,fishSpeciesCodeSnapshot:'lai_ge'})])
  })

  it('缓存现场单在主资料及原单核对延迟 3 秒时立即显示价格，仍允许输入但等待核对才保存',async()=>{
    vi.useFakeTimers()
    const store=createMemoryWeighingStore()
    const base=newWeighingSession({id:'cached-live',productType:'fish_head',vesselId:'saved-978',
      vesselCodeSnapshot:'978',vesselNameSnapshot:'978',weighingDate:date})
    const entry=buildWeighingEntry({id:'cached-entry',sessionId:base.id,productType:'fish_head',
      fishSpeciesId:'jin_xian',fishMealQuality:null,entryMode:'individual',sequenceNo:1,weightGrams:80000,
      remark:'',recordedAtClient:now,recordedAt:now,recordedBy:'test-owner'})
    const session=applyEntryCreated(base,entry)
    await store.putSession(session)
    await store.putEntry(entry)
    await store.putMeta(weighingDraftKey('fish_head',date,'saved-978'),session.id)
    await store.putMeta('reference:vessels',JSON.stringify(vessels))
    await store.putMeta('reference:species',JSON.stringify(DEFAULT_FISH_SPECIES))
    await store.putMeta('lastVesselId','saved-978')
    const afterThreeSeconds=<T,>(value:T)=>new Promise<T>(resolve=>setTimeout(()=>resolve(value),3000))
    const vesselLoader=vi.fn(()=>afterThreeSeconds(vessels)),speciesLoader=vi.fn(()=>afterThreeSeconds(DEFAULT_FISH_SPECIES))
    const bundleLoader=vi.fn(()=>afterThreeSeconds({session,entries:[entry]}))
    const {commit}=setup({offlineStore:store,vesselLoader,speciesLoader,bundleLoader})
    await act(async()=>{})
    expect(summaryRow('金线')).toHaveTextContent('RM 2.10/kg')
    expect(screen.getByRole('group',{name:'现场金额总计'})).toHaveTextContent('RM 168.00')
    fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:'25.5'}})
    await act(async()=>{await vi.advanceTimersByTimeAsync(2999)})
    expect(screen.getByLabelText('重量（kg）')).toHaveValue('25.5')
    expect(screen.getByLabelText('重量（kg）')).not.toBeDisabled()
    expect(screen.getByRole('button',{name:'确认加入'})).toBeDisabled()
    expect(summaryRow('金线')).toHaveTextContent('RM 168.00')
    expect(commit).not.toHaveBeenCalled()
    await act(async()=>{await vi.advanceTimersByTimeAsync(1)})
    expect(screen.getByRole('button',{name:'确认加入'})).not.toBeDisabled()
    expect(screen.getByLabelText('重量（kg）')).toHaveValue('25.5')
    expect(vesselLoader).toHaveBeenCalledOnce()
    expect(speciesLoader).toHaveBeenCalledOnce()
    expect(bundleLoader).toHaveBeenCalledOnce()
    expect(savePurchaseSettlementDraft).not.toHaveBeenCalled()
  })
})
