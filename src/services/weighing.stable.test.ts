import { beforeEach,describe,expect,it,vi } from 'vitest'
import { newWeighingSession,buildWeighingEntry } from '../lib/weighing'

const store=vi.hoisted(()=>({session:{} as Record<string,unknown>,entries:[] as Record<string,unknown>[],actions:[] as Record<string,unknown>[],
  afterEntries:null as (()=>void)|null,beforeEntries:null as (()=>void)|null,sessionReads:0,entryReads:0,actionReads:0,
  metadata:{fromCache:false,hasPendingWrites:false},dirty:'',fail:''}))
vi.mock('../firebase',()=>({db:{},auth:{currentUser:{uid:'u1'}},firebaseConfigured:true}))
vi.mock('firebase/firestore',()=>{
  const getDocFromServer=vi.fn(async(ref:{path:string})=>{
    if(store.fail)throw Object.assign(new Error('server unavailable'),{code:store.fail})
    store.sessionReads++
    const data={...store.session}
    return {id:ref.path.split('/').at(-1),exists:()=>true,data:()=>data,metadata:{...store.metadata,
      hasPendingWrites:store.metadata.hasPendingWrites||(store.dirty==='closing-session'&&store.sessionReads%2===0)}}
  })
  const getDocsFromServer=vi.fn(async(ref:{path:string})=>{
    if(store.fail)throw Object.assign(new Error('server unavailable'),{code:store.fail})
    const entryQuery=ref.path.endsWith('/entries')
    if(entryQuery){store.entryReads++;store.beforeEntries?.()}else store.actionReads++
    const docs=(entryQuery?store.entries:store.actions).map(data=>({id:data.id,data:()=>({...data}),metadata:{...store.metadata,
      hasPendingWrites:store.metadata.hasPendingWrites||store.dirty===(entryQuery?'entry-document':'action-document')}}))
    if(entryQuery)store.afterEntries?.()
    return {docs,metadata:{...store.metadata,hasPendingWrites:store.metadata.hasPendingWrites||store.dirty===(entryQuery?'entries':'actions')}}
  })
  return {doc:(parent:{path?:string},...parts:string[])=>({path:[parent.path,...parts].filter(Boolean).join('/')}),
    collection:(parent:{path?:string},...parts:string[])=>({path:[parent.path,...parts].filter(Boolean).join('/')}),
    getDocFromServer,getDocsFromServer,getDoc:getDocFromServer,getDocs:getDocsFromServer,
    runTransaction:vi.fn(),serverTimestamp:vi.fn(),setDoc:vi.fn(),writeBatch:vi.fn()}
})
import { loadStableWeighingBundle } from './weighing'

beforeEach(()=>{
  store.session={...newWeighingSession({id:'source',productType:'fish_head',weighingDate:'01/10/2026',vesselId:'v833',vesselCodeSnapshot:'833',vesselNameSnapshot:'833'}),revision:10,status:'completed',completedAt:new Date('2026-10-01T00:00:00Z'),fishHeadBasketCount:1,fishHeadWeightGrams:100000,totalWeightGrams:100000,lastSequenceNo:1}
  store.entries=[{...buildWeighingEntry({id:'entry-a',clientEntryId:'entry-a',sessionId:'source',productType:'fish_head',fishSpeciesId:'hong_mu_lin',fishSpecies:{id:'hong_mu_lin',speciesCode:'hong_mu_lin',displayName:'红目林'},fishMealQuality:null,entryMode:'individual',sequenceNo:1,weightGrams:100000,remark:'',recordedAt:new Date('2026-10-01T02:00:00Z'),recordedAtClient:'2026-10-01T10:00:00+08:00',recordedBy:'u1'})}]
  store.actions=[];store.afterEntries=null;store.beforeEntries=null;store.sessionReads=0;store.entryReads=0;store.actionReads=0
  store.metadata={fromCache:false,hasPendingWrites:false};store.dirty='';store.fail=''
})

