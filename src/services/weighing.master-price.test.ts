import { beforeEach,describe,expect,it,vi } from 'vitest'
import type { FishSpeciesRecord } from '../lib/weighing'

const state=vi.hoisted(()=>({docs:new Map<string,Record<string,unknown>>(),writes:[] as {path:string;data:Record<string,unknown>}[]}))
vi.mock('../firebase',()=>({db:{},auth:{currentUser:{uid:'master-user'}},firebaseConfigured:true}))
vi.mock('firebase/firestore',()=>({
  doc:(_db:unknown,...parts:string[])=>({path:parts.join('/')}),
  collection:(_db:unknown,...parts:string[])=>({path:parts.join('/')}),
  getDoc:vi.fn(async(ref:{path:string})=>({exists:()=>state.docs.has(ref.path),data:()=>state.docs.get(ref.path)})),
  getDocs:vi.fn(async()=>({docs:[...state.docs].filter(([path])=>path.startsWith('fishSpecies/')).map(([path,data])=>({id:path.split('/')[1],data:()=>data}))})),
  getDocFromServer:vi.fn(),getDocsFromServer:vi.fn(),runTransaction:vi.fn(),setDoc:vi.fn(),
  serverTimestamp:()=>({kind:'server-time'}),
  writeBatch:()=>({
    set(ref:{path:string},data:Record<string,unknown>){state.writes.push({path:ref.path,data});return this},
    async commit(){state.writes.forEach(write=>state.docs.set(write.path,write.data))},
  }),
}))
import { loadFishSpecies,saveFishSpecies } from './weighing'

const item=(price?:number|null):FishSpeciesRecord=>({id:'jin_xian',speciesCode:'jin_xian',displayName:'金线',active:true,order:1,notes:'',
  ...(price===undefined?{}:{basePriceCentsPerKg:price})})
beforeEach(()=>{state.docs.clear();state.writes=[]})

describe('Fish Head Master price persistence',()=>{
  it.each([null,undefined])('fills an unset %s Master price and records updated metadata',async price=>{
    const original={...item(price),createdBy:'creator',createdAt:{seconds:100},updatedBy:'old-user',updatedAt:{seconds:150},inactiveBy:null,inactiveAt:null}
    state.docs.set('fishSpecies/jin_xian',original)
    const saved=await saveFishSpecies({...item(),basePriceCentsPerKg:260})
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0]).toEqual({path:'fishSpecies/jin_xian',data:expect.objectContaining({basePriceCentsPerKg:260,
      createdBy:'creator',createdAt:{seconds:100},updatedBy:'master-user',updatedAt:{kind:'server-time'}})})
    expect(saved).toMatchObject({basePriceCentsPerKg:260,updatedBy:'master-user'})
    expect((await loadFishSpecies())[0]).toMatchObject({basePriceCentsPerKg:260})
  })
  it('edits the existing Master only, preserving historical settlement snapshots and Retail Master',async()=>{
    state.docs.set('fishSpecies/jin_xian',{...item(250),createdBy:'creator',createdAt:{seconds:100}})
    const historical=Object.freeze({unitPriceCentsPerKg:255,defaultUnitPriceCentsPerKg:255,amountCents:25500,revision:4})
    const retail=Object.freeze({chineseName:'金线',suggestedPriceCents:900})
    state.docs.set('purchaseSettlements/saved-history',historical)
    state.docs.set('retailFish/jin_xian',retail)
    await saveFishSpecies({...item(260)})
    expect(state.writes.map(write=>write.path)).toEqual(['fishSpecies/jin_xian'])
    expect(state.docs.get('purchaseSettlements/saved-history')).toBe(historical)
    expect(state.docs.get('retailFish/jin_xian')).toBe(retail)
    expect(historical.unitPriceCentsPerKg).toBe(255)
  })
  it('preserves a stored price when a legacy shape is saved for an unrelated field',async()=>{
    state.docs.set('fishSpecies/jin_xian',{...item(260),createdBy:'creator',createdAt:{seconds:100}})
    await saveFishSpecies({...item(),notes:'只改备注'})
    expect(state.writes[0].data.basePriceCentsPerKg).toBe(260)
  })
  it('stores explicit null without replacing it with the legacy fallback',async()=>{
    state.docs.set('fishSpecies/jin_xian',{...item(250),createdBy:'creator',createdAt:{seconds:100}})
    await saveFishSpecies(item(null))
    expect(state.writes[0].data.basePriceCentsPerKg).toBeNull()
  })
  it.each([-1,0,2.5,9999996,NaN,Infinity])('rejects invalid cents %s without a write',async price=>{
    await expect(saveFishSpecies(item(price))).rejects.toThrow('基础默认价')
    expect(state.writes).toEqual([])
  })
})
