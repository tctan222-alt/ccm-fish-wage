import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/styles.css', 'utf8')
const dailyPrint = css.slice(css.indexOf('/* Daily wage report print */'))

describe('daily wage report print stylesheet', () => {
  it('reserves space for the real App sign-out and mobile Back controls', () => {
    expect(dailyPrint).toMatch(/main\.daily-details-page\{padding-top:64px;padding-bottom:calc\(72px \+ env\(safe-area-inset-bottom\)\)\}/)
    expect(dailyPrint).toMatch(/@media print\{[\s\S]*main\.daily-details-page\{[^}]*padding:0/)
  })
  it('prints the full report and hides screen controls and audit history', () => {
    expect(dailyPrint).toContain('@media print')
    expect(dailyPrint).toMatch(/\.daily-details-page \.daily-report-print\s*\{[^}]*display:\s*block/)
    const hiddenControls = dailyPrint.match(/([^{}]+)\{display:none!important\}/)?.[1]
    for (const selector of ['daily-report-screen', 'daily-controls', 'daily-navigation', 'daily-feedback', 'daily-void-history', 'daily-void-modal']) {
      expect(hiddenControls).toContain(`.daily-details-page .${selector}`)
    }
    expect(css).toMatch(/\.sign-out,\.statement-navigation,\.print-action\{display:none!important\}/)
    expect(css).toMatch(/\.back-button\{display:none!important\}/)
  })

  it('limits A4 sizing to this report and allows long workers to continue across pages', () => {
    expect(dailyPrint).toMatch(/@page daily-wage-report\{size:A4;margin:12mm\}/)
    expect(dailyPrint).toMatch(/main\.daily-details-page\{page:daily-wage-report/)
    expect(dailyPrint).toMatch(/\.daily-print-worker\{break-inside:auto;page-break-inside:auto\}/)
    expect(dailyPrint).toMatch(/\.daily-print-worker>h2\{[^}]*break-after:avoid/)
    expect(dailyPrint).toMatch(/\.daily-basket-table thead\{display:table-header-group\}/)
    expect(dailyPrint).toMatch(/\.daily-basket-table tr\{break-inside:avoid/)
  })
})
