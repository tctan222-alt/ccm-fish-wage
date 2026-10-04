import { readFileSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'

afterEach(()=>{document.head.querySelectorAll('[data-layout-test]').forEach(node=>node.remove())})
it('reserves one shared mobile Back height plus gap and safe area, and removes it for print',()=>{
  const style=document.createElement('style');style.dataset.layoutTest='true'
  style.textContent=readFileSync('src/styles.css','utf8');document.head.append(style)
  const media=Array.from(style.sheet!.cssRules).filter((rule):rule is CSSMediaRule=>rule.type===CSSRule.MEDIA_RULE)
  const mobile=media.filter(rule=>rule.conditionText.replaceAll(' ','')==='(max-width:500px)').flatMap(rule=>Array.from(rule.cssRules))
  const reservation=mobile.find((rule):rule is CSSStyleRule=>'selectorText' in rule && rule.selectorText==='.authenticated-layout')!
  expect(reservation.style.getPropertyValue('--back-button-height')).toBe('44px')
  expect(reservation.style.getPropertyValue('--back-button-gap')).toBe('16px')
  expect(reservation.style.getPropertyValue('padding-bottom')).toContain('env(safe-area-inset-bottom,0px)')
  expect(reservation.style.getPropertyValue('padding-bottom')).toContain('var(--back-button-height) + var(--back-button-gap)')
  const print=media.filter(rule=>rule.conditionText==='print').flatMap(rule=>Array.from(rule.cssRules))
  expect(print.some(rule=>'selectorText' in rule && rule.selectorText==='.back-button' && (rule as CSSStyleRule).style.getPropertyValue('display')==='none')).toBe(true)
  expect(print.some(rule=>'selectorText' in rule && rule.selectorText==='.authenticated-layout' && (rule as CSSStyleRule).style.getPropertyValue('padding-bottom')==='0')).toBe(true)
  expect(readFileSync('src/App.tsx','utf8')).toContain('<DirtyStateProvider><div className="authenticated-layout">')
})
