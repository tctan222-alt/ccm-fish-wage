import { expect, it } from 'vitest'
import { formatRetailAuditTimestamp, formatRetailDate } from './retailDate'
it.each([
  ['28/09/2026', '28092026 星期一 Mon'], ['29/09/2026', '29092026 星期二 Tue'],
  ['30/09/2026', '30092026 星期三 Wed'], ['01/10/2026', '01102026 星期四 Thu'],
  ['02/10/2026', '02102026 星期五 Fri'], ['03/10/2026', '03102026 星期六 Sat'],
  ['04/10/2026', '04102026 星期日 Sun'],
])('formats %s as a civil business date independent of device timezone', (date, display) => {
  expect(formatRetailDate(date)).toBe(display)
})
it('uses Malaysia audit time across UTC midnight without changing the stored business date', () => {
  expect(formatRetailAuditTimestamp(new Date('2026-10-02T18:01:00Z'))).toBe('03102026 星期六 Sat 02:01')
  expect(formatRetailDate('02/10/2026')).toBe('02102026 星期五 Fri')
})
it('renders malformed historical timestamps safely rather than crashing a locked receipt', () => {
  expect(formatRetailAuditTimestamp(new Date(NaN))).toBe('无法确认 Unknown')
  expect(formatRetailAuditTimestamp({ toDate: () => { throw new Error('invalid') } })).toBe('无法确认 Unknown')
})
