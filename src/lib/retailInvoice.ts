import { assertBusinessDate } from './businessDate'
import type { RetailSale } from './retailSales'

export const RETAIL_EDIT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
// UI hint only; Rules use request.time at the final atomic save.
export function retailEditStatus(sale: Pick<RetailSale, 'createdAt'>, nowMs = Date.now()): 'editable' | 'expired' | 'unavailable' {
  let start: number | undefined
  try { start = sale.createdAt?.toDate().getTime() } catch { return 'unavailable' }
  if (start === undefined || !Number.isFinite(start) || !Number.isFinite(nowMs) || nowMs < start) return 'unavailable'
  return nowMs - start < RETAIL_EDIT_WINDOW_MS ? 'editable' : 'expired'
}
export function retailInvoiceNumber(businessDate: string, sequence: number): string {
  assertBusinessDate(businessDate)
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('单号序列无效，请重试。 Invalid invoice sequence.')
  return businessDate.replaceAll('/', '') + String(sequence).padStart(3, '0')
}
