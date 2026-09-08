import { assertBusinessDate } from './businessDate'
import type { RetailSale } from './retailSales'

export const RETAIL_EDIT_WINDOW_MS = 72 * 60 * 60 * 1000

// Display hint only. Firestore Rules enforce the deadline using request.time,
// including when the device clock has been changed or an old tab stays open.
export function retailEditStatus(sale: Pick<RetailSale, 'createdAt'>, nowMs = Date.now()): 'editable' | 'expired' | 'unavailable' {
  let createdMs: number | undefined
  try { createdMs = sale.createdAt?.toDate().getTime() } catch { return 'unavailable' }
  if (createdMs === undefined || !Number.isFinite(createdMs) || !Number.isFinite(nowMs) || nowMs < createdMs) return 'unavailable'
  return nowMs - createdMs < RETAIL_EDIT_WINDOW_MS ? 'editable' : 'expired'
}

export function retailInvoiceNumber(businessDate: string, sequence: number): string {
  assertBusinessDate(businessDate)
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('单号序列无效，请重试。 Invalid invoice sequence. Please retry.')
  return `${businessDate.replaceAll('/', '')}${String(sequence).padStart(3, '0')}`
}
