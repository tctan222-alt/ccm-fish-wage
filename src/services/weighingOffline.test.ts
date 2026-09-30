import { describe, expect, it, vi } from 'vitest'
import { applyEntryCreated, applyEntryReplacement, buildWeighingEntry, newWeighingSession,
  softVoidWeighingEntry, type WeighingEntry, type WeighingSession } from '../lib/weighing'
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

  it('同毫秒连续修改按数值 revision 同步，不能把第 10 版排在第 2 版前',async()=>{
    const store=createMemoryWeighingStore(),remote=remoteLedger()
    let current=entry(),currentSession=applyEntryCreated(session(),current)
    await store.commitOperation({session:currentSession,entry:current,operation:createOperation(current)})
    for(let revision=2;revision<=11;revision++){
      const after={...current,revision,weightGrams:80_000+revision}
      currentSession=applyEntryReplacement(currentSession,current,after)
      await store.commitOperation({session:currentSession,entry:after,operation:changeOperation(current,after)})
      current=after
    }

    expect(await flushWeighingQueue(store,{sync:remote.sync})).toMatchObject({failed:false,pending:0,synced:11})
    expect(remote.sync.mock.calls.map(([op])=>op.type==='entry_create'?1:(op.payload as {after:WeighingEntry}).after.revision))
      .toEqual([1,2,3,4,5,6,7,8,9,10,11])
    expect(remote.currentEntry()).toMatchObject({revision:11,weightGrams:80_011})
  })

  it.each(['update','void','update then void'] as const)('create 在同步中时 %s 保留最新本机资料，随后按顺序同步',async change=>{
    const store=createMemoryWeighingStore(),remote=remoteLedger(),created=entry()
    const createdSession=applyEntryCreated(session(),created)
    await store.commitOperation({session:createdSession,entry:created,operation:createOperation(created)})
    const gate=deferred(),started=deferred()
    const first=flushWeighingQueue(store,{sync:async op=>{
      const response=await remote.sync(op);started.resolve();await gate.promise;return response
    }})
    await started.promise
    let latest=created,latestSession=createdSession
    if(change!=='void'){
      const after={...latest,weightGrams:72_300,revision:latest.revision+1,syncStatus:'syncing' as const}
      latestSession=applyEntryReplacement(latestSession,latest,after)
      await store.commitOperation({session:latestSession,entry:after,operation:changeOperation(latest,after)})
      latest=after
    }
    if(change!=='update'){
      const next=softVoidWeighingEntry(latestSession,latest,'删除错误篮')
      latestSession=next.session
      await store.commitOperation({session:latestSession,entry:{...next.entry,syncStatus:'syncing'},
        operation:changeOperation(latest,next.entry,'entry_void')})
      latest=next.entry
    }
    gate.resolve();await first
    expect(await store.getEntries('session-1')).toEqual([expect.objectContaining({
      weightGrams:latest.weightGrams,revision:latest.revision,voided:latest.voided,syncStatus:'syncing',
    })])
    expect(await store.getSession('session-1')).toEqual(latestSession)
    expect((await store.getPending()).length).toBe(change==='update then void'?2:1)

    await flushWeighingQueue(store,{sync:remote.sync})
    await flushWeighingQueue(store,{sync:remote.sync})
    expect(remote.sync.mock.calls.map(([op])=>op.type)).toEqual(change==='update'
      ?['entry_create','entry_update']:change==='void'?['entry_create','entry_void']:['entry_create','entry_update','entry_void'])
    expect(await store.getPending()).toHaveLength(0)
    expect(await store.getEntries('session-1')).toEqual([expect.objectContaining({...latest,syncStatus:'synced'})])
    expect(await store.getSession('session-1')).toEqual(remote.currentSession())
    expect(remote.currentSession()).toMatchObject({totalWeightGrams:latest.voided?0:72_300,
      fishHeadBasketCount:latest.voided?0:1})
  })

  it('update 回执不能把稍后已删除的本机篮还原，失败重试也不重复产生操作',async()=>{
    const store=createMemoryWeighingStore(),remote=remoteLedger(),created=entry()
    const createdSession=applyEntryCreated(session(),created)
    await store.commitOperation({session:createdSession,entry:created,operation:createOperation(created)})
    await flushWeighingQueue(store,{sync:remote.sync})
    const edited={...created,weightGrams:72_300,revision:2,syncStatus:'syncing' as const}
    const editedSession=applyEntryReplacement(createdSession,created,edited)
    await store.commitOperation({session:editedSession,entry:edited,operation:changeOperation(created,edited)})
    const gate=deferred(),started=deferred()
    const first=flushWeighingQueue(store,{sync:async op=>{
      const response=await remote.sync(op);started.resolve();await gate.promise;return response
    }})
    await started.promise
    const removed=softVoidWeighingEntry(editedSession,edited,'删除错误篮')
    await store.commitOperation({session:removed.session,entry:{...removed.entry,syncStatus:'syncing'},
      operation:changeOperation(edited,removed.entry,'entry_void')})
    gate.resolve();await first
    expect(await store.getEntries('session-1')).toEqual([expect.objectContaining({voided:true,revision:3,syncStatus:'syncing'})])
    expect(await store.getSession('session-1')).toEqual(removed.session)

    const failed=await flushWeighingQueue(store,{sync:async op=>{await remote.sync(op);throw new Error('response lost')}})
    expect(failed).toMatchObject({failed:true,pending:1})
    expect(await store.getEntries('session-1')).toEqual([expect.objectContaining({voided:true,revision:3,syncStatus:'syncing'})])
    expect(await flushWeighingQueue(store,{sync:remote.sync})).toMatchObject({failed:false,pending:0})
    expect(remote.appliedIds()).toHaveLength(3)
    expect(remote.currentSession()).toMatchObject({totalWeightGrams:0,fishHeadBasketCount:0,revision:4})
  })

  it('客户端时钟回退也不把删除排到创建前',async()=>{
    const store=createMemoryWeighingStore(),remote=remoteLedger(),created=entry()
    const base=applyEntryCreated(session(),created),removed=softVoidWeighingEntry(base,created,'删除错误篮')
    await store.commitOperation({session:base,entry:created,operation:createOperation(created)})
    await store.commitOperation({session:removed.session,entry:removed.entry,
      operation:{...changeOperation(created,removed.entry,'entry_void'),createdAtClient:'2026-07-30T11:00:00.000+08:00'}})
    expect(await flushWeighingQueue(store,{sync:remote.sync})).toMatchObject({failed:false,pending:0})
    expect(remote.sync.mock.calls.map(([op])=>op.type)).toEqual(['entry_create','entry_void'])
  })

  it('已排队的 completed 状态不会被较旧的称重回执解锁',async()=>{
    const store=createMemoryWeighingStore(),created=entry(),base=applyEntryCreated(session(),created)
    await store.commitOperation({session:base,entry:created,operation:createOperation(created)})
    const completed={...base,status:'completed' as const,revision:base.revision+1}
    await store.commitOperation({session:completed,operation:operation('complete','complete')})
    const sync=vi.fn(async(op:PendingWeighingOperation)=>{
      if(op.type==='complete')throw new Error('offline')
      return {session:base,entry:created}
    })
    expect(await flushWeighingQueue(store,{sync})).toMatchObject({failed:true,pending:1})
    expect(await store.getSession('session-1')).toEqual(completed)
  })

  it('其他篮仍待同步时保留整单本机总数，只把已回执的篮标为 synced',async()=>{
    const store=createMemoryWeighingStore(),created=entry(),firstSession=applyEntryCreated(session(),created)
    const second={...entry(),id:'entry-2',clientEntryId:'entry-2',sequenceNo:2,weightGrams:50_000,syncStatus:'syncing' as const}
    const localSession=applyEntryCreated(firstSession,second)
    await store.commitOperation({session:firstSession,entry:{...created,syncStatus:'syncing'},operation:createOperation(created)})
    await store.commitOperation({session:localSession,entry:second,
      operation:{...createOperation(second),entryId:second.id}})
    const sync=vi.fn(async(op:PendingWeighingOperation)=>{
      if(op.entryId===second.id)throw new Error('offline')
      return {session:firstSession,entry:created}
    })
    expect(await flushWeighingQueue(store,{sync})).toMatchObject({synced:1,failed:true,pending:1})
    expect(await store.getSession('session-1')).toEqual(localSession)
    expect(await store.getEntries('session-1')).toEqual([
      expect.objectContaining({id:second.id,syncStatus:'syncing'}),
      expect.objectContaining({id:created.id,syncStatus:'synced'}),
    ])
  })

  it('无 entry 返回的回执仍不能提前把之后的修改标成已同步',async()=>{
    const store=createMemoryWeighingStore(),created=entry(),base=applyEntryCreated(session(),created)
    await store.commitOperation({session:base,entry:created,operation:createOperation(created)})
    const gate=deferred(),started=deferred()
    const flushing=flushWeighingQueue(store,{sync:async()=>{started.resolve();await gate.promise;return {}}})
    await started.promise
    const after={...created,revision:2,weightGrams:72_300,syncStatus:'syncing' as const}
    await store.commitOperation({session:applyEntryReplacement(base,created,after),entry:after,operation:changeOperation(created,after)})
    gate.resolve();await flushing
    expect(await store.getEntries('session-1')).toEqual([after])
    expect(await store.getPending()).toHaveLength(1)
  })
})