describe('stable settlement source reads',()=>{
  it('discards old entries when a basket correction commits before the closing session read',async()=>{
    store.afterEntries=()=>{store.afterEntries=null;store.session={...store.session,revision:11};store.entries=[{...store.entries[0],weightGrams:80000}]}
    const bundle=await loadStableWeighingBundle('source')
    expect(bundle.session.revision).toBe(11)
    expect(bundle.entries[0].weightGrams).toBe(80000)
  })
  it('discards metadata drift even when a malformed writer leaves the revision unchanged',async()=>{
    store.afterEntries=()=>{store.afterEntries=null;store.session={...store.session,vesselId:'v978',vesselCodeSnapshot:'978'};store.entries=[{...store.entries[0],weightGrams:80000}]}
    const bundle=await loadStableWeighingBundle('source')
    expect(bundle.session.vesselId).toBe('v978')
    expect(bundle.entries[0].weightGrams).toBe(80000)
  })
  it('never accepts a latency-compensated server result containing pending local writes',async()=>{
    store.metadata.hasPendingWrites=true
    await expect(loadStableWeighingBundle('source')).rejects.toThrow('重新载入结单')
  })
  it('accepts an unchanged authoritative revision in one attempt',async()=>{
    const bundle=await loadStableWeighingBundle('source')
    expect(bundle.session.revision).toBe(10)
    expect(bundle.entries[0].weightGrams).toBe(100000)
    expect(store.sessionReads).toBe(2)
    expect(store.entryReads).toBe(1)
    expect(store.actionReads).toBe(1)
  })
  it('also retries when the entry query already sees the corrected basket',async()=>{
    store.beforeEntries=()=>{store.beforeEntries=null;store.session={...store.session,revision:11};store.entries=[{...store.entries[0],weightGrams:80000}]}
    const bundle=await loadStableWeighingBundle('source')
    expect(bundle.session.revision).toBe(11)
    expect(bundle.entries[0].weightGrams).toBe(80000)
    expect(store.entryReads).toBe(2)
  })
  it('discards two rapid corrections and returns only the final revision and its actions',async()=>{
    store.afterEntries=()=>{
      const revision=Number(store.session.revision)+1
      store.session={...store.session,revision};store.entries=[{...store.entries[0],weightGrams:revision===11?80000:60000}]
      store.actions=[{id:`correction-${revision}`,type:'session_update',beforeSnapshot:{weighingDate:'01/10/2026',vesselId:'v833'},afterSnapshot:{weighingDate:'01/10/2026',vesselId:'v833'},performedAt:new Date()}]
      if(revision===12)store.afterEntries=null
    }
    const bundle=await loadStableWeighingBundle('source')
    expect(bundle.session.revision).toBe(12)
    expect(bundle.entries[0].weightGrams).toBe(60000)
    expect(bundle.actions?.map(action=>action.id)).toEqual(['correction-12'])
    expect(store.entryReads).toBe(3)
  })
  it('fails after three changing attempts and never returns the last stale bundle',async()=>{
    store.afterEntries=()=>{store.session={...store.session,revision:Number(store.session.revision)+1}}
    await expect(loadStableWeighingBundle('source')).rejects.toThrow('称重资料正在修改，请稍后重新载入结单。')
    expect(store.sessionReads).toBe(6)
    expect(store.entryReads).toBe(3)
  })
  it.each(['entries','actions','entry-document','action-document','closing-session'])('rejects pending data at the %s boundary',async dirty=>{
    store.dirty=dirty;store.actions=[{id:'metadata-action',type:'session_update'}]
    await expect(loadStableWeighingBundle('source')).rejects.toThrow('重新载入结单')
  })
  it('does not accept cached source data as a server-authoritative settlement',async()=>{
    store.metadata.fromCache=true
    await expect(loadStableWeighingBundle('source')).rejects.toThrow('重新载入结单')
  })
  it.each([
    {status:'weighing'}, {productType:'fish_meal'}, {weighingDate:'02/10/2026'}, {vesselId:'v978'},
    {vesselCodeSnapshot:'978'}, {totalWeightGrams:80000}, {externalSlipNo:'corrected-slip'},
  ])('does not mix entry data with changed source tokens %j',async patch=>{
    store.afterEntries=()=>{store.afterEntries=null;store.session={...store.session,...patch};store.entries=[{...store.entries[0],weightGrams:80000}]}
    expect((await loadStableWeighingBundle('source')).entries[0].weightGrams).toBe(80000)
  })
  it.each(['create','kg','species','void'])('returns active basket data after concurrent %s correction',async mutation=>{
    store.afterEntries=()=>{
      store.afterEntries=null;store.session={...store.session,revision:11}
      if(mutation==='create')store.entries=[...store.entries,{...store.entries[0],id:'entry-b',clientEntryId:'entry-b',sequenceNo:2,weightGrams:20000}]
      if(mutation==='kg')store.entries=[{...store.entries[0],weightGrams:80000}]
      if(mutation==='species')store.entries=[{...store.entries[0],fishSpeciesId:'jin_xian',fishSpeciesCodeSnapshot:'jin_xian',fishSpeciesNameSnapshot:'金线',displayNameSnapshot:'金线'}]
      if(mutation==='void')store.entries=[{...store.entries[0],voided:true}]
    }
    const bundle=await loadStableWeighingBundle('source')
    expect(bundle.session.revision).toBe(11)
    const active=bundle.entries.filter(entry=>!entry.voided)
    if(mutation==='create')expect(active.map(entry=>entry.id).sort()).toEqual(['entry-a','entry-b'])
    if(mutation==='kg')expect(active[0].weightGrams).toBe(80000)
    if(mutation==='species')expect(active[0].fishSpeciesId).toBe('jin_xian')
    if(mutation==='void'){expect(active).toEqual([]);expect(bundle.entries[0].voided).toBe(true)}
  })
  it.each([0,NaN,undefined,'10'])('fails closed on an invalid source revision %s',async revision=>{
    store.session={...store.session,revision}
    await expect(loadStableWeighingBundle('source')).rejects.toThrow('版本不正确')
  })
  it('reports a clear network error without falling back to cached weights',async()=>{
    store.fail='unavailable'
    await expect(loadStableWeighingBundle('source')).rejects.toThrow('请检查网络')
    expect(store.entryReads).toBe(0)
  })
})
