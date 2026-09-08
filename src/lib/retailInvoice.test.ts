import { describe, expect, it } from 'vitest'
import { RETAIL_EDIT_WINDOW_MS, retailEditStatus, retailInvoiceNumber } from './retailInvoice'

describe('Retail invoice identity and edit window', () => {
  it.each([[1, '08092026001'], [2, '08092026002'], [10, '08092026010'], [999, '08092026999'], [1000, '080920261000']])('formats sequence %i with at least three digits', (sequence, number) => {
    expect(retailInvoiceNumber('08/09/2026', sequence)).toBe(number)
  })
  it('uses the selected invoice business date, including backdated invoices', () => {
    expect(retailInvoiceNumber('09/09/2026', 1)).toBe('09092026001')
    expect(() => retailInvoiceNumber('31/02/2026', 1)).toThrow()
    expect(() => retailInvoiceNumber('08/09/2026', 0)).toThrow()
    expect(() => retailInvoiceNumber('08/09/2026', 1.5)).toThrow()
  })
  const createdMs = Date.parse('2026-09-08T05:00:00Z')
  const sale = { createdAt: { toDate: () => new Date(createdMs) } }
  it('allows editing before 72 elapsed hours independent of business date', () => {
    expect(retailEditStatus(sale, createdMs)).toBe('editable')
    expect(retailEditStatus(sale, createdMs + RETAIL_EDIT_WINDOW_MS - 1)).toBe('editable')
  })
  it('locks at exactly 72 hours and later', () => {
    expect(retailEditStatus(sale, createdMs + RETAIL_EDIT_WINDOW_MS)).toBe('expired')
    expect(retailEditStatus(sale, createdMs + RETAIL_EDIT_WINDOW_MS + 1)).toBe('expired')
  })
  it('does not enable editing without a resolved timestamp or with a future timestamp', () => {
    expect(retailEditStatus({}, createdMs)).toBe('unavailable')
    expect(retailEditStatus(sale, createdMs - 1)).toBe('unavailable')
    expect(retailEditStatus({ createdAt: { toDate: () => new Date(NaN) } }, createdMs)).toBe('unavailable')
    expect(retailEditStatus({ createdAt: { toDate: () => { throw new Error('invalid timestamp') } } }, createdMs)).toBe('unavailable')
  })
})
