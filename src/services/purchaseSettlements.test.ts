import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { buildPurchaseSettlementLines,draftIdForSourceSession,makeSettlementDraft,reconcileSettlementLines,type PurchaseSettlementDraft } from '../lib/purchaseSettlement'
import { loadStableWeighingBundle,loadWeighingBundle,type WeighingBundle } from './weighing'

const state=vi.hoisted(()=>({records:new Map<string,Record<string,unknown>>(),writes:vi.fn(),failPath:'',uid:'u1' as string|null,retries:0,beforeCommit:null as (()=>void)|null,transactionErrorCode:'',afterServerRead:null as ((path:string)=>void)|null}))
vi.mock('../firebase',()=>({db:{},firebaseConfigured:true,auth:{get currentUser(){return state.uid?{uid:state.uid}:null}}}))
vi.mock('./weighing',()=>({loadWeighingSessions:vi.fn(),loadWeighingBundle:vi.fn(),loadStableWeighingBundle:vi.fn()}))
vi.mock('firebase/firestore',()=>{
  const metadata={fromCache:false,hasPendingWrites:false}
  const snapshot=(path:string)=>{const value=state.records.get(path);return {id:path.split('/').at(-1),exists:()=>Boolean(value),data:()=>value,metadata}}
  const collectionSnapshot=(ref:{path:string;filters?:{field:string;value:unknown}[]})=>({metadata,docs:[...state.records].filter(([path,data])=>path.startsWith(`${ref.path}/`)&&!path.slice(ref.path.length+1).includes('/')&&(ref.filters??[]).every(filter=>data[filter.field]===filter.value)).map(([path])=>snapshot(path))})
  return {
    doc:(parent:{path?:string},...parts:string[])=>({path:[parent.path,...parts].filter(Boolean).join('/'),id:parts.at(-1)}),
    collection:(parent:{path?:string},...parts:string[])=>({path:[parent.path,...parts].filter(Boolean).join('/')}),
    where:(field:string,_operator:string,value:unknown)=>({field,value}),
    query:(ref:{path:string},...filters:{field:string;value:unknown}[])=>({...ref,filters}),
    getDocs:async(ref:{path:string;filters?:{field:string;value:unknown}[]})=>collectionSnapshot(ref),
    getDoc:async(ref:{path:string})=>snapshot(ref.path),
    getDocFromServer:async(ref:{path:string})=>{const result=snapshot(ref.path);state.afterServerRead?.(ref.path);return result},
    getDocsFromServer:async(ref:{path:string;filters?:{field:string;value:unknown}[]})=>{const result=collectionSnapshot(ref);state.afterServerRead?.(ref.path);return result},
    serverTimestamp:()=>new Date(),
    runTransaction:async(_db:unknown,callback:(transaction:unknown)=>Promise<unknown>)=>{
      for(let attempt=0;attempt<5;attempt++){
        const reads=new Map<string,Record<string,unknown>|undefined>(),pending=new Map<string,Record<string,unknown>>()
        const result=await callback({
          get:async(ref:{path:string})=>{reads.set(ref.path,state.records.get(ref.path));return snapshot(ref.path)},
          set:(ref:{path:string},data:Record<string,unknown>)=>{if(ref.path===state.failPath)throw new Error('connection interrupted');pending.set(ref.path,data)},
        })
        const beforeCommit=state.beforeCommit;state.beforeCommit=null;beforeCommit?.()
        if(state.transactionErrorCode){const code=state.transactionErrorCode;state.transactionErrorCode='';throw Object.assign(new Error('Firestore transaction failed'),{code})}
        if([...reads].some(([path,value])=>state.records.get(path)!==value)){state.retries++;continue}
        for(const [path,data] of pending){state.records.set(path,data);state.writes(path,data)}
        return result
      }
      throw new Error('transaction retry limit')
    },
  }
})
import { asSettlementSourceEntry,loadPurchaseSettlementDraft,loadPurchaseSettlementDraftForSource,loadPurchaseSettlementSource,savePurchaseSettlementDraft } from './purchaseSettlements'

