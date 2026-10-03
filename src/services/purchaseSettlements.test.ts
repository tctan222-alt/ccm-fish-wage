import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { buildPurchaseSettlementLines,draftIdForSourceSession,makeSettlementDraft,type PurchaseSettlementDraft } from '../lib/purchaseSettlement'
import type { WeighingBundle } from './weighing'

const state=vi.hoisted(()=>({records:new Map<string,Record<string,unknown>>(),writes:vi.fn(),failPath:'',uid:'u1' as string|null,retries:0,beforeCommit:null as (()=>void)|null,transactionErrorCode:''}))
vi.mock('../firebase',()=>({db:{},firebaseConfigured:true,auth:{get currentUser(){return state.uid?{uid:state.uid}:null}}}))
vi.mock('./weighing',()=>({loadWeighingSessions:vi.fn(),loadWeighingBundle:vi.fn()}))
vi.mock('firebase/firestore',()=>{
  const snapshot=(path:string)=>{const value=state.records.get(path);return {id:path.split('/').at(-1),exists:()=>Boolean(value),data:()=>value}}
  return {
    doc:(parent:{path?:string},...parts:string[])=>({path:[parent.path,...parts].filter(Boolean).join('/')}),
    collection:(parent:{path?:string},...parts:string[])=>({path:[parent.path,...parts].filter(Boolean).join('/')}),
    where:(field:string,_operator:string,value:unknown)=>({field,value}),
    query:(ref:{path:string},...filters:{field:string;value:unknown}[])=>({...ref,filters}),
    getDocs:async(ref:{path:string;filters?:{field:string;value:unknown}[]})=>({docs:[...state.records].filter(([path,data])=>path.startsWith(`${ref.path}/`)&&!path.slice(ref.path.length+1).includes('/')&&(ref.filters??[]).every(filter=>data[filter.field]===filter.value)).map(([path])=>snapshot(path))}),
    getDoc:async(ref:{path:string})=>snapshot(ref.path),
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
import { loadPurchaseSettlementDraft,loadPurchaseSettlementDraftForSource,loadPurchaseSettlementSource,savePurchaseSettlementDraft } from './purchaseSettlements'

const legacyDraftPath='purchaseSettlementDrafts/fish_head_20260803_v978',draftPath='purchaseSettlementDrafts/fish_head_session_source',sourcePath='weighingSessions/source'
const guardPath='purchaseSettlementSources/fish_head_session_source'
function stored(value:PurchaseSettlementDraft){const data={...value};delete data.draftId;return data}
function bundle():WeighingBundle {
  return {session:{...state.records.get(sourcePath),id:'source'},entries:[{...state.records.get(`${sourcePath}/entries/entry-1`),id:'entry-1',sessionId:'source'}],
    actions:[...state.records].filter(([path])=>path.startsWith(`${sourcePath}/actions/`)).map(([path,data])=>({...data,id:path.split('/').at(-1)}))} as WeighingBundle
}
function input():PurchaseSettlementDraft {
  const lines=buildPurchaseSettlementLines([{id:'entry-1',productType:'fish_head',fishSpeciesId:'jin_xian',fishSpeciesCodeSnapshot:'jin_xian',fishSpeciesNameSnapshot:'金线',
    fishMealQuality:null,displayNameSnapshot:'金线',entryMode:'individual',sequenceNo:1,weightGrams:10000,voided:false,recordedAtClient:'2026-08-03T10:00:00+08:00'}],'fish_head','978')
  return {...makeSettlementDraft({productType:'fish_head',businessDate:'03/08/2026',dateSortKey:20260803,monthKey:'08/2026',monthSortKey:202608,vesselId:'v978',vesselCodeSnapshot:'978',receiptNo:'',lines,sourceEntryIds:['entry-1']}),
    sourceSessionId:'source',sourceSessionRevision:3}
}

beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-08-04T02:00:00Z'))
  state.records.clear();state.writes.mockClear();state.failPath='';state.uid='u1';state.retries=0;state.beforeCommit=null;state.transactionErrorCode=''
  state.records.set(sourcePath,{productType:'fish_head',weighingDate:'03/08/2026',vesselId:'v978',vesselCodeSnapshot:'978',revision:3,status:'completed',completedAt:new Date('2026-08-03T02:00:00Z')})
  state.records.set(`${sourcePath}/entries/entry-1`,{sessionId:'source',productType:'fish_head',weighingDate:'03/08/2026',vesselId:'v978',voided:false,recordedAt:new Date('2026-08-03T02:00:00Z')})
})
afterEach(()=>vi.useRealTimers())

describe('source-authoritative draft lookup',()=>{
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

describe('settlement draft transactions',()=>{
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
