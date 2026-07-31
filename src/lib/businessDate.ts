const BUSINESS_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/
const LEGACY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const BUSINESS_MONTH_PATTERN = /^(\d{2})\/(\d{4})$/

export interface BusinessDateParts {
  day: number
  month: number
  year: number
}

function isRealDate({ day, month, year }: BusinessDateParts): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  return new Date(Date.UTC(year, month - 1, day)).getUTCFullYear() === year
    && new Date(Date.UTC(year, month - 1, day)).getUTCMonth() === month - 1
    && new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day
}

export function parseBusinessDate(value: string): BusinessDateParts | null {
  const match = BUSINESS_DATE_PATTERN.exec(value.trim())
  if (!match) return null
  const [, day, month, year] = match
  const parts = { day: Number(day), month: Number(month), year: Number(year) }
  return isRealDate(parts) ? parts : null
}

export function assertBusinessDate(value: string): BusinessDateParts {
  const parts = parseBusinessDate(value)
  if (!parts) throw new Error('日期必须为有效的 DD/MM/YYYY 格式。')
  return parts
}

export function businessDateFromLegacy(value: string): string {
  const normalized = value.trim()
  const current = parseBusinessDate(normalized)
  if (current) return formatBusinessDate(current)
  const legacy = LEGACY_DATE_PATTERN.exec(normalized)
  if (!legacy) throw new Error('日期必须为有效的 DD/MM/YYYY 格式。')
  const [, year, month, day] = legacy
  const parts = { day: Number(day), month: Number(month), year: Number(year) }
  if (!isRealDate(parts)) throw new Error('日期必须为有效的 DD/MM/YYYY 格式。')
  return formatBusinessDate(parts)
}

export function formatBusinessDate({ day, month, year }: BusinessDateParts): string {
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${String(year).padStart(4, '0')}`
}

export function monthKeyFromBusinessDate(value: string): string {
  const { month, year } = assertBusinessDate(value)
  return `${String(month).padStart(2, '0')}/${year}`
}

export function sortKeyFromBusinessDate(value: string): number {
  const { day, month, year } = assertBusinessDate(value)
  return year * 10000 + month * 100 + day
}

export function businessDateFromSortKey(value: number): string {
  if (!Number.isInteger(value) || value < 10_000_101 || value > 99_991_231) throw new Error('日期排序键无效。')
  const year=Math.floor(value/10_000),month=Math.floor(value/100)%100,day=value%100
  if (!isRealDate({year,month,day})) throw new Error('日期排序键无效。')
  return formatBusinessDate({year,month,day})
}

export function monthSortKeyFromMonthKey(value: string): number {
  const match = BUSINESS_MONTH_PATTERN.exec(value.trim())
  if (!match) throw new Error('月份必须为 MM/YYYY 格式。')
  const [, month, year] = match
  const monthNumber = Number(month)
  if (monthNumber < 1 || monthNumber > 12) throw new Error('月份必须为 MM/YYYY 格式。')
  return Number(year) * 100 + monthNumber
}

export function malaysiaBusinessDate(date = new Date()): string {
  const values = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => values.find((value) => value.type === type)?.value ?? ''
  return `${part('day')}/${part('month')}/${part('year')}`
}

export function formatAuditTimestamp(value: Date | { toDate: () => Date }): string {
  const date = value instanceof Date ? value : value.toDate()
  const values = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => values.find((entry) => entry.type === type)?.value ?? ''
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`
}

export function legacyIsoDateFromBusinessDate(value: string): string {
  const { day, month, year } = assertBusinessDate(value)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