const legacyDraftPath='purchaseSettlementDrafts/fish_head_20260803_v978',draftPath='purchaseSettlementDrafts/fish_head_session_source',sourcePath='weighingSessions/source'
const guardPath='purchaseSettlementSources/fish_head_session_source'
function stored(value:PurchaseSettlementDraft){const data={...value};delete data.draftId;return data}
function bundle(sessionId='source'):WeighingBundle {
  const path=`weighingSessions/${sessionId}`
  return {session:{...state.records.get(path),id:sessionId},entries:[...state.records].filter(([recordPath])=>recordPath.startsWith(`${path}/entries/`)).map(([recordPath,data])=>({...data,id:recordPath.split('/').at(-1),sessionId})),
    actions:[...state.records].filter(([recordPath])=>recordPath.startsWith(`${path}/actions/`)).map(([recordPath,data])=>({...data,id:recordPath.split('/').at(-1)}))} as WeighingBundle
}
function input():PurchaseSettlementDraft {
  const lines=buildPurchaseSettlementLines([{id:'entry-1',productType:'fish_head',fishSpeciesId:'jin_xian',fishSpeciesCodeSnapshot:'jin_xian',fishSpeciesNameSnapshot:'金线',
    fishMealQuality:null,displayNameSnapshot:'金线',entryMode:'individual',sequenceNo:1,weightGrams:10000,voided:false,recordedAtClient:'2026-08-03T10:00:00+08:00'}],'fish_head','978')
  return {...makeSettlementDraft({productType:'fish_head',businessDate:'03/08/2026',dateSortKey:20260803,monthKey:'08/2026',monthSortKey:202608,vesselId:'v978',vesselCodeSnapshot:'978',receiptNo:'',lines,sourceEntryIds:['entry-1']}),
    sourceSessionId:'source',sourceSessionRevision:3}
}
async function useRealStableLoader(){
  const weighing=await vi.importActual<typeof import('./weighing')>('./weighing')
  vi.mocked(loadStableWeighingBundle).mockImplementation(weighing.loadStableWeighingBundle)
}
function setSourceWeight(weightGrams:number){
  state.records.set(`${sourcePath}/entries/entry-1`,{...state.records.get(`${sourcePath}/entries/entry-1`),weightGrams})
}

beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-08-04T02:00:00Z'))
  state.records.clear();state.writes.mockClear();state.failPath='';state.uid='u1';state.retries=0;state.beforeCommit=null;state.transactionErrorCode='';state.afterServerRead=null
  state.records.set(sourcePath,{productType:'fish_head',weighingDate:'03/08/2026',vesselId:'v978',vesselCodeSnapshot:'978',revision:3,status:'completed',completedAt:new Date('2026-08-03T02:00:00Z')})
  state.records.set(`${sourcePath}/entries/entry-1`,{sessionId:'source',productType:'fish_head',weighingDate:'03/08/2026',vesselId:'v978',voided:false,recordedAt:new Date('2026-08-03T02:00:00Z'),
    fishSpeciesId:'jin_xian',fishSpeciesCodeSnapshot:'jin_xian',fishSpeciesNameSnapshot:'金线',fishMealQuality:null,displayNameSnapshot:'金线',entryMode:'individual',sequenceNo:1,
    weightGrams:10000,recordedAtClient:'2026-08-03T10:00:00+08:00'})
  vi.mocked(loadStableWeighingBundle).mockReset().mockImplementation(async sessionId=>{
    if(!state.records.has(`weighingSessions/${sessionId}`))throw new Error('找不到来源称重单。')
    return bundle(sessionId)
  })
  vi.mocked(loadWeighingBundle).mockReset().mockImplementation(async sessionId=>bundle(sessionId))
})
afterEach(()=>vi.useRealTimers())

