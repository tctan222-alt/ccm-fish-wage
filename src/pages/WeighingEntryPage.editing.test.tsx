import { act,cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { asSettlementSourceEntry,buildPurchaseSettlementLines,formatSettlementMoney } from '../lib/purchaseSettlement'
import { DEFAULT_VESSELS } from '../lib/purchasing'
import {
  applyEntryCreated,applyEntryReplacement,buildWeighingEntry,DEFAULT_FISH_SPECIES,newWeighingSession,
  softVoidWeighingEntry,weighingDraftKey,type WeighingEntry,type WeighingSession,
} from '../lib/weighing'
import type { WeighingBundle } from '../services/weighing'
import { createMemoryWeighingStore,type PendingWeighingOperation } from '../services/weighingOffline'
import { WeighingEntryPage } from './WeighingEntryPage'

const date='2026-09-30',now='2026-09-30T04:00:00.000Z',sessionId='editable-session'
const vessels=DEFAULT_VESSELS.map(item=>({...item,id:`saved-${item.vesselCode}`,createdBy:'test-owner'}))
type SyncResult={session?:WeighingSession;entry?:WeighingEntry}

function deferred<T>(){
  let resolve!:(value:T)=>void
  const promise=new Promise<T>(done=>{resolve=done})
  return {promise,resolve}
}

function seed(weights:number[],vesselCode='833',status:WeighingSession['status']='weighing'):WeighingBundle{
  let session=newWeighingSession({id:sessionId,productType:'fish_head',vesselId:`saved-${vesselCode}`,
    vesselCodeSnapshot:vesselCode,vesselNameSnapshot:vesselCode,weighingDate:date})
  const entries=weights.map((weightGrams,index)=>{
    const entry=buildWeighingEntry({id:`basket-${index+1}`,sessionId,productType:'fish_head',
      fishSpeciesId:'jin_xian',fishMealQuality:null,entryMode:'individual',sequenceNo:index+1,weightGrams,
      weighingDate:session.weighingDate,monthKey:session.monthKey,vesselId:session.vesselId,vesselCodeSnapshot:vesselCode,
      remark:'原备注',recordedAtClient:now,recordedAt:now,recordedBy:'original-owner'})
    session=applyEntryCreated(session,entry)
    return entry
  })
  return {session:{...session,status,...(status==='weighing'?{}:{completedAt:new Date(now)})},entries}
}

function server(initial?:WeighingBundle){
  let current=initial?.session
  const entries=new Map(initial?.entries.map(entry=>[entry.id,entry])??[])
  return {
    entries,
    get session(){return current},
    apply(operation:PendingWeighingOperation):SyncResult{
      if(operation.type==='entry_create'){
        const {session,entry}=operation.payload as {session:WeighingSession;entry:WeighingEntry}
        current=applyEntryCreated(current??session,entry)
        entries.set(entry.id,entry)
        return {session:current,entry}
      }
      const {before,after}=operation.payload as {before:WeighingEntry;after:WeighingEntry}
      if(!current)throw new Error('Missing session')
      current=operation.type==='entry_void'
        ?softVoidWeighingEntry(current,before,after.voidReason!).session
        :applyEntryReplacement(current,before,after)
      entries.set(after.id,after)
      return {session:current,entry:after}
    },
  }
}

async function setup(initial?:WeighingBundle,options:Partial<ComponentProps<typeof WeighingEntryPage>>={}){
  const store=options.offlineStore??createMemoryWeighingStore()
  if(initial){
    await store.putSession(initial.session)
    for(const entry of initial.entries)await store.putEntry(entry)
    await store.putMeta(weighingDraftKey('fish_head',date,initial.session.vesselId),sessionId)
  }
  await store.putMeta('lastVesselId',initial?.session.vesselId??'saved-833')
  const remote=server(initial),sync=vi.fn(async(operation:PendingWeighingOperation)=>remote.apply(operation))
  const commit=vi.spyOn(store,'commitOperation')
  let entryNumber=initial?.entries.length??0
  render(<MemoryRouter><WeighingEntryPage fixedProductType="fish_head" pageTitle="鱼头购入"
    offlineStore={store} remoteSync={sync} vesselLoader={async()=>vessels} speciesLoader={async()=>DEFAULT_FISH_SPECIES}
    vesselInitializer={async()=>vessels} speciesInitializer={async()=>DEFAULT_FISH_SPECIES}
    openSessionLoader={async()=>null} closedSessionLoader={async()=>null}
    bundleLoader={async()=>{if(initial)return initial;throw new Error('offline')}}
    today={()=>date} now={()=>now} idFactory={kind=>kind==='session'?sessionId:`basket-${++entryNumber}`}
    {...options}/></MemoryRouter>)
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'船号'})).toHaveValue(initial?.session.vesselId??'saved-833'))
  if(initial)await waitFor(()=>expect(historyButton(1)).toBeInTheDocument())
  else await waitFor(()=>expect(screen.getByRole('button',{name:'确认加入'})).not.toBeDisabled())
  return {store,commit,remote,sync}
}

