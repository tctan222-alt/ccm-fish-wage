import { expect, it } from 'vitest'
import { retailEditStatus, retailInvoiceNumber } from './retailInvoice'
const created = Date.parse('2026-10-01T02:00:00Z')
const sale = { createdAt: { toDate: () => new Date(created) } }
it.each([0, 86400, 29 * 86400, 2591999])('allows age %s seconds from the original timestamp', age => {
  expect(retailEditStatus(sale, created + age * 1000)).toBe('editable')
})
it.each([2592000, 2592001])('locks age %s seconds, including the exact deadline', age => {
  expect(retailEditStatus(sale, created + age * 1000)).toBe('expired')
})
it('fails closed for missing/invalid/future timestamps', () => {
  expect(retailEditStatus({}, created)).toBe('unavailable')
  expect(retailEditStatus(sale, created - 1)).toBe('unavailable')
  expect(retailEditStatus({ createdAt: { toDate: () => new Date(NaN) } }, created)).toBe('unavailable')
})
it.each([[1, '03102026001'], [2, '03102026002'], [999, '03102026999'], [1000, '031020261000']])('uses selected business date for sequence %s', (sequence, expected) => {
  expect(retailInvoiceNumber('03/10/2026', sequence as number)).toBe(expected)
})
