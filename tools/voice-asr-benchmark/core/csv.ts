import type { BenchmarkRow } from '../shared/types.ts'

export const CSV_COLUMNS = ['sampleId', 'expectedFishName', 'expectedWeightKg', 'provider', 'rawTranscript', 'parsedFishName', 'parsedWeightKg', 'fishCorrect', 'weightCorrect', 'wholeBasketCorrect', 'latencyMs', 'error'] as const

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  // Quoting alone does not stop spreadsheet formulas, including those hidden
  // behind whitespace. Preserve their text with a spreadsheet text prefix.
  const escaped = /^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text) ? `'${text}` : text
  return `"${escaped.replaceAll('"', '""')}"`
}

/** UTF-8 BOM preserves Chinese names when the CSV is opened in Excel. */
export function exportCsv(rows: BenchmarkRow[]): string {
  return `\uFEFF${CSV_COLUMNS.join(',')}\r\n${rows.map(row => CSV_COLUMNS.map(column => csvCell(row[column])).join(',')).join('\r\n')}${rows.length ? '\r\n' : ''}`
}