function historyButton(sequence:number){
  const history=screen.getByRole('heading',{name:'完整历史记录'}).closest('section')!
  return within(history).getByRole('button',{name:new RegExp(`第 ${sequence} 篮`)})
}

function openBasket(sequence:number){fireEvent.click(historyButton(sequence));return screen.getByRole('dialog')}
function totals(){return screen.getByRole('group',{name:'现场金额总计'})}
function summaryRow(name:string){return within(screen.getByRole('region',{name:'现场汇总'})).getByRole('rowheader',{name}).closest('tr')!}
function recent(){return screen.getByText('最近一篮').closest('.recent-entry')!}
async function saveEdit(dialog:HTMLElement,weight:string){
  fireEvent.change(within(dialog).getByLabelText('重量（kg）'),{target:{value:weight}})
  fireEvent.click(within(dialog).getByRole('button',{name:'保存修改'}))
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}
async function addBasket(weight:string){
  fireEvent.change(screen.getByLabelText('重量（kg）'),{target:{value:weight}})
  fireEvent.click(screen.getByRole('button',{name:'确认加入'}))
  await waitFor(()=>expect(historyButton(1)).toBeInTheDocument())
}

afterEach(()=>{cleanup();vi.restoreAllMocks()})

describe('鱼头称重中任意篮编辑',()=>{
  it('任意较早一篮可直接改 kg，保留身份及录入资料，原位置显示修订和精确合计',async()=>{
    const initial=seed([74500,10000,12000]),{store,commit}=await setup(initial)
    const dialog=openBasket(1)
    expect(within(dialog).getByRole('heading',{name:'编辑第 1 篮'})).toBeInTheDocument()
    expect(dialog).toHaveTextContent('金线')
    expect(dialog).toHaveTextContent('74.5 kg')
    expect(dialog).toHaveTextContent('12:00')
    expect(dialog).toHaveTextContent('修订版本：1')
    expect(dialog).toHaveTextContent('已同步')
    await saveEdit(dialog,'72.3')
    expect(historyButton(1)).toHaveTextContent('72.3 kg')
    expect(historyButton(2)).toHaveTextContent('10 kg')
    expect(recent()).toHaveTextContent('12 kg')
    expect(totals()).toHaveTextContent('3 篮')
    expect(totals()).toHaveTextContent('94.3 kg')
    expect(totals()).toHaveTextContent('RM 193.32')
    await waitFor(async()=>expect(await store.getPending()).toHaveLength(0))
    const entries=await store.getEntries(sessionId),edited=entries.find(entry=>entry.sequenceNo===1)!
    expect(entries).toHaveLength(3)
    expect(edited).toMatchObject({...initial.entries[0],weightGrams:72300,revision:2,syncStatus:'synced'})
    expect(edited).not.toHaveProperty('unitPriceCentsPerKg')
    expect(edited).not.toHaveProperty('amountCents')
    expect(await store.getSession(sessionId)).toMatchObject({fishHeadBasketCount:3,totalWeightGrams:94300,revision:5})
    expect(commit).toHaveBeenCalledOnce()
    expect(commit.mock.calls[0][0].operation).toMatchObject({type:'entry_update',entryId:'basket-1',
      payload:{before:{revision:1,weightGrams:74500},after:{revision:2,weightGrams:72300}}})
  })

  it('最新一篮修改 kg 后最近一篮和金额立即更新，不建立第二条记录',async()=>{
    const {store}=await setup(seed([20000,100000]))
    await saveEdit(openBasket(2),'80')
    expect(recent()).toHaveTextContent('80 kg')
    expect(totals()).toHaveTextContent('2 篮')
    expect(totals()).toHaveTextContent('100 kg')
    expect(totals()).toHaveTextContent('RM 205.00')
    expect(await store.getEntries(sessionId)).toHaveLength(2)
    expect((await store.getEntries(sessionId)).find(entry=>entry.id==='basket-2')).toMatchObject({revision:2,weightGrams:80000})
  })

  it('编辑 legacy 价格篮保留原单号及 before 审计事实，但新版本不保存采购价格快照',async()=>{
    const initial=seed([100000])
    initial.entries[0]={...initial.entries[0],receiptNoSnapshot:'LEGACY-FH-001',unitPriceCentsPerKg:100,amountCents:10000}
    const {store,commit}=await setup(initial),dialog=openBasket(1)
    expect(totals()).toHaveTextContent('RM 205.00')
    fireEvent.click(within(dialog).getByRole('button',{name:'来戈'}))
    await saveEdit(dialog,'80')
    expect(summaryRow('来戈')).toHaveTextContent('RM 2.45/kg')
    expect(totals()).toHaveTextContent('RM 196.00')
    const entry=(await store.getEntries(sessionId))[0]
    expect(entry).toMatchObject({receiptNoSnapshot:'LEGACY-FH-001',revision:2,weightGrams:80000,
      recordedAtClient:now,recordedAt:now,recordedBy:'original-owner',remark:'原备注'})
    expect(entry).not.toHaveProperty('unitPriceCentsPerKg')
    expect(entry).not.toHaveProperty('amountCents')
    const {before,after}=commit.mock.calls[0][0].operation.payload as {before:WeighingEntry;after:WeighingEntry}
    expect(before).toMatchObject({unitPriceCentsPerKg:100,amountCents:10000,receiptNoSnapshot:'LEGACY-FH-001'})
    expect(after).not.toHaveProperty('unitPriceCentsPerKg')
    expect(after).not.toHaveProperty('amountCents')
  })

  it.each([['833','RM 205.00','RM 164.00',245,19600],['978','RM 210.00','RM 168.00',250,20000],
    ['5202','RM 210.00','RM 168.00',250,20000]] as const)('%s 船改 kg 再改鱼时与正式结单的默认价及金额完全一致',async(vesselCode,firstAmount,editedAmount,price,amount)=>{
    const {store}=await setup(seed([100000],vesselCode))
    expect(totals()).toHaveTextContent(firstAmount)
    await saveEdit(openBasket(1),'80')
    expect(totals()).toHaveTextContent(editedAmount)
    const dialog=openBasket(1)
    fireEvent.click(within(dialog).getByRole('button',{name:'来戈'}))
    await saveEdit(dialog,'80')
    const row=summaryRow('来戈')
    expect(row).toHaveTextContent('1 篮')
    expect(row).toHaveTextContent('80 kg')
    expect(row).toHaveTextContent(`${formatSettlementMoney(price)}/kg`)
    expect(row).toHaveTextContent(formatSettlementMoney(amount))
    expect(within(screen.getByRole('region',{name:'现场汇总'})).queryByRole('rowheader',{name:'金线'})).not.toBeInTheDocument()
    const entries=await store.getEntries(sessionId)
    const settlement=buildPurchaseSettlementLines(entries.map(asSettlementSourceEntry),'fish_head',vesselCode)
    expect(settlement).toEqual([expect.objectContaining({nameSnapshot:'来戈',totalWeightGrams:80000,
      defaultUnitPriceCentsPerKg:price,amountCents:amount,sourceEntryIds:['basket-1']})])
    expect(totals()).toHaveTextContent(formatSettlementMoney(settlement[0].amountCents))
    expect(entries[0]).toMatchObject({revision:3,fishSpeciesCodeSnapshot:'lai_ge'})
    expect(entries[0]).not.toHaveProperty('unitPriceCentsPerKg')
    expect(entries[0]).not.toHaveProperty('amountCents')
  })

  it('删除较早篮前确认明确鱼名和 kg；取消无副作用，确认后原记录及修订仍保留',async()=>{
    const {store,commit}=await setup(seed([72300,10000]))
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(false),dialog=openBasket(1)
    expect(dialog).toHaveTextContent('审计')
    fireEvent.change(within(dialog).getByLabelText('删除原因（选填）'),{target:{value:'重复录入'}})
    fireEvent.click(within(dialog).getByRole('button',{name:'删除此篮'}))
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/第 1 篮[\s\S]*金线[\s\S]*72\.3 kg/))
    expect(commit).not.toHaveBeenCalled()
    expect(totals()).toHaveTextContent('2 篮')
    confirm.mockReturnValue(true)
    fireEvent.click(within(dialog).getByRole('button',{name:'删除此篮'}))
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(totals()).toHaveTextContent('1 篮')
    expect(totals()).toHaveTextContent('10 kg')
    expect(totals()).toHaveTextContent('RM 20.50')
    expect(recent()).toHaveTextContent('10 kg')
    const entries=await store.getEntries(sessionId)
    expect(entries).toHaveLength(2)
    expect(entries.find(entry=>entry.sequenceNo===1)).toMatchObject({voided:true,voidReason:'重复录入',revision:2,weightGrams:72300})
    expect(buildPurchaseSettlementLines(entries.map(asSettlementSourceEntry),'fish_head','833')[0].sourceEntryIds).toEqual(['basket-2'])
    expect(commit).toHaveBeenCalledOnce()
    expect(commit.mock.calls[0][0].operation.type).toBe('entry_void')
  })

  it('删除最新篮后撤回只处理前一个 active 篮，保留两个 soft-void 记录且不能再次撤回',async()=>{
    const {store}=await setup(seed([20000,10000])),confirm=vi.spyOn(window,'confirm').mockReturnValue(true)
    fireEvent.click(within(openBasket(2)).getByRole('button',{name:'删除此篮'}))
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(recent()).toHaveTextContent('20 kg')
    expect(recent()).not.toHaveTextContent('10 kg')
    expect(totals()).toHaveTextContent('RM 41.00')
    fireEvent.click(screen.getByRole('button',{name:'撤回'}))
    expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/撤回最近一篮.*金线.*20 kg/))
    await waitFor(()=>expect(screen.queryByRole('region',{name:'现场汇总'})).not.toBeInTheDocument())
    expect(recent()).toHaveTextContent('尚无记录')
    expect(screen.getByRole('button',{name:'撤回'})).toBeDisabled()
    const entries=await store.getEntries(sessionId)
    expect(entries).toHaveLength(2)
    expect(entries.every(entry=>entry.voided&&entry.revision===2)).toBe(true)
    expect(entries.find(entry=>entry.sequenceNo===1)?.voidReason).toBe('撤回上一篮')
    expect(buildPurchaseSettlementLines(entries.map(asSettlementSourceEntry),'fish_head','833')).toEqual([])
  })

  it.each(['0','300.001','72.3333'])('编辑拒绝无效 kg %s，保留原篮及总额并显示错误',async weight=>{
    const {commit,store}=await setup(seed([74500])),dialog=openBasket(1)
    fireEvent.change(within(dialog).getByLabelText('重量（kg）'),{target:{value:weight}})
    fireEvent.click(within(dialog).getByRole('button',{name:'保存修改'}))
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    expect(commit).not.toHaveBeenCalled()
    expect(await store.getEntries(sessionId)).toEqual([expect.objectContaining({weightGrams:74500,revision:1})])
    expect(totals()).toHaveTextContent('RM 152.73')
  })

  it('本地保存修改尚未完成时连续点击保存只排入一次更新',async()=>{
    const store=createMemoryWeighingStore(),hold=deferred<void>(),commitOriginal=store.commitOperation.bind(store)
    vi.spyOn(store,'commitOperation').mockImplementation(async value=>{await hold.promise;await commitOriginal(value)})
    const {commit}=await setup(seed([100000]),{offlineStore:store}),dialog=openBasket(1)
    fireEvent.change(within(dialog).getByLabelText('重量（kg）'),{target:{value:'80'}})
    const save=within(dialog).getByRole('button',{name:'保存修改'})
    fireEvent.click(save);fireEvent.click(save)
    expect(save).toBeDisabled()
    expect(within(dialog).getByRole('button',{name:'删除此篮'})).toBeDisabled()
    await waitFor(()=>expect(commit).toHaveBeenCalledOnce())
    await act(async()=>{hold.resolve()})
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await store.getEntries(sessionId)).toEqual([expect.objectContaining({weightGrams:80000,revision:2})])
  })

  it('本机保存失败保留编辑内容并显示具体错误，恢复后可重试且只产生一个更新',async()=>{
    const store=createMemoryWeighingStore(),commitOriginal=store.commitOperation.bind(store)
    vi.spyOn(store,'commitOperation').mockRejectedValueOnce(new Error('本机空间不足')).mockImplementation(commitOriginal)
    const {sync}=await setup(seed([100000]),{offlineStore:store}),dialog=openBasket(1)
    fireEvent.change(within(dialog).getByLabelText('重量（kg）'),{target:{value:'80'}})
    fireEvent.click(within(dialog).getByRole('button',{name:'保存修改'}))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('本机空间不足')
    expect(within(dialog).getByLabelText('重量（kg）')).toHaveValue('80')
    expect(within(dialog).getByRole('button',{name:'保存修改'})).not.toBeDisabled()
    expect(historyButton(1)).toHaveTextContent('100 kg')
    expect(totals()).toHaveTextContent('RM 205.00')
    expect(await store.getPending()).toHaveLength(0)
    expect(sync).not.toHaveBeenCalled()
    await saveEdit(dialog,'80')
    await waitFor(async()=>expect(await store.getPending()).toHaveLength(0))
    expect(await store.getEntries(sessionId)).toEqual([expect.objectContaining({weightGrams:80000,revision:2})])
    expect(sync).toHaveBeenCalledOnce()
  })

  it.each(['edit','delete'] as const)('新增篮 pending 时立即 %s，迟到的 create ack 不覆盖新本机状态且最终不重复',async action=>{
    const createGate=deferred<void>(),mutationGate=deferred<void>(),remote=server()
    const sync=vi.fn(async(operation:PendingWeighingOperation)=>{
      await (operation.type==='entry_create'?createGate.promise:mutationGate.promise)
      return remote.apply(operation)
    })
    const {store,commit}=await setup(undefined,{remoteSync:sync})
    await addBasket('100')
    await waitFor(()=>expect(sync).toHaveBeenCalledOnce())
    const dialog=openBasket(1)
    expect(dialog).toHaveTextContent('已保存在本机，等待同步')
    if(action==='edit')await saveEdit(dialog,'80')
    else{
      vi.spyOn(window,'confirm').mockReturnValue(true)
      fireEvent.click(within(dialog).getByRole('button',{name:'删除此篮'}))
      await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
    const assertLatest=async()=>{
      const entries=await store.getEntries(sessionId)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({id:'basket-1',revision:2,voided:action==='delete',weightGrams:action==='edit'?80000:100000})
      expect(await store.getSession(sessionId)).toMatchObject({fishHeadBasketCount:action==='edit'?1:0,totalWeightGrams:action==='edit'?80000:0})
      if(action==='edit')expect(totals()).toHaveTextContent('RM 164.00')
      else expect(screen.queryByRole('region',{name:'现场汇总'})).not.toBeInTheDocument()
    }
    await assertLatest()
    expect((await store.getPending()).map(operation=>operation.type)).toEqual(['entry_create',action==='edit'?'entry_update':'entry_void'])
    await act(async()=>{createGate.resolve()})
    await waitFor(()=>expect(sync).toHaveBeenCalledTimes(2))
    await assertLatest()
    expect((await store.getEntries(sessionId))[0].syncStatus).not.toBe('synced')
    await act(async()=>{mutationGate.resolve()})
    await waitFor(async()=>expect(await store.getPending()).toHaveLength(0))
    await assertLatest()
    expect((await store.getEntries(sessionId))[0].syncStatus).toBe('synced')
    expect(remote.entries.size).toBe(1)
    expect(remote.session).toMatchObject({fishHeadBasketCount:action==='edit'?1:0,totalWeightGrams:action==='edit'?80000:0})
    expect(sync.mock.calls.map(([operation])=>operation.type)).toEqual(['entry_create',action==='edit'?'entry_update':'entry_void'])
    expect(commit).toHaveBeenCalledTimes(2)
  })

  it('pending 新增后修改再删除，三个远端 ack 依序到达时不会复活或重复这一篮',async()=>{
    const gates={entry_create:deferred<void>(),entry_update:deferred<void>(),entry_void:deferred<void>()},remote=server()
    const sync=vi.fn(async(operation:PendingWeighingOperation)=>{
      if(operation.type==='complete')throw new Error('Unexpected completion')
      await gates[operation.type].promise
      return remote.apply(operation)
    })
    const {store,commit}=await setup(undefined,{remoteSync:sync})
    await addBasket('100')
    await saveEdit(openBasket(1),'80')
    vi.spyOn(window,'confirm').mockReturnValue(true)
    fireEvent.click(within(openBasket(1)).getByRole('button',{name:'删除此篮'}))
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await store.getEntries(sessionId)).toEqual([expect.objectContaining({voided:true,revision:3,weightGrams:80000})])
    expect((await store.getPending()).map(operation=>operation.type)).toEqual(['entry_create','entry_update','entry_void'])
    for(const [index,type] of (['entry_create','entry_update','entry_void'] as const).entries()){
      await act(async()=>{gates[type].resolve()})
      if(index<2)await waitFor(()=>expect(sync).toHaveBeenCalledTimes(index+2))
      else await waitFor(async()=>expect(await store.getPending()).toHaveLength(0))
      expect(await store.getEntries(sessionId)).toEqual([expect.objectContaining({voided:true,revision:3,weightGrams:80000})])
      expect(await store.getSession(sessionId)).toMatchObject({fishHeadBasketCount:0,totalWeightGrams:0})
      expect(screen.queryByRole('region',{name:'现场汇总'})).not.toBeInTheDocument()
      expect(recent()).toHaveTextContent('尚无记录')
    }
    expect(remote.entries.size).toBe(1)
    expect(remote.entries.get('basket-1')).toMatchObject({voided:true,revision:3,weightGrams:80000})
    expect(remote.session).toMatchObject({fishHeadBasketCount:0,totalWeightGrams:0})
    expect(sync.mock.calls.map(([operation])=>operation.type)).toEqual(['entry_create','entry_update','entry_void'])
    expect(commit).toHaveBeenCalledTimes(3)
    expect((await store.getEntries(sessionId))[0].syncStatus).toBe('synced')
  })

  it.each(['edit','delete'] as const)('离线 %s 保留本机内容和明确状态，手动 retry 成功且不追加第二次操作',async action=>{
    const initial=seed([100000]),remote=server(initial)
    let online=false
    const sync=vi.fn(async(operation:PendingWeighingOperation)=>{if(!online)throw new Error('离线测试');return remote.apply(operation)})
    const {store,commit}=await setup(initial,{remoteSync:sync})
    if(action==='edit')await saveEdit(openBasket(1),'80')
    else{
      vi.spyOn(window,'confirm').mockReturnValue(true)
      fireEvent.click(within(openBasket(1)).getByRole('button',{name:'删除此篮'}))
      await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
    expect(await screen.findByText(action==='edit'?'修改已保存在本机，等待同步':'删除已保存在本机，等待同步')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('记录仍保留在本机')
    if(action==='edit')expect(totals()).toHaveTextContent('RM 164.00')
    else expect(screen.queryByRole('region',{name:'现场汇总'})).not.toBeInTheDocument()
    expect(await store.getEntries(sessionId)).toEqual([expect.objectContaining({weightGrams:action==='edit'?80000:100000,voided:action==='delete',revision:2})])
    const pending=await store.getPending()
    expect(pending).toHaveLength(1)
    online=true
    fireEvent.click(screen.getByRole('button',{name:'重新同步'}))
    await waitFor(async()=>expect(await store.getPending()).toHaveLength(0))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(remote.entries.get('basket-1')).toMatchObject({weightGrams:action==='edit'?80000:100000,voided:action==='delete',revision:2})
    expect(remote.session).toMatchObject({totalWeightGrams:action==='edit'?80000:0,fishHeadBasketCount:action==='edit'?1:0})
    expect(commit).toHaveBeenCalledOnce()
    expect(sync).toHaveBeenCalledTimes(2)
    expect(sync.mock.calls.map(([operation])=>operation.id)).toEqual([pending[0].id,pending[0].id])
    if(action==='edit')expect(totals()).toHaveTextContent('RM 164.00')
    else expect(screen.queryByRole('region',{name:'现场汇总'})).not.toBeInTheDocument()
  })

  it.each(['completed','processed'] as const)('%s 记录在现场仅能查看，kg/鱼种/删除/撤回全部锁定',async status=>{
    const {commit}=await setup(seed([74500],'833',status)),dialog=openBasket(1)
    expect(within(dialog).getByLabelText('重量（kg）')).toBeDisabled()
    expect(within(dialog).getByRole('button',{name:'来戈'})).toBeDisabled()
    expect(within(dialog).queryByRole('button',{name:'保存修改'})).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button',{name:'删除此篮'})).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'撤回'})).toBeDisabled()
    fireEvent.submit(within(dialog).getByLabelText('重量（kg）').closest('form')!)
    await act(async()=>{})
    expect(commit).not.toHaveBeenCalled()
    if(status==='completed')expect(screen.getByRole('link',{name:'修改称重（完成后 7 天内）'})).toHaveAttribute('href',`/weighing/${sessionId}/review`)
  })
})