describe('source-authoritative draft lookup',()=>{
  it('returns the accepted stable session and entries through the legacy vessel/date route',async()=>{
    await useRealStableLoader()
    state.records.set(sourcePath,{...state.records.get(sourcePath),revision:10})
    setSourceWeight(100000)
    const discovered=bundle().session
    state.afterServerRead=path=>{
      if(path!==`${sourcePath}/entries`)return
      state.afterServerRead=null
      setSourceWeight(80000)
      state.records.set(sourcePath,{...state.records.get(sourcePath),revision:11})
    }
    const source=await loadPurchaseSettlementSource('v978','03/08/2026','fish_head',async()=>[discovered])
    expect(source).toMatchObject({session:{id:'source',revision:11},bundle:{session:{revision:11},entries:[{id:'entry-1',weightGrams:80000}]}})
    await expect(loadPurchaseSettlementSource('v978','03/08/2026','fish_head',async()=>[discovered,{...discovered,id:'other'}])).rejects.toThrow('结单列表')
  })

  it('finds a saved bound document by sourceSessionId before the mutable tuple',async()=>{
    state.records.set(legacyDraftPath,{...input(),revision:4})
    state.records.set(sourcePath,{...state.records.get(sourcePath),weighingDate:'04/08/2026',vesselId:'v833',vesselCodeSnapshot:'833'})
    expect(await loadPurchaseSettlementDraftForSource(bundle(),'fish_head')).toMatchObject({draftId:'fish_head_20260803_v978',revision:4})
    expect(state.writes).not.toHaveBeenCalled()
  })

  it('loads the same canonical source draft on repeated opens',async()=>{
    const id=draftIdForSourceSession('fish_head','source')
    state.records.set(`purchaseSettlementDrafts/${id}`,{...input()})
    expect(await loadPurchaseSettlementDraftForSource(bundle(),'fish_head')).toMatchObject({draftId:id})
    expect(await loadPurchaseSettlementDraftForSource(bundle(),'fish_head')).toMatchObject({draftId:id})
  })

  it('proves and reuses an unbound legacy document using its original entry IDs after metadata correction',async()=>{
    const legacy={...input(),createdBy:'legacy-user',createdAt:new Date('2026-08-03T03:00:00Z'),revision:4}
    delete legacy.sourceSessionId;delete legacy.sourceSessionRevision
    state.records.set(legacyDraftPath,{...legacy})
    state.records.set(sourcePath,{...state.records.get(sourcePath),weighingDate:'04/08/2026',vesselId:'v833'})
    expect(await loadPurchaseSettlementDraftForSource(bundle(),'fish_head')).toMatchObject({draftId:'fish_head_20260803_v978',createdBy:'legacy-user',revision:4})
    expect(state.writes).not.toHaveBeenCalled()
  })

  it('rejects a legacy source mismatch and refuses to guess ownership of missing entry IDs',async()=>{
    state.records.set(legacyDraftPath,{...input(),sourceSessionId:'other'})
    await expect(loadPurchaseSettlementDraftForSource(bundle(),'fish_head')).rejects.toThrow('另一张称重单')
    const legacy={...input(),sourceEntryIds:['missing']} as PurchaseSettlementDraft
    delete legacy.sourceSessionId;delete legacy.sourceSessionRevision
    state.records.set(legacyDraftPath,{...legacy})
    await expect(loadPurchaseSettlementDraftForSource(bundle(),'fish_head')).rejects.toThrow('无法证明')
  })

  it('fails with exact IDs when more than one active draft is bound to the source',async()=>{
    state.records.set(legacyDraftPath,{...input()});state.records.set('purchaseSettlementDrafts/duplicate',{...input()})
    await expect(loadPurchaseSettlementDraftForSource(bundle(),'fish_head')).rejects.toThrow('duplicate, fish_head_20260803_v978')
    expect(state.writes).not.toHaveBeenCalled()
  })

  it('fails closed on a bound product mismatch and ignores voided drafts in the active duplicate check',async()=>{
    state.records.set(legacyDraftPath,{...input(),productType:'fish_meal'})
    await expect(loadPurchaseSettlementDraftForSource(bundle(),'fish_head')).rejects.toThrow('类型')
    state.records.set(legacyDraftPath,{...input()});state.records.set('purchaseSettlementDrafts/voided',{...input(),voided:true})
    expect(await loadPurchaseSettlementDraftForSource(bundle(),'fish_head')).toMatchObject({draftId:'fish_head_20260803_v978'})
  })

  it('refuses legacy binding to an entry created after the saved draft, even with the same ID',async()=>{
    const legacy={...input(),createdBy:'legacy-user',createdAt:new Date('2026-08-03T01:00:00Z')}
    delete legacy.sourceSessionId;delete legacy.sourceSessionRevision
    state.records.set(legacyDraftPath,legacy)
    await expect(loadPurchaseSettlementDraftForSource(bundle(),'fish_head')).rejects.toThrow('无法证明')
    await expect(savePurchaseSettlementDraft({...input(),draftId:'fish_head_20260803_v978'})).rejects.toThrow('无法证明')
    expect(state.writes).not.toHaveBeenCalled()
  })

  it('keeps the old tuple route readable but refuses ambiguous same-vessel same-day source selection',async()=>{
    const source=bundle().session
    const bundleLoader=vi.fn(async()=>bundle())
    expect(await loadPurchaseSettlementSource('v978','03/08/2026','fish_head',async()=>[source],bundleLoader)).toMatchObject({session:{id:'source'}})
    await expect(loadPurchaseSettlementSource('v978','03/08/2026','fish_head',async()=>[source,{...source,id:'other'}],bundleLoader)).rejects.toThrow('结单列表')
    expect(bundleLoader).toHaveBeenCalledTimes(1)
  })

  it('finds an intermediate legacy tuple using audited correction history and rejects stale new creation',async()=>{
    const intermediatePath='purchaseSettlementDrafts/fish_head_20260804_v833'
    const legacy={...input(),businessDate:'04/08/2026',dateSortKey:20260804,vesselId:'v833',vesselCodeSnapshot:'833',createdBy:'legacy-user',createdAt:new Date('2026-08-03T03:00:00Z')}
    delete legacy.sourceSessionId;delete legacy.sourceSessionRevision
    state.records.set(intermediatePath,legacy)
    state.records.set(sourcePath,{...state.records.get(sourcePath),weighingDate:'05/08/2026',vesselId:'v978',revision:4})
    state.records.set(`${sourcePath}/actions/correction`,{type:'session_update',beforeSnapshot:{weighingDate:'04/08/2026',vesselId:'v833'},afterSnapshot:{weighingDate:'05/08/2026',vesselId:'v978'}})
    expect(await loadPurchaseSettlementDraftForSource(bundle(),'fish_head')).toMatchObject({draftId:'fish_head_20260804_v833'})
    await expect(savePurchaseSettlementDraft({...input(),businessDate:'05/08/2026',dateSortKey:20260805,sourceSessionRevision:4})).rejects.toThrow('fish_head_20260804_v833')
    expect(state.writes).not.toHaveBeenCalled()
  })
})

