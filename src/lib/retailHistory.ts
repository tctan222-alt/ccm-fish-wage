import { formatBusinessDate, parseBusinessDate, sortKeyFromBusinessDate } from './businessDate'

export type RetailHistoryMode = 'today' | 'week' | 'range'
export interface RetailHistoryRange { fromDate: string; toDate: string }

function calendarDate(value: string): Date {
  const parts = parseBusinessDate(value)
  if (!parts) throw new Error('请选择有效日期。 Please select a valid date.')
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
}

function businessDate(date: Date): string {
  const value = formatBusinessDate({ day: date.getUTCDate(), month: date.getUTCMonth() + 1, year: date.getUTCFullYear() })
  if (!parseBusinessDate(value)) throw new Error('请选择有效日期。 Please select a valid date.')
  return value
}

export function retailHistoryRange(mode: RetailHistoryMode, anchorDate: string, fromDate: string, toDate: string): RetailHistoryRange {
  if (mode === 'range') {
    const from = businessDate(calendarDate(fromDate)), to = businessDate(calendarDate(toDate))
    if (sortKeyFromBusinessDate(from) > sortKeyFromBusinessDate(to)) throw new Error('开始日期不可晚于结束日期。 From date cannot be after to date.')
    return { fromDate: from, toDate: to }
  }
  const start = calendarDate(anchorDate)
  if (mode === 'today') return { fromDate: businessDate(start), toDate: businessDate(start) }
  // Work with civil dates in UTC so the selected week is independent of device timezone.
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  return { fromDate: businessDate(start), toDate: businessDate(end) }
}

export function shiftRetailWeek(anchorDate: string, offset: number): string {
  if (!Number.isInteger(offset)) throw new Error('周偏移无效。 Invalid week offset.')
  const date = calendarDate(anchorDate)
  date.setUTCDate(date.getUTCDate() + offset * 7)
  return businessDate(date)
}
