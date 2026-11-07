import { describe,expect,it } from 'vitest'
import { prepareQlMasterAdoption,qlMasterFingerprint,qlMasterSourceRef,sourceFromQlMasterRef } from './fishHeadMasterAdoption'
import { QL_SEED_VERSION } from './qlPrices'
import type { FishHeadMasterImportRecord } from './fishHeadMasterImport'

const fish=(displayName:string,mod:Partial<FishHeadMasterImportRecord>={}):FishHeadMasterImportRecord=>({
  id:'old',speciesCode:'old',displayName,active:true,order:1,notes:'',...mod,
})

describe('QL Fish Head Master approval-gated write planning',()=>{
  it('maps all 36 immutable source references to source groups, methods, aliases and effective date',()=>{
    const plan=prepareQlMasterAdoption([])
    expect(plan.blocked).toHaveLength(0)
    expect(plan.entries).toHaveLength(36)
    expect(plan.creates).toBe(36)
    expect(new Set(plan.entries.map(item=>item.sourceRef)).size).toBe(36)
    for(let index=0;index<36;index++){
      const source=QL_SEED_VERSION.rows[index]
      expect(plan.entries[index]).toMatchObject({action:'create',sourceRef:qlMasterSourceRef(source),
        proposed:{basePriceCentsPerKg:source.priceCentsPerKg,method:source.method}})
      expect(sourceFromQlMasterRef(plan.entries[index].sourceRef)).toBe(source)
    }
    expect(sourceFromQlMasterRef('some-other-price-source')).toBeNull()
  })
  it('blocks generic fish with competing trawl/bottom or general/bottom prices',()=>{
    const entries=[fish('丁温',{id:'ding_wen',speciesCode:'ding_wen',basePriceCentsPerKg:190}),
      fish('青兰',{id:'qing_lan',speciesCode:'qing_lan',basePriceCentsPerKg:90})]
    const plan=prepareQlMasterAdoption(entries)
    expect(plan.blocked).toHaveLength(4)
    expect(plan.entries).toHaveLength(32)
    const explicit=prepareQlMasterAdoption(entries,plan.blocked.map(item=>item.sourceKey))
    expect(explicit.blocked).toHaveLength(0)
    expect(explicit.entries).toHaveLength(36)
    expect(explicit.entries.filter(item=>item.action==='create').length).toBeGreaterThan(0)
    expect(entries).toEqual([fish('丁温',{id:'ding_wen',speciesCode:'ding_wen',basePriceCentsPerKg:190}),
      fish('青兰',{id:'qing_lan',speciesCode:'qing_lan',basePriceCentsPerKg:90})])
    const trawl=explicit.entries.find(item=>item.proposed.method==='trawl')
    const bottom=explicit.entries.find(item=>item.proposed.sourceRow===38)
    expect(trawl?.proposed.basePriceCentsPerKg).toBe(200)
    expect(bottom?.proposed.basePriceCentsPerKg).toBe(210)
  })
  it('preserves an exact existing Master species ID and source name while changing only future default',()=>{
    const current=fish('金线',{id:'jin_xian',speciesCode:'jin_xian',basePriceCentsPerKg:205,notes:'keep'})
    const plan=prepareQlMasterAdoption([current])
    const item=plan.entries.find(entry=>entry.proposed.id==='jin_xian')
    expect(item).toMatchObject({action:'update',before:current,proposed:{displayName:'金线',basePriceCentsPerKg:210}})
    expect(plan.updates).toBe(1)
  })
  it('rejects duplicate, unrecognized and mismatched owner-approved conflict selectors',()=>{
    const current=[fish('丁温')]
    const blocked=prepareQlMasterAdoption(current).blocked[0].sourceKey
    expect(()=>prepareQlMasterAdoption(current,[blocked,blocked])).toThrow()
    expect(()=>prepareQlMasterAdoption(current,['unapproved:general'])).toThrow()
    expect(()=>prepareQlMasterAdoption([],['fake'])).toThrow()
  })
  it('rejects generated ID collisions even when owner requests separate records',()=>{
    const baseline=prepareQlMasterAdoption([fish('丁温')])
    const sourceKey=baseline.blocked[0].sourceKey
    const id=prepareQlMasterAdoption([]).entries.find(item=>item.sourceKey===sourceKey)!.proposed.id
    const colliding=fish('unrelated',{id,speciesCode:id})
    const plan=prepareQlMasterAdoption([fish('丁温'),colliding],[sourceKey])
    expect(plan.blocked.some(item=>item.sourceKey===sourceKey)).toBe(true)
  })
  it('fingerprints original price, snapshot timestamp and source mapping to detect a stale review',()=>{
    const before=fish('金线',{id:'a',speciesCode:'a',basePriceCentsPerKg:205,qlSourceRef:'foo',updatedAt:{seconds:100}})
    const start=qlMasterFingerprint([before])
    expect(qlMasterFingerprint([fish('金线',{...before})])).toBe(start)
    expect(qlMasterFingerprint([fish('金线',{...before,basePriceCentsPerKg:210})])).not.toBe(start)
    expect(qlMasterFingerprint([fish('金线',{...before,qlSourceRef:'bar'})])).not.toBe(start)
    expect(qlMasterFingerprint([fish('金线',{...before,updatedAt:{seconds:101}})])).not.toBe(start)
  })
  it('distinguishes an absent default from explicit null and detects same-second nanosecond changes',()=>{
    const missing=fish('金线',{updatedAt:{seconds:100,nanoseconds:1}})
    const unset=fish('金线',{basePriceCentsPerKg:null,updatedAt:{seconds:100,nanoseconds:1}})
    expect(qlMasterFingerprint([missing])).not.toBe(qlMasterFingerprint([unset]))
    expect(qlMasterFingerprint([missing])).not.toBe(qlMasterFingerprint([{...missing,updatedAt:{seconds:100,nanoseconds:2}}]))
    expect(qlMasterFingerprint([missing])).not.toBe(qlMasterFingerprint([{...missing,updatedBy:'another-user'}]))
  })
  it('uses explicit persisted links to prevent an old generic 丁温 from creating fresh cross-method conflicts',()=>{
    const legacy=fish('丁温',{id:'ding_wen',speciesCode:'ding_wen',basePriceCentsPerKg:190})
    const initial=prepareQlMasterAdoption([legacy])
    const approved=prepareQlMasterAdoption([legacy],initial.blocked.map(item=>item.sourceKey))
    expect(approved.blocked).toHaveLength(0)
    const adopted=approved.entries.map((entry,index)=>fish(entry.proposed.displayName,{
      ...entry.proposed,active:true,order:index+2,notes:'',qlSourceRef:entry.sourceRef,
    }))
    const recheck=prepareQlMasterAdoption([legacy,...adopted])
    expect(recheck.blocked).toHaveLength(0)
    expect(recheck.entries).toHaveLength(36)
    expect(recheck.creates).toBe(0)
    expect(recheck.updates).toBe(0)
    expect(recheck.unchanged).toBe(36)
  })
  it('re-adoption after stable source-link persistence is zero-price-change and has no new creates',()=>{
    const initial=prepareQlMasterAdoption([])
    const adopted=initial.entries.map((entry,index)=>fish(entry.proposed.displayName,{...entry.proposed,
      active:true,order:index+1,notes:'',qlSourceRef:entry.sourceRef}))
    const plan=prepareQlMasterAdoption(adopted)
    expect(plan.blocked).toHaveLength(0)
    expect(plan.creates).toBe(0)
    expect(plan.updates).toBe(0)
    expect(plan.unchanged).toBe(36)
  })
})