function operation(type:PendingWeighingOperation['type'],id:string,createdAtClient='2026-07-30T12:00:00.000+08:00'):PendingWeighingOperation {
  return {id,type,sessionId:'session-1',entryId:type==='complete'?null:'entry-1',createdAtClient,payload:{}}
}

function createOperation(value:WeighingEntry):PendingWeighingOperation {
  return {...operation('entry_create',`entry_create_${value.clientEntryId}`),entryId:value.id,payload:{session:session(),entry:value}}
}

function changeOperation(before:WeighingEntry,after:WeighingEntry,type:'entry_update'|'entry_void'='entry_update'):PendingWeighingOperation {
  return {...operation(type,`${type}_${after.id}_${after.revision}`),payload:{before,after}}
}

function deferred(){
  let resolve!:()=>void
  const promise=new Promise<void>(done=>{resolve=done})
  return {promise,resolve}
}

// Mirrors the existing remote revision/idempotency contract without Firestore writes.
function remoteLedger(){
  let currentEntry:WeighingEntry|undefined,currentSession:WeighingSession=session()
  const applied=new Set<string>()
  const sync=vi.fn(async(op:PendingWeighingOperation)=>{
    if(applied.has(op.id))return {session:currentSession,entry:currentEntry}
    if(op.type==='entry_create'){
      if(currentEntry)throw new Error('duplicate create')
      currentEntry=(op.payload as {entry:WeighingEntry}).entry
      currentSession=applyEntryCreated(currentSession,currentEntry)
    }else{
      const {before,after}=op.payload as {before:WeighingEntry;after:WeighingEntry}
      if(!currentEntry||currentEntry.revision!==before.revision)throw new Error('revision conflict')
      if(op.type==='entry_void'){
        const removed=softVoidWeighingEntry(currentSession,currentEntry,after.voidReason!)
        currentSession=removed.session;currentEntry=removed.entry
      }else{
        currentSession=applyEntryReplacement(currentSession,currentEntry,after);currentEntry=after
      }
    }
    applied.add(op.id)
    return {session:currentSession,entry:currentEntry}
  })
  return {sync,currentEntry:()=>currentEntry,currentSession:()=>currentSession,appliedIds:()=>[...applied]}
}
