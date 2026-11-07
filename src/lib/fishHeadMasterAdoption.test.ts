import { describe,expect,it } from 'vitest'
import { prepareQlMasterAdoption,qlMasterFingerprint,qlMasterSourceRef,sourceFromQlMasterRef } from './fishHeadMasterAdoption'
import { QL_FISH_HEAD_MASTER_ROWS,isQlMarketPriceRow } from './fishHeadMasterImport'
import { QL_SEED_VERSION } from './qlPrices'
import type { FishHeadMasterImportRecord } from './fishHeadMasterImport'

const fish=(displayName:string,mod:Partial<FishHeadMasterImportRecord>={}):FishHeadMasterImportRecord=>({
  id:'old',speciesCode:'old',displayName,active:true,order:1,notes:'',...mod,
})

describe('QL non-bottom Fish Head Master adoption planning',()=>{
  it('maps 34 eligible source groups with null defaults for conflicting market-price aliases',()=>{
    const plan=prepareQlMasterAdoption([])
    expect(QL_SEED_VERSION.rows).toHaveLength(36)
    expect(plan.blocked).toHaveLength(0)
    expect(plan.entries).toHaveLength(34)
    expect(plan.creates).toBe(34)
    expect(new Set(plan.entries.map(item=>item.sourceRef)).size).toBe(34)
    plan.entries.forEach((item,index)=>{
      const source=QL_FISH_HEAD_MASTER_ROWS[index]
      expect(item).toMatchObject({action:'create',sourceRef:qlMasterSourceRef(source),
        proposed:{basePriceCentsPerKg:isQlMarketPriceRow(source)?null:source.priceCentsPerKg,method:source.method}})
      expect(sourceFromQlMasterRef(item.sourceRef)).toBe(source)
      expect(item.proposed.method).not.toBe('bottom')
    })
    expect(sourceFromQlMasterRef('some-other-price-source')).toBeNull()
  })

  it('automatically creates separate empty-price grouped identities without overwriting old generic 丁温/青兰',()=>{
    const entries=[fish('丁温',{id:'ding_wen',speciesCode:'ding_wen',basePriceCentsPerKg:190}),
      fish('青兰',{id:'qing_lan',speciesCode:'qing_lan',basePriceCentsPerKg:90})]
    const baseline=structuredClone(entries)
    const plan=prepareQlMasterAdoption(entries)
    expect(plan.blocked).toHaveLength(0)
    expect(plan.entries).toHaveLength(34)
    const trawl=plan.entries.find(item=>item.proposed.method==='trawl')!
    const general=plan.entries.find(item=>item.proposed.sourceGroupKey==='zhuli-qinglan')!
    expect(trawl.action).toBe('create')
    expect(trawl.proposed.basePriceCentsPerKg).toBeNull()
    expect(general.action).toBe('create')
    expect(general.proposed.basePriceCentsPerKg).toBeNull()
    expect(plan.entries.some(item=>item.proposed.method==='bottom')).toBe(false)
    expect(entries).toEqual(baseline)
  })

  it('preserves exact existing ID and name for an unambiguous row',()=>{
    const current=fish('金线',{id:'jin_xian',speciesCode:'jin_xian',basePriceCentsPerKg:205,notes:'keep'})
    const plan=prepareQlMasterAdoption([current])
    const item=plan.entries.find(entry=>entry.proposed.id==='jin_xian')
    expect(item).toMatchObject({action:'update',before:current,proposed:{displayName:'金线',basePriceCentsPerKg:210}})
    expect(plan.updates).toBe(1)
  })

  it('still rejects invalid, repeated or unapproved manual selectors',()=>{
    const current=[fish('大目力',{active:false})]
    const blocked=prepareQlMasterAdoption(current).blocked[0].sourceKey
    expect(()=>prepareQlMasterAdoption(current,[blocked,blocked])).toThrow()
    expect(()=>prepareQlMasterAdoption(current,['unapproved:general'])).toThrow()
    expect(()=>prepareQlMasterAdoption([],['fake'])).toThrow()
  })

  it('rejects a generated ID collision instead of overwriting an unrelated existing fish',()=>{
    const market=prepareQlMasterAdoption([fish('丁温')]).entries.find(item=>item.proposed.method==='trawl')!
    const colliding=fish('unrelated',{id:market.proposed.id,speciesCode:market.proposed.speciesCode})
    const plan=prepareQlMasterAdoption([fish('丁温'),colliding])
    expect(plan.blocked.some(item=>item.sourceKey===market.sourceKey)).toBe(true)
  })

  it('fingerprints field absence, source links and full nanosecond timestamps',()=>{
    const before=fish('金线',{id:'a',speciesCode:'a',basePriceCentsPerKg:205,qlSourceRef:'foo',updatedAt:{seconds:100,nanoseconds:1}})
    const start=qlMasterFingerprint([before])
    expect(qlMasterFingerprint([fish('金线',{...before})])).toBe(start)
    expect(qlMasterFingerprint([fish('金线',{...before,basePriceCentsPerKg:210})])).not.toBe(start)
    expect(qlMasterFingerprint([fish('金线',{...before,qlSourceRef:'bar'})])).not.toBe(start)
    expect(qlMasterFingerprint([fish('金线',{...before,updatedAt:{seconds:100,nanoseconds:2}})])).not.toBe(start)
    const missing=fish('金线',{updatedAt:{seconds:100,nanoseconds:1}})
    const unset=fish('金线',{basePriceCentsPerKg:null,updatedAt:{seconds:100,nanoseconds:1}})
    expect(qlMasterFingerprint([missing])).not.toBe(qlMasterFingerprint([unset]))
  })

  it('does not create re-adoption conflicts when original generic fish remain and null-price rows have exact source links',()=>{
    const legacy=fish('丁温',{id:'ding_wen',speciesCode:'ding_wen',basePriceCentsPerKg:190})
    const initial=prepareQlMasterAdoption([legacy])
    expect(initial.blocked).toHaveLength(0)
    const adopted=initial.entries.map((entry,index)=>fish(entry.proposed.displayName,{
      ...entry.proposed,active:true,order:index+2,notes:'',qlSourceRef:entry.sourceRef,
    }))
    const recheck=prepareQlMasterAdoption([legacy,...adopted])
    expect(recheck.blocked).toHaveLength(0)
    expect(recheck.entries).toHaveLength(34)
    expect(recheck.creates).toBe(0)
    expect(recheck.updates).toBe(0)
    expect(recheck.unchanged).toBe(34)
  })

  it('is idempotent for the 34 eligible rows without creating bottom identities',()=>{
    const initial=prepareQlMasterAdoption([])
    const adopted=initial.entries.map((entry,index)=>fish(entry.proposed.displayName,{...entry.proposed,
      active:true,order:index+1,notes:'',qlSourceRef:entry.sourceRef}))
    const plan=prepareQlMasterAdoption(adopted)
    expect(plan.blocked).toHaveLength(0)
    expect(plan.creates).toBe(0)
    expect(plan.updates).toBe(0)
    expect(plan.unchanged).toBe(34)
  })
})
