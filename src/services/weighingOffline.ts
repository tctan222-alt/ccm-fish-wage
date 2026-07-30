import type { WeighingEntry,WeighingSession } from '../lib/weighing'

export type WeighingOperationType='entry_create'|'entry_update'|'entry_void'|'complete'

export interface PendingWeighingOperation {
  id:string
  type:WeighingOperationType
  sessionId:string
  entryId:string|null
  createdAtClient:string
  payload:unknown
}

export interface WeighingOfflineStore {
  getSession(id:string):Promise<WeighingSession|undefined>
  putSession(value:WeighingSession):Promise<void>
  getEntries(sessionId:string):Promise<WeighingEntry[]>
  putEntry(value:WeighingEntry):Promise<void>
  getPending():Promise<PendingWeighingOperation[]>
  putOperation(value:PendingWeighingOperation):Promise<void>
  removeOperation(id:string):Promise<void>
  getMeta(key:string):Promise<string|undefined>
  putMeta(key:string,value:string):Promise<void>
  commitOperation(value:{
    session:WeighingSession
    entry?:WeighingEntry
    operation:PendingWeighingOperation
    meta?:Record<string,string>
  }):Promise<void>
}

export async function queueWeighingOperation(store:WeighingOfflineStore,value:PendingWeighingOperation){
  await store.putOperation(value)
}

export async function flushWeighingQueue(store:WeighingOfflineStore,remote:{
  sync:(operation:PendingWeighingOperation)=>Promise<{session?:WeighingSession;entry?:WeighingEntry}>
}){
  const operations=await store.getPending()
  let synced=0
  for(const operation of operations){
    try{
      const result=await remote.sync(operation)
      if(result.session){
        const local=await store.getSession(result.session.id)
        await store.putSession(local?.status==='completed'&&result.session.status==='weighing'
          ?{...result.session,status:'completed'}
          :result.session)
      }
      if(result.entry)await store.putEntry({...result.entry,syncStatus:'synced'})
      else if(operation.entryId){
        const current=(await store.getEntries(operation.sessionId)).find(item=>item.id===operation.entryId)
        if(current)await store.putEntry({...current,syncStatus:'synced'})
      }
      await store.removeOperation(operation.id)
      synced+=1
    }catch(problem){
      return {synced,pending:operations.length-synced,failed:true,
        lastError:problem instanceof Error?problem.message:'同步失败，请稍后重试。'}
    }
  }
  return {synced,pending:0,failed:false,lastError:null}
}

const PREFIX={session:'session:',entry:'entry:',operation:'operation:',meta:'meta:'} as const

export function createMemoryWeighingStore(shared=new Map<string,unknown>()):WeighingOfflineStore {
  return {
    async getSession(id){return shared.get(PREFIX.session+id) as WeighingSession|undefined},
    async putSession(value){shared.set(PREFIX.session+value.id,value)},
    async getEntries(sessionId){return [...shared.entries()].filter(([key])=>key.startsWith(PREFIX.entry))
      .map(([,value])=>value as WeighingEntry).filter(item=>item.sessionId===sessionId)
      .sort((a,b)=>(b.sequenceNo??Number.MAX_SAFE_INTEGER)-(a.sequenceNo??Number.MAX_SAFE_INTEGER))},
    async putEntry(value){shared.set(PREFIX.entry+value.id,value)},
    async getPending(){return [...shared.entries()].filter(([key])=>key.startsWith(PREFIX.operation))
      .map(([,value])=>value as PendingWeighingOperation).sort((a,b)=>a.createdAtClient.localeCompare(b.createdAtClient)||a.id.localeCompare(b.id))},
    async putOperation(value){shared.set(PREFIX.operation+value.id,value)},
    async removeOperation(id){shared.delete(PREFIX.operation+id)},
    async getMeta(key){return shared.get(PREFIX.meta+key) as string|undefined},
    async putMeta(key,value){shared.set(PREFIX.meta+key,value)},
    async commitOperation(value){
      shared.set(PREFIX.session+value.session.id,value.session)
      if(value.entry)shared.set(PREFIX.entry+value.entry.id,value.entry)
      shared.set(PREFIX.operation+value.operation.id,value.operation)
      Object.entries(value.meta??{}).forEach(([key,item])=>shared.set(PREFIX.meta+key,item))
    },
  }
}