describe('stable settlement source integration',()=>{
  it.each(['fish_head','fish_meal'] as const)('keeps %s saved prices, actual draft ID and immutable source pointer after a basket correction during reload',async productType=>{
    await useRealStableLoader()
    const actualId=`${productType}_20260803_v978`,actualPath=`purchaseSettlementDrafts/${actualId}`,pointerPath=`purchaseSettlementSources/${productType}_session_source`
    state.records.set(sourcePath,{...state.records.get(sourcePath),productType,revision:10})
    state.records.set(`${sourcePath}/entries/entry-1`,{...state.records.get(`${sourcePath}/entries/entry-1`),productType,weightGrams:100000,
      ...(productType==='fish_meal'?{fishSpeciesId:null,fishSpeciesCodeSnapshot:null,fishSpeciesNameSnapshot:null,fishMealQuality:'bag',displayNameSnapshot:'包鱼仔'}:{})})
    const originalLines=buildPurchaseSettlementLines(bundle().entries.map(asSettlementSourceEntry),productType,'978')
    const saved={...input(),productType,sourceSessionRevision:10,lines:originalLines.map(line=>({...line,unitPriceCentsPerKg:290,priceWasEdited:true,amountCents:29000})),totalAmountCents:29000,
      revision:4,createdBy:'original-user',createdAt:new Date('2026-08-03T03:00:00Z')}
    const pointer={productType,sourceSessionId:'source',draftId:actualId,createdBy:'original-user',createdAt:new Date('2026-08-03T03:00:00Z')}
    state.records.set(actualPath,saved);state.records.set(pointerPath,pointer)
    const discovered=bundle().session
    state.afterServerRead=path=>{
      if(path!==`${sourcePath}/entries`)return
      state.afterServerRead=null
      setSourceWeight(80000)
      state.records.set(sourcePath,{...state.records.get(sourcePath),revision:11})
    }
    const source=await loadPurchaseSettlementSource('v978','03/08/2026',productType,async()=>[discovered])
    const accepted=source.bundle!
    const loaded=(await loadPurchaseSettlementDraftForSource(accepted,productType))!
    const lines=reconcileSettlementLines(buildPurchaseSettlementLines(accepted.entries.map(asSettlementSourceEntry),productType,accepted.session.vesselCodeSnapshot),loaded.lines)
    const updated=await savePurchaseSettlementDraft({...loaded,lines,totalAmountCents:23200,sourceSessionRevision:accepted.session.revision})
    expect(updated).toMatchObject({draftId:actualId,sourceSessionId:'source',sourceSessionRevision:11,revision:5,totalAmountCents:23200,
      lines:[{unitPriceCentsPerKg:290,priceWasEdited:true,totalWeightGrams:80000,amountCents:23200}]})
    expect(state.records.get(pointerPath)).toBe(pointer)
    expect(state.records.has(`purchaseSettlementDrafts/${productType}_session_source`)).toBe(false)
    expect(await loadPurchaseSettlementDraftForSource(accepted,productType)).toMatchObject({draftId:actualId,sourceSessionId:'source',sourceSessionRevision:11,lines:[{unitPriceCentsPerKg:290,totalWeightGrams:80000}]})
  })

  it('rejects a correction after stable load with the original save conflict and leaves the saved draft and source pointer intact',async()=>{
    await useRealStableLoader()
    setSourceWeight(100000)
    state.records.set(sourcePath,{...state.records.get(sourcePath),revision:10})
    const lines=buildPurchaseSettlementLines(bundle().entries.map(asSettlementSourceEntry),'fish_head','978')
    const saved={...input(),lines,totalAmountCents:21000,sourceSessionRevision:10,revision:4}
    const pointer={productType:'fish_head',sourceSessionId:'source',draftId:'fish_head_20260803_v978'}
    state.records.set(legacyDraftPath,saved);state.records.set(guardPath,pointer)
    const source=await loadPurchaseSettlementSource('v978','03/08/2026','fish_head',async()=>[bundle().session])
    const loaded=(await loadPurchaseSettlementDraftForSource(source.bundle!,'fish_head'))!
    setSourceWeight(80000)
    state.records.set(sourcePath,{...state.records.get(sourcePath),revision:11})
    await expect(savePurchaseSettlementDraft({...loaded,sourceSessionRevision:source.bundle!.session.revision})).rejects.toThrow('称重资料已变更，请重新载入后检查结单。')
    expect(state.writes).not.toHaveBeenCalled()
    expect(state.records.get(legacyDraftPath)).toBe(saved)
    expect(state.records.get(guardPath)).toBe(pointer)
  })

  it('uses retried entries and audited metadata history to preserve legacy ownership proof during first-save discovery',async()=>{
    await useRealStableLoader()
    const actualId='fish_head_20260804_v833',actualPath=`purchaseSettlementDrafts/${actualId}`
    const legacy={...input(),businessDate:'04/08/2026',dateSortKey:20260804,vesselId:'v833',vesselCodeSnapshot:'833',createdAt:new Date('2026-08-03T03:00:00Z')}
    delete legacy.sourceSessionId;delete legacy.sourceSessionRevision
    state.records.set(actualPath,legacy)
    state.records.set(sourcePath,{...state.records.get(sourcePath),weighingDate:'05/08/2026',revision:10})
    state.records.set(`${sourcePath}/entries/entry-1`,{...state.records.get(`${sourcePath}/entries/entry-1`),weighingDate:'05/08/2026'})
    const discovered=bundle().session
    state.afterServerRead=path=>{
      if(path!==`${sourcePath}/entries`)return
      state.afterServerRead=null
      setSourceWeight(80000)
      state.records.set(sourcePath,{...state.records.get(sourcePath),revision:11})
      state.records.set(`${sourcePath}/actions/correction`,{type:'session_update',beforeSnapshot:{weighingDate:'04/08/2026',vesselId:'v833'},afterSnapshot:{weighingDate:'05/08/2026',vesselId:'v978'}})
    }
    const source=await loadPurchaseSettlementSource('v978','05/08/2026','fish_head',async()=>[discovered])
    expect(source.bundle).toMatchObject({session:{revision:11},entries:[{id:'entry-1',weightGrams:80000}],actions:[{id:'correction',type:'session_update'}]})
    expect(await loadPurchaseSettlementDraftForSource(source.bundle!,'fish_head')).toMatchObject({draftId:actualId})
    await expect(savePurchaseSettlementDraft({...input(),businessDate:'05/08/2026',dateSortKey:20260805,sourceSessionRevision:11})).rejects.toThrow(actualId)
    expect(state.writes).not.toHaveBeenCalled()
    expect(state.records.get(actualPath)).toBe(legacy)
    expect(state.records.has(draftPath)).toBe(false)
    expect(state.records.has(guardPath)).toBe(false)
  })
})

