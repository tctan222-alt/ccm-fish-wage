import { describe,expect,it } from 'vitest'
import { canEditSettlement,settlementEditDeadline } from './settlementLifecycle'

describe('settlement lifecycle independently uses 90 consecutive days',()=>{
  const finalizedAt=new Date('2026-01-01T01:02:03Z')
  const value={status:'settlement_finalized' as const,finalizedAt}
  it('drafts have no settlement deadline',()=>{
    expect(canEditSettlement({status:'settlement_draft'},new Date('2030-01-01'))).toBe(true)
    expect(settlementEditDeadline({status:'settlement_draft'})).toBeNull()
  })
  it('locks exactly at 90 days, including Firestore nanoseconds',()=>{
    const deadline=finalizedAt.getTime()+90*86400000
    expect(canEditSettlement(value,new Date(deadline-1000))).toBe(true)
    expect(canEditSettlement(value,new Date(deadline))).toBe(false)
    expect(canEditSettlement(value,new Date(deadline+1))).toBe(false)
    expect(canEditSettlement({...value,finalizedAt:{seconds:finalizedAt.getTime()/1000,nanoseconds:500_000_000}},new Date(deadline))).toBe(true)
    expect(settlementEditDeadline(value)?.getTime()).toBe(deadline)
  })
  it('unknown trusted completion time fails closed',()=>{
    expect(canEditSettlement({status:'settlement_finalized'},new Date())).toBe(false)
    expect(canEditSettlement({...value,finalizedAt:{toMillis:()=>NaN}},new Date())).toBe(false)
  })
})
