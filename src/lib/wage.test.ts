import { describe,expect,it } from 'vitest'
import { money,normalizeWeight,parseRateCents,validWeight,wageCents } from './wage'
describe('wage calculations',()=>{
 it.each([[74,12,'8.88'],[71,15,'10.65'],[83,18,'14.94'],[300,12,'36.00']])('%ikg at %i cents', (kg,rate,result)=>expect(money(wageCents(kg,rate))).toBe(result))
 it('accepts boundary weights',()=>{expect(validWeight('1')).toBe(true);expect(validWeight('300')).toBe(true)})
 it('rejects out of range weights',()=>{expect(validWeight('0')).toBe(false);expect(validWeight('301')).toBe(false)})
 it('validates custom rate limits and precision',()=>{expect(parseRateCents('0.01')).toBe(1);expect(parseRateCents('9.99')).toBe(999);expect(parseRateCents('0')).toBeNull();expect(parseRateCents('10.00')).toBeNull();expect(parseRateCents('1.234')).toBeNull()})
 it('normalizes leading zeroes',()=>expect(normalizeWeight('0074')).toBe('74'))
})
