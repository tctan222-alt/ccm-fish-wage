import { formatAuditTimestamp, parseBusinessDate } from './businessDate'

const RETAIL_WEEKDAYS = ['星期日 Sun', '星期一 Mon', '星期二 Tue', '星期三 Wed', '星期四 Thu', '星期五 Fri', '星期六 Sat']

/** Retail presentation only: business-date storage and sort keys remain unchanged. */
export function formatRetailDate(businessDate: string): string {
  const parts = parseBusinessDate(businessDate)
  if (!parts) return businessDate
  const { day, month, year } = parts
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return `${String(day).padStart(2, '0')}${String(month).padStart(2, '0')}${String(year).padStart(4, '0')} ${RETAIL_WEEKDAYS[weekday]}`
}

/** Retain the existing Malaysia audit clock and minute precision. */
export function formatRetailAuditTimestamp(value: Date | { toDate: () => Date }): string {
  const formatted = formatAuditTimestamp(value)
  return `${formatRetailDate(formatted.slice(0, 10))}${formatted.slice(10)}`
}
