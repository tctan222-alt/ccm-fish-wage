import { describe, expect, it } from 'vitest'
import { formatRetailAuditTimestamp, formatRetailDate } from './retailDate'

describe('Retail date presentation', () => {
  it.each([
    ['07/09/2026', '07092026 星期一 Mon'],
    ['08/09/2026', '08092026 星期二 Tue'],
    ['09/09/2026', '09092026 星期三 Wed'],
    ['10/09/2026', '10092026 星期四 Thu'],
    ['11/09/2026', '11092026 星期五 Fri'],
    ['12/09/2026', '12092026 星期六 Sat'],
    ['13/09/2026', '13092026 星期日 Sun'],
  ])('formats %s as compact date plus Chinese and English weekday', (input, expected) => {
    expect(formatRetailDate(input)).toBe(expected)
  })

  it.each([
    ['29/02/2024', '29022024 星期四 Thu'],
    ['31/12/2026', '31122026 星期四 Thu'],
    ['01/01/2027', '01012027 星期五 Fri'],
  ])('calculates civil weekdays across calendar boundaries for %s', (input, expected) => {
    expect(formatRetailDate(input)).toBe(expected)
  })

  it.each(['', '08/09/', '31/02/2026', '20260908'])('does not invent a date for invalid input %s', input => {
    expect(formatRetailDate(input)).toBe(input)
  })

  it('uses the Malaysia calendar date for an audit timestamp crossing UTC midnight', () => {
    const date = new Date('2026-09-07T16:05:45Z')
    expect(formatRetailAuditTimestamp(date)).toBe('08092026 星期二 Tue 00:05')
    expect(formatRetailAuditTimestamp({ toDate: () => date })).toBe('08092026 星期二 Tue 00:05')
    expect(date.toISOString()).toBe('2026-09-07T16:05:45.000Z')
  })
})
