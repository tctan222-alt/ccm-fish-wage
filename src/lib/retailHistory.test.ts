import { describe, expect, it } from 'vitest'
import { malaysiaBusinessDate } from './businessDate'
import { retailHistoryRange, shiftRetailWeek } from './retailHistory'

describe('retail history date ranges', () => {
  it('uses the Malaysia business date for Today on either side of local midnight', () => {
    const beforeMidnight = malaysiaBusinessDate(new Date('2026-09-07T15:59:59Z'))
    const afterMidnight = malaysiaBusinessDate(new Date('2026-09-07T16:00:00Z'))
    expect(retailHistoryRange('today', beforeMidnight, '', '')).toEqual({ fromDate: '07/09/2026', toDate: '07/09/2026' })
    expect(retailHistoryRange('today', afterMidnight, '', '')).toEqual({ fromDate: '08/09/2026', toDate: '08/09/2026' })
  })

  it.each([
    ['07/09/2026', '07/09/2026', '13/09/2026'],
    ['13/09/2026', '07/09/2026', '13/09/2026'],
    ['30/09/2026', '28/09/2026', '04/10/2026'],
    ['01/01/2027', '28/12/2026', '03/01/2027'],
    ['29/02/2024', '26/02/2024', '03/03/2024'],
  ])('uses Monday through Sunday for week containing %s', (anchor, fromDate, toDate) => {
    expect(retailHistoryRange('week', anchor, '', '')).toEqual({ fromDate, toDate })
  })

  it('keeps custom range endpoints inclusive and accepts a single day', () => {
    expect(retailHistoryRange('range', '', '30/08/2026', '08/09/2026')).toEqual({ fromDate: '30/08/2026', toDate: '08/09/2026' })
    expect(retailHistoryRange('range', '', '08/09/2026', '08/09/2026')).toEqual({ fromDate: '08/09/2026', toDate: '08/09/2026' })
  })

  it('compares dates chronologically instead of their formatted strings', () => {
    expect(retailHistoryRange('range', '', '31/12/2026', '01/01/2027')).toEqual({ fromDate: '31/12/2026', toDate: '01/01/2027' })
    expect(() => retailHistoryRange('range', '', '01/01/2027', '31/12/2026')).toThrow('开始日期不可晚于结束日期')
  })

  it.each(['', '31/09/2026', '29/02/2026', '2026-09-08'])('rejects invalid selected date %j', invalid => {
    expect(() => retailHistoryRange('range', '', invalid, '08/09/2026')).toThrow('请选择有效日期')
    expect(() => retailHistoryRange('range', '', '08/09/2026', invalid)).toThrow('请选择有效日期')
    expect(() => retailHistoryRange('today', invalid, '', '')).toThrow('请选择有效日期')
    expect(() => retailHistoryRange('week', invalid, '', '')).toThrow('请选择有效日期')
  })

  it.each([
    ['28/09/2026', 1, '05/10/2026'],
    ['28/12/2026', 1, '04/01/2027'],
    ['04/01/2027', -1, '28/12/2026'],
    ['22/02/2024', 1, '29/02/2024'],
    ['08/09/2026', 0, '08/09/2026'],
  ])('shifts %s by %s whole weeks', (anchor, offset, expected) => {
    expect(shiftRetailWeek(anchor, offset)).toBe(expected)
  })

  it('rejects invalid week navigation inputs', () => {
    expect(() => shiftRetailWeek('', 1)).toThrow('请选择有效日期')
    expect(() => shiftRetailWeek('08/09/2026', 0.5)).toThrow('周偏移无效')
    expect(() => shiftRetailWeek('08/09/2026', Number.NaN)).toThrow('周偏移无效')
  })
})
