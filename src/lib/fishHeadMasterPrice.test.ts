import { describe,expect,it } from 'vitest'
import { fishHeadMasterBasePriceCents,fishHeadMasterPriceInputToCents,fishHeadMasterPriceInputValue } from './fishHeadMasterPrice'

describe('Fish Head Master base prices',()=>{
  it('retains existing defaults for legacy records without writing or seeding them',()=>{
    expect(fishHeadMasterBasePriceCents({displayName:'金线'})).toBe(205)
    expect(fishHeadMasterBasePriceCents({displayName:'未定价鱼'})).toBeNull()
  })
  it('uses explicit Master edits and preserves an intentionally unset price',()=>{
    expect(fishHeadMasterBasePriceCents({displayName:'金线',basePriceCentsPerKg:260})).toBe(260)
    expect(fishHeadMasterBasePriceCents({displayName:'金线',basePriceCentsPerKg:null})).toBeNull()
  })
  it.each([['',null],['  ',null],['2.05',205],['2.6',260],['0.29',29],['99999.95',9999995]] as const)(
    'converts %s to exact integer cents %s',(input,cents)=>expect(fishHeadMasterPriceInputToCents(input)).toBe(cents))
  it.each(['-2.50','2.055','abc','Infinity','0','100000.00','99999.96','9007199254740993','1e2','2,50'])(
    'rejects invalid price %s',input=>expect(()=>fishHeadMasterPriceInputToCents(input)).toThrow())
  it('formats editable inputs without a vessel premium',()=>{
    expect(fishHeadMasterPriceInputValue({displayName:'金线'})).toBe('2.05')
    expect(fishHeadMasterPriceInputValue({displayName:'金线',basePriceCentsPerKg:260})).toBe('2.60')
    expect(fishHeadMasterPriceInputValue({displayName:'金线',basePriceCentsPerKg:null})).toBe('')
  })
})
