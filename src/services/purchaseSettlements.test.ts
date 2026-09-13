import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { buildPurchaseSettlementLines,makeSettlementDraft,type PurchaseSettlementDraft } from '../lib/purchaseSettlement'

const state=vi.hoisted(()=>({records:new Map<string,Record<string,unknown>>(),writes:vi.fn(),failPath:'',uid:'u1' as string|null}))
vi.mock('../firebase',()=>({db:{},firebaseConfigured:true,auth:{get currentUser(){return state.uid?{uid:state.uid}:null}}}))
vi.mock('./weighing',()=>({loadWeighingSessions:vi.fn(),loadWeighingBundle:vi.fn()}))
vi.mock('firebase/firestore',()=>{
  const snapshot=(path:string)=>({id:path.split('/').at(-1),exists:()=>state.records.has(path),data:()=>state.records.get(path)})
  return {
    doc:(parent:{path?:string},...parts:string[])=>({path:[parent.path,...parts].filter(Boolean).join('/')}),
    getDoc:async(ref:{path:string})=>snapshot(ref.path),
    serverTimestamp:()=>new Date(),
    runTransaction:async(_db:unknown,callback:(transaction:unknown)=>Promise<unknown>)=>{
      const pending=new Map<string,Record<string,unknown>>()
      const result=await callback({
        get:async(ref:{path:string})=>snapshot(ref.path),
        set:(ref:{path:string},data:Record<string,unknown>)=>{if(ref.path===state.failPath)throw new Error('connection interrupted');pending.set(ref.path,data)},
      })
      for(const [path,data] of pending){state.records.set(path,data);state.writes(path,data)}
      return result
    },
  }
})
import { loadPurchaseSettlementDraft,savePurchaseSettlementDraft } from './purchaseSettlements'

const draftPath='purchaseSettlementDrafts/fish_head_20260803_v978',sourcePath='weighingSessions/source'
function input():PurchaseSettlementDraft {
  const lines=buildPurchaseSettlementLines([{id:'entry-1',productType:'fish_head',fishSpeciesId:'jin_xian',fishSpeciesCodeSnapshot:'jin_xian',fishSpeciesNameSnapshot:'金线',
    fishMealQuality:null,displayNameSnapshot:'金线',entryMode:'individual',sequenceNo:1,weightGrams:10000,voided:false,recordedAtClient:'2026-08-03T10:00:00+08:00'}],'fish_head','978')
  return {...makeSettlementDraft({productType:'fish_head',businessDate:'03/08/2026',dateSortKey:20260803,monthKey:'08/2026',monthSortKey:202608,vesselId:'v978',vesselCodeSnapshot:'978',receiptNo:'',lines,sourceEntryIds:['entry-1']}),
    sourceSessionId:'source',sourceSessionRevision:3}
}

beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-08-04T02:00:00Z'))
  state.records.clear();state.writes.mockClear();state.failPath='';state.uid='u1'
  state.records.set(sourcePath,{productType:'fish_head',weighingDate:'03/08/2026',vesselId:'v978',vesselCodeSnapshot:'978',revision:3,status:'completed',completedAt:new Date('2026-08-03T02:00:00Z')})
})
afterEach(()=>vi.useRealTimers())

describe('settlement draft transactions',()=>{
  it('saves the source revision and immutable before/after audit, preserving original creation fields',async()=>{
    const first=await savePurchaseSettlementDraft(input())
    state.uid='u2'
    const second=await savePurchaseSettlementDraft({...first,receiptNo:'FH-002'})
    expect(second).toMatchObject({revision:2,createdBy:'u1',createdAt:first.createdAt,updatedBy:'u2',sourceSessionId:'source',sourceSessionRevision:3})
    expect(state.records.get(`${draftPath}/actions/2`)).toMatchObject({beforeSnapshot:first,afterSnapshot:second,performedBy:'u2'})
    expect(await loadPurchaseSettlementDraft('fish_head',20260803,'v978')).toMatchObject(second)
  })

  it('rejects stale draft and weighing revisions before any write',async()=>{
    const first=await savePurchaseSettlementDraft(input())
    await savePurchaseSettlementDraft({...first,receiptNo:'other-device'})
    state.writes.mockClear()
    await expect(savePurchaseSettlementDraft(first)).rejects.toThrow('其他装置')
    state.records.set(sourcePath,{...state.records.get(sourcePath),revision:4})
    await expect(savePurchaseSettlementDraft(input())).rejects.toThrow('称重资料已变更')
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
    state.records.set(draftPath,legacy)
    await expect(savePurchaseSettlementDraft({...input(),revision:4})).resolves.toMatchObject({revision:5,createdBy:'legacy-user',sourceSessionId:'source'})
    state.records.set('weighingSessions/other',{...state.records.get(sourcePath)})
    await expect(savePurchaseSettlementDraft({...input(),sourceSessionId:'other',revision:5})).rejects.toThrow('来源不一致')
  })
})
