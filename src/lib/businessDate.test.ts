import { describe,expect,it } from 'vitest'
import { assertBusinessDate,businessDateFromLegacy,businessDateFromSortKey,formatAuditTimestamp,monthKeyFromBusinessDate,parseBusinessDate,sortKeyFromBusinessDate } from './businessDate'

describe('business dates',()=>{
  it('uses DD/MM/YYYY and MM/YYYY without a Malaysia timezone day shift',()=>{
    expect(businessDateFromLegacy('2026-07-31')).toBe('31/07/2026')
    expect(monthKeyFromBusinessDate('31/07/2026')).toBe('07/2026')
    expect(sortKeyFromBusinessDate('31/07/2026')).toBe(20260731)
  })
  it('strictly rejects impossible dates but accepts leap day in 2028',()=>{
    expect(()=>assertBusinessDate('31/02/2026')).toThrow()
    expect(()=>assertBusinessDate('29/02/2026')).toThrow()
    expect(parseBusinessDate('29/02/2028')).toMatchObject({year:2028,month:2,day:29})
  })
  it('reads legacy ISO business dates and formats audit timestamps in Malaysia',()=>{
    expect(businessDateFromLegacy('31/07/2026')).toBe('31/07/2026')
    expect(formatAuditTimestamp(new Date('2026-07-30T16:30:00.000Z'))).toBe('31/07/2026 00:30')
  })
  it('converts date sort keys back to canonical business dates',()=>expect(businessDateFromSortKey(20280229)).toBe('29/02/2028'))
})
