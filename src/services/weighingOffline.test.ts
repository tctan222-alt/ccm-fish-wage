import { describe, expect, it, vi } from 'vitest'
import { buildWeighingEntry, newWeighingSession } from '../lib/weighing'
import {
  createMemoryWeighingStore,
  flushWeighingQueue,
  queueWeighingOperation,
  type PendingWeighingOperation,
} from './weighingOffline'

const session=()=>newWeighingSession({
  id:'session-1',
  productType:'fish_head',
  vesselId:'v978',
  vesselCodeSnapshot:'978',
  vesselNameSnapshot:'978',
  weighingDate:'2026-07-30',
})
const entry=()=>buildWeighingEntry({
  id:'entry-1',
  sessionId:'session-1',
  productType:'fish_head',
  fishSpeciesId:'jin_xian',
  fishMealQuality:null,
  entryMode:'individual',
  sequenceNo:1,
  weightGrams:80_000,
  remark:'',
  recordedAtClient:'2026-07-30T12:00:00.000+08:00',
  recordedAt:'2026-07-30T12:00:00.000+08:00',
  recordedBy:'admin',
})

describe('现场称重离线队列',()=>{
  it('先把每篮和待同步操作保存到持久存储，再尝试远端同步',async()=>{
    const shared=new Map<string,unknown>()
    const first=createMemoryWeighingStore(shared)
    await first.commitOperation({session:session(),entry:{...entry(),syncStatus:'syncing'},operation:{
      id:'entry_create_entry-1',type:'entry_create',sessionId:'session-1',entryId:'entry-1',
      createdAtClient:'2026-07-30T12:00:00.000+08:00',payload:{session:session(),entry:entry()},
    }})

    const reopened=createMemoryWeighingStore(shared)
    expect(await reopened.getEntries('session-1')).toEqual([
      expect.objectContaining({id:'entry-1',weightGrams:80_000,syncStatus:'syncing'}),
    ])
    expect(await reopened.getPending()).toHaveLength(1)
  })

  it('同步成功后清除 pending，重复重试不会再次建立同一篮',async()=>{
    const store=createMemoryWeighingStore()
    await store.putSession(session())
    await store.putEntry({...entry(),syncStatus:'syncing'})
    await queueWeighingOperation(store,operation('entry_create','entry_create_entry-1'))
    const sync=vi.fn().mockResolvedValue({session:session(),entry:entry()})

    await flushWeighingQueue(store,{sync})
    await flushWeighingQueue(store,{sync})

    expect(sync).toHaveBeenCalledOnce()
    expect(await store.getPending()).toHaveLength(0)
    expect(await store.getEntries('session-1')).toEqual([
      expect.objectContaining({id:'entry-1',syncStatus:'synced'}),
    ])
  })

  it('网络失败保留原始资料，并确保完成状态排在 entries 后同步',async()=>{
    const store=createMemoryWeighingStore()
    await queueWeighingOperation(store,operation('entry_create','one','2026-07-30T12:00:00.000+08:00'))
    await queueWeighingOperation(store,operation('complete','complete','2026-07-30T12:01:00.000+08:00'))
    const order:string[]=[]
    const sync=vi.fn(async(op:PendingWeighingOperation)=>{
      order.push(op.type)
      if(op.type==='entry_create')throw new Error('offline')
      return {}
    })

    const result=await flushWeighingQueue(store,{sync})

    expect(result).toEqual({synced:0,pending:2,failed:true,lastError:'offline'})
    expect(order).toEqual(['entry_create'])
    expect((await store.getPending()).map(item=>item.type)).toEqual(['entry_create','complete'])
  })

  it('当前单同步不被其他船的失败记录阻塞，也不会删除其他单的待同步记录',async()=>{
    const store=createMemoryWeighingStore()
    await store.putOperation({...operation('entry_create','old-error'),sessionId:'other-session'})
    await store.putOperation(operation('complete','complete-current','2026-07-30T12:01:00.000+08:00'))
    const sync=vi.fn(async(op:PendingWeighingOperation)=>{
      if(op.sessionId==='other-session')throw new Error('permission-denied')
      return {}
    })

    expect(await flushWeighingQueue(store,{sync,sessionId:'session-1'})).toEqual({synced:1,pending:0,failed:false,lastError:null})
    expect(sync.mock.calls.map(([op])=>op.id)).toEqual(['complete-current'])
    expect((await store.getPending()).map(op=>op.id)).toEqual(['old-error'])
  })

  it('同一时间的每篮写入仍先于完成操作，失败时不提前完成',async()=>{
    const store=createMemoryWeighingStore()
    await store.putOperation(operation('complete','complete-current'))
    await store.putOperation(operation('entry_create','entry-create'))
    const sync=vi.fn(async(op:PendingWeighingOperation)=>{
      if(op.type==='entry_create')throw new Error('offline')
      return {}
    })
    expect(await flushWeighingQueue(store,{sync})).toMatchObject({failed:true,pending:2})
    expect(sync.mock.calls.map(([op])=>op.type)).toEqual(['entry_create'])
  })

  it('重叠同步会排队并重新读取待同步项，不重复写篮子也不漏掉稍后加入的完成操作',async()=>{
    const store=createMemoryWeighingStore()
    await store.putOperation(operation('entry_create','entry-create'))
    let release!:()=>void
    const blocked=new Promise<void>(resolve=>{release=resolve})
    const sync=vi.fn(async(op:PendingWeighingOperation)=>{
      if(op.type==='entry_create')await blocked
      return {}
    })
    const first=flushWeighingQueue(store,{sync})
    await vi.waitFor(()=>expect(sync).toHaveBeenCalledOnce())
    await store.putOperation(operation('complete','complete-current','2026-07-30T12:01:00.000+08:00'))
    const second=flushWeighingQueue(store,{sync})
    release()
    await Promise.all([first,second])
    expect(sync.mock.calls.map(([op])=>op.type)).toEqual(['entry_create','complete'])
    expect(await store.getPending()).toHaveLength(0)
  })
})

function operation(type:PendingWeighingOperation['type'],id:string,createdAtClient='2026-07-30T12:00:00.000+08:00'):PendingWeighingOperation {
  return {id,type,sessionId:'session-1',entryId:type==='complete'?null:'entry-1',createdAtClient,payload:{}}
}
