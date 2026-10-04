import { describe,expect,it } from 'vitest'
import { auditSettlementDateKeys } from './settlementDateKeyAudit'

describe('read-only release prerequisite date-key audit',()=>{
  it('finds missing and inconsistent keys across both historical formats without changing any header',()=>{
    const headers=[{id:'canonical-legacy',productType:'fish_head',weighingDate:'30/09/2026'},
      {id:'iso-legacy',productType:'fish_meal',weighingDate:'2026-08-31'},
      {id:'wrong',productType:'fish_head',weighingDate:'01/10/2026',dateSortKey:20260901},
      {id:'ready',productType:'fish_head',weighingDate:'01/10/2026',dateSortKey:20261001}]
    const before=JSON.stringify(headers)
    expect(auditSettlementDateKeys(headers)).toEqual([
      {id:'canonical-legacy',productType:'fish_head',weighingDate:'30/09/2026',before:null,after:20260930,reason:'missing'},
      {id:'iso-legacy',productType:'fish_meal',weighingDate:'2026-08-31',before:null,after:20260831,reason:'missing'},
      {id:'wrong',productType:'fish_head',weighingDate:'01/10/2026',before:20260901,after:20261001,reason:'inconsistent'},
    ])
    expect(JSON.stringify(headers)).toBe(before)
  })
  it('never guesses an invalid date or maps another product into a settlement',()=>{
    expect(auditSettlementDateKeys([{id:'invalid',productType:'fish_head',weighingDate:'31/02/2026'},
      {id:'unknown',productType:'other',weighingDate:'30/09/2026'}])).toEqual([
      {id:'invalid',productType:'fish_head',weighingDate:'31/02/2026',before:null,after:null,reason:'invalid_date'},
    ])
  })
})