describe('settlement draft transactions',()=>{
  it('rejects an unstable first-save ownership read before creating a draft, guard or audit',async()=>{
    await useRealStableLoader()
    state.afterServerRead=path=>{
      if(path===`${sourcePath}/entries`)state.records.set(sourcePath,{...state.records.get(sourcePath),revision:Number(state.records.get(sourcePath)?.revision)+1})
    }
    await expect(savePurchaseSettlementDraft(input())).rejects.toThrow('称重资料正在修改')
    expect(state.writes).not.toHaveBeenCalled()
    expect(state.records.has(draftPath)).toBe(false)
    expect(state.records.has(guardPath)).toBe(false)
  })

  it('saves the source revision and immutable before/after audit, preserving original creation fields',async()=>{
    const first=await savePurchaseSettlementDraft(input())
    state.uid='u2'
    const second=await savePurchaseSettlementDraft({...first,receiptNo:'FH-002'})
    expect(second).toMatchObject({revision:2,createdBy:'u1',createdAt:first.createdAt,updatedBy:'u2',sourceSessionId:'source',sourceSessionRevision:3})
    expect(state.records.get(`${draftPath}/actions/2`)).toMatchObject({beforeSnapshot:stored(first),afterSnapshot:stored(second),performedBy:'u2'})
    expect(await loadPurchaseSettlementDraftForSource(bundle(),'fish_head')).toMatchObject(second)
  })

  it('rejects stale draft and weighing revisions before any write',async()=>{
    const first=await savePurchaseSettlementDraft(input())
    await savePurchaseSettlementDraft({...first,receiptNo:'other-device'})
    state.writes.mockClear()
    await expect(savePurchaseSettlementDraft(first)).rejects.toThrow('其他装置')
    state.records.set(sourcePath,{...state.records.get(sourcePath),revision:4})
    await expect(savePurchaseSettlementDraft({...first,revision:2})).rejects.toThrow('称重资料已变更')
    expect(state.writes).not.toHaveBeenCalled()
  })

  it.each(['completed','weighing'])('locks expired %s sources using the original completion timestamp',async status=>{
    state.records.set(sourcePath,{...state.records.get(sourcePath),status,completedAt:new Date('2026-07-27T02:00:00Z')})
    await expect(savePurchaseSettlementDraft(input())).rejects.toThrow('7 天')
    expect(state.writes).not.toHaveBeenCalled()
  })

  it.each(['processed','voided'])('does not edit a %s source even during the time window',async status=>{
    state.records.set(sourcePath,{...state.records.get(sourcePath),status})
    await expect(savePurchaseSettlementDraft(input())).rejects.toThrow('锁定')
    expect(state.writes).not.toHaveBeenCalled()
  })

  it('rejects missing sources, mismatched snapshots and logged-out saves',async()=>{
    await expect(savePurchaseSettlementDraft({...input(),vesselCodeSnapshot:'833'})).rejects.toThrow('称重资料已变更')
    await expect(savePurchaseSettlementDraft({...input(),sourceSessionId:undefined})).rejects.toThrow('缺少来源')
    state.records.delete(sourcePath)
    await expect(savePurchaseSettlementDraft(input())).rejects.toThrow('找不到来源')
    state.uid=null
    await expect(savePurchaseSettlementDraft(input())).rejects.toThrow('请先登录')
    expect(state.writes).not.toHaveBeenCalled()
  })

  it('does not commit the draft when its audit cannot be saved',async()=>{
    state.failPath=`${draftPath}/actions/1`
    await expect(savePurchaseSettlementDraft(input())).rejects.toThrow('connection interrupted')
    expect(state.records.has(draftPath)).toBe(false)
    expect(state.writes).not.toHaveBeenCalled()
    state.failPath=''
    await expect(savePurchaseSettlementDraft(input())).resolves.toMatchObject({revision:1})
  })

  it('can adopt a legacy draft without losing its creation audit, but cannot change an existing source binding',async()=>{
    const legacy={...input(),revision:4,createdBy:'legacy-user',createdAt:new Date('2026-08-03T03:00:00Z')}
    delete legacy.sourceSessionId;delete legacy.sourceSessionRevision
    state.records.set(legacyDraftPath,legacy)
    await expect(savePurchaseSettlementDraft({...input(),draftId:'fish_head_20260803_v978',revision:4})).resolves.toMatchObject({draftId:'fish_head_20260803_v978',revision:5,createdBy:'legacy-user',sourceSessionId:'source'})
    state.records.set('weighingSessions/other',{...state.records.get(sourcePath)})
    await expect(savePurchaseSettlementDraft({...input(),draftId:'fish_head_20260803_v978',sourceSessionId:'other',revision:5})).rejects.toThrow('另一张称重单')
  })

  it('creates a canonical document and immutable guard without persisting runtime identity',async()=>{
    const first=await savePurchaseSettlementDraft(input())
    expect(first.draftId).toBe('fish_head_session_source')
    expect(state.records.get(guardPath)).toMatchObject({draftId:first.draftId,sourceSessionId:'source',productType:'fish_head',createdBy:'u1'})
    expect(state.records.get(draftPath)).not.toHaveProperty('draftId')
    expect(state.records.get(`${draftPath}/actions/1`)?.afterSnapshot).not.toHaveProperty('draftId')
    expect(await loadPurchaseSettlementDraft('fish_head',20260803,'v978')).toBeNull()
  })

  it('retries a real conflicting concurrent first creation and cannot update the winning draft without loaded identity',async()=>{
    const results=await Promise.allSettled([savePurchaseSettlementDraft(input()),savePurchaseSettlementDraft(input())])
    expect(results.filter(item=>item.status==='fulfilled')).toHaveLength(1)
    expect(results.filter(item=>item.status==='rejected')).toHaveLength(1)
    expect(state.retries).toBeGreaterThan(0)
    expect([...state.records.keys()].filter(path=>path.startsWith('purchaseSettlementDrafts/')&&!path.slice('purchaseSettlementDrafts/'.length).includes('/'))).toEqual([draftPath])
    expect(state.records.get(draftPath)?.revision).toBe(1)
    await expect(savePurchaseSettlementDraft(input())).rejects.toThrow('重新载入')
  })

  it.each([{weighingDate:'04/08/2026'},{vesselId:'v833',vesselCodeSnapshot:'833'},{weighingDate:'04/08/2026',vesselId:'v833',vesselCodeSnapshot:'833'}])('keeps actual identity and saved prices after source metadata correction %j',async correction=>{
    const first=await savePurchaseSettlementDraft(input())
    const edited={...first,lines:first.lines.map(line=>({...line,unitPriceCentsPerKg:290,priceWasEdited:true,amountCents:2900})),totalAmountCents:2900}
    const priced=await savePurchaseSettlementDraft(edited)
    state.records.set(sourcePath,{...state.records.get(sourcePath),...correction,revision:4})
    const loaded=(await loadPurchaseSettlementDraftForSource(bundle(),'fish_head'))!
    expect(loaded).toMatchObject({draftId:first.draftId,revision:2,lines:[expect.objectContaining({unitPriceCentsPerKg:290,priceWasEdited:true})]})
    const current=state.records.get(sourcePath)!
    const corrected=await savePurchaseSettlementDraft({...loaded,businessDate:String(current.weighingDate),vesselId:String(current.vesselId),vesselCodeSnapshot:String(current.vesselCodeSnapshot),sourceSessionRevision:4})
    expect(corrected).toMatchObject({draftId:first.draftId,createdAt:first.createdAt,createdBy:first.createdBy,revision:3,...(correction.weighingDate?{businessDate:correction.weighingDate,dateSortKey:20260804}:{}),...(correction.vesselId?{vesselId:correction.vesselId}:{})})
    expect(state.records.get(`${draftPath}/actions/3`)).toMatchObject({beforeSnapshot:stored(priced),afterSnapshot:stored(corrected)})
  })

  it('rejects stale new callers rather than copying an existing legacy draft or losing edited prices',async()=>{
    const legacy={...input(),lines:input().lines.map(line=>({...line,unitPriceCentsPerKg:290,priceWasEdited:true,amountCents:2900})),totalAmountCents:2900}
    delete legacy.sourceSessionId;delete legacy.sourceSessionRevision
    state.records.set(legacyDraftPath,legacy)
    await expect(savePurchaseSettlementDraft(input())).rejects.toThrow('fish_head_20260803_v978')
    expect(state.writes).not.toHaveBeenCalled()
    expect(state.records.get(legacyDraftPath)).toEqual(legacy)
  })

  it('creates separate canonical drafts for two source sessions on the same vessel and date',async()=>{
    state.records.set('weighingSessions/other',{...state.records.get(sourcePath)})
    const [first,second]=await Promise.all([savePurchaseSettlementDraft(input()),savePurchaseSettlementDraft({...input(),sourceSessionId:'other'})])
    expect(first.draftId).not.toBe(second.draftId)
    expect(second.draftId).toBe('fish_head_session_other')
  })

  it('refuses a forged existing ID or an inconsistent immutable source guard',async()=>{
    await expect(savePurchaseSettlementDraft({...input(),draftId:'arbitrary'})).rejects.toThrow('结单不存在')
    state.records.set(guardPath,{draftId:'legacy-other',sourceSessionId:'source',productType:'fish_head'})
    await expect(savePurchaseSettlementDraft(input())).rejects.toThrow('legacy-other')
    expect(state.writes).not.toHaveBeenCalled()
  })

  it('rejects duplicate bound drafts before saving',async()=>{
    state.records.set(legacyDraftPath,{...input()});state.records.set('purchaseSettlementDrafts/duplicate',{...input()})
    await expect(savePurchaseSettlementDraft({...input(),draftId:'fish_head_20260803_v978'})).rejects.toThrow('duplicate, fish_head_20260803_v978')
    expect(state.writes).not.toHaveBeenCalled()
  })

  it('retries against a newly committed legacy binding and cannot create a canonical duplicate',async()=>{
    state.beforeCommit=()=>{
      state.records.set(legacyDraftPath,{...input(),createdBy:'legacy-user',createdAt:new Date('2026-08-03T03:00:00Z')})
      state.records.set(guardPath,{productType:'fish_head',sourceSessionId:'source',draftId:'fish_head_20260803_v978',createdBy:'legacy-user',createdAt:new Date('2026-08-04T02:00:00Z')})
    }
    await expect(savePurchaseSettlementDraft(input())).rejects.toThrow('fish_head_20260803_v978')
    expect(state.retries).toBe(1)
    expect(state.records.has(draftPath)).toBe(false)
    expect(state.writes).not.toHaveBeenCalled()
  })

  it('retains an immutable guard on later updates and rolls it back together with a failed audit',async()=>{
    const first=await savePurchaseSettlementDraft(input()),guard=state.records.get(guardPath)
    state.uid='u2'
    await savePurchaseSettlementDraft({...first,receiptNo:'FH-002'})
    expect(state.records.get(guardPath)).toBe(guard)
    expect(state.records.get(guardPath)?.createdBy).toBe('u1')
    state.records.delete(draftPath);state.records.delete(guardPath);state.writes.mockClear();state.failPath=`${draftPath}/actions/1`
    await expect(savePurchaseSettlementDraft(input())).rejects.toThrow('connection interrupted')
    expect(state.records.has(guardPath)).toBe(false)
    expect(state.records.has(draftPath)).toBe(false)
  })

  it('keeps fish-meal identity, quality pricing and source ownership compatible',async()=>{
    state.records.set(sourcePath,{...state.records.get(sourcePath),productType:'fish_meal'})
    const meal={...input(),productType:'fish_meal' as const,lines:buildPurchaseSettlementLines([{id:'entry-1',productType:'fish_meal',fishSpeciesId:null,fishSpeciesCodeSnapshot:null,fishSpeciesNameSnapshot:null,
      fishMealQuality:'bag',displayNameSnapshot:'包鱼仔',entryMode:'total',sequenceNo:null,weightGrams:300000,voided:false,recordedAtClient:'2026-08-03T10:00:00+08:00'}],'fish_meal','978'),totalAmountCents:21900}
    const saved=await savePurchaseSettlementDraft(meal)
    expect(saved).toMatchObject({draftId:'fish_meal_session_source',revision:1,lines:[expect.objectContaining({qualityCodeSnapshot:'bag',unitPriceCentsPerKg:73,amountCents:21900})]})
    expect(await loadPurchaseSettlementDraftForSource(bundle(),'fish_meal')).toMatchObject(saved)
    await expect(savePurchaseSettlementDraft({...saved,receiptNo:'FM-002'})).resolves.toMatchObject({draftId:saved.draftId,revision:2})
  })

  it('reports a confirmed concurrent-create Rules rejection as a clear reload conflict with actual ID',async()=>{
    state.transactionErrorCode='permission-denied'
    state.beforeCommit=()=>{
      state.records.set(draftPath,{...input(),createdBy:'other-device',createdAt:new Date()})
      state.records.set(guardPath,{productType:'fish_head',sourceSessionId:'source',draftId:'fish_head_session_source',createdBy:'other-device',createdAt:new Date()})
    }
    await expect(savePurchaseSettlementDraft(input())).rejects.toThrow('fish_head_session_source），请重新载入')
    expect(state.writes).not.toHaveBeenCalled()
    expect(state.records.get(draftPath)?.createdBy).toBe('other-device')
  })

  it.each([['permission-denied','没有权限'],['unavailable','网络连接']])('shows Chinese save errors for %s without concealing the Firebase code',async(code,text)=>{
    state.transactionErrorCode=code
    const problem=await savePurchaseSettlementDraft(input()).then(()=>null,(error:Error)=>error)
    expect(problem?.message).toContain(text)
    expect(problem?.message).toContain(code)
    expect(state.writes).not.toHaveBeenCalled()
  })
})