const DB_NAME='ccm-fishery-weighing-v1'
const DB_VERSION=2

function requestResult<T>(request:IDBRequest<T>){
  return new Promise<T>((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error??new Error('IndexedDB 操作失败。'))
  })
}

function transactionDone(transaction:IDBTransaction){
  return new Promise<void>((resolve,reject)=>{
    transaction.oncomplete=()=>resolve()
    transaction.onerror=()=>reject(transaction.error??new Error('IndexedDB transaction failed'))
    transaction.onabort=()=>reject(transaction.error??new Error('IndexedDB transaction aborted'))
  })
}

async function openDatabase(){
  const request=indexedDB.open(DB_NAME,DB_VERSION)
  request.onupgradeneeded=()=>{
    const database=request.result
    if(!database.objectStoreNames.contains('sessions'))database.createObjectStore('sessions',{keyPath:'id'})
    if(!database.objectStoreNames.contains('entries')){
      const entries=database.createObjectStore('entries',{keyPath:'id'})
      entries.createIndex('sessionId','sessionId',{unique:false})
    }
    if(!database.objectStoreNames.contains('operations')){
      const operations=database.createObjectStore('operations',{keyPath:'id'})
      operations.createIndex('createdAtClient','createdAtClient',{unique:false})
    }
    if(!database.objectStoreNames.contains('meta'))database.createObjectStore('meta',{keyPath:'key'})
  }
  return requestResult(request)
}

export function createIndexedDbWeighingStore():WeighingOfflineStore {
  return {
    async getSession(id){
      const db=await openDatabase(),tx=db.transaction('sessions','readonly')
      const result=await requestResult(tx.objectStore('sessions').get(id));await transactionDone(tx);db.close()
      return result as WeighingSession|undefined
    },
    async putSession(value){
      const db=await openDatabase(),tx=db.transaction('sessions','readwrite')
      tx.objectStore('sessions').put(value);await transactionDone(tx);db.close()
    },
    async getEntries(sessionId){
      const db=await openDatabase(),tx=db.transaction('entries','readonly')
      const result=await requestResult(tx.objectStore('entries').index('sessionId').getAll(sessionId));await transactionDone(tx);db.close()
      return (result as WeighingEntry[]).sort((a,b)=>{
        const time=String(b.recordedAtClient).localeCompare(String(a.recordedAtClient))
        return time||String(b.id).localeCompare(String(a.id))
      })
    },
    async putEntry(value){
      const db=await openDatabase(),tx=db.transaction('entries','readwrite')
      tx.objectStore('entries').put(value);await transactionDone(tx);db.close()
    },
    async getPending(){
      const db=await openDatabase(),tx=db.transaction('operations','readonly')
      const result=await requestResult(tx.objectStore('operations').getAll());await transactionDone(tx);db.close()
      return (result as PendingWeighingOperation[]).sort((a,b)=>a.createdAtClient.localeCompare(b.createdAtClient)||a.id.localeCompare(b.id))
    },
    async putOperation(value){
      const db=await openDatabase(),tx=db.transaction('operations','readwrite')
      tx.objectStore('operations').put(value);await transactionDone(tx);db.close()
    },
    async removeOperation(id){
      const db=await openDatabase(),tx=db.transaction('operations','readwrite')
      tx.objectStore('operations').delete(id);await transactionDone(tx);db.close()
    },
    async getMeta(key){
      const db=await openDatabase(),tx=db.transaction('meta','readonly')
      const result=await requestResult(tx.objectStore('meta').get(key)) as {key:string;value:string}|undefined
      await transactionDone(tx);db.close();return result?.value
    },
    async putMeta(key,value){
      const db=await openDatabase(),tx=db.transaction('meta','readwrite')
      tx.objectStore('meta').put({key,value});await transactionDone(tx);db.close()
    },
    async commitOperation(value){
      const stores=['sessions','operations',...(value.entry?['entries']:[]),...(value.meta?['meta']:[])]
      const db=await openDatabase(),tx=db.transaction(stores,'readwrite')
      tx.objectStore('sessions').put(value.session)
      if(value.entry)tx.objectStore('entries').put(value.entry)
      tx.objectStore('operations').put(value.operation)
      Object.entries(value.meta??{}).forEach(([key,item])=>tx.objectStore('meta').put({key,value:item}))
      await transactionDone(tx);db.close()
    },
  }
}
