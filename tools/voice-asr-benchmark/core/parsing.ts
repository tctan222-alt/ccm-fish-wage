import type { FishMatch, FishSpecies, VoiceAlias, WeightParse } from '../shared/types.ts'

const chineseDigits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const chineseUnits: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }
const supportedUnit = /^(?:公斤|千克|kilograms?\b|kilos?\b|kg\b)/i
const unsupportedUnit = /^(?:市斤|台斤|斤|两|兩|磅|pounds?\b|lbs?\b|grams?\b|g\b|克|吨|噸|tonnes?\b)/i
const numericPhrase = /[+\-−负負]?(?:\d+(?:[.点點][零〇一二两兩三四五六七八九\d]+)?|[零〇一二两兩三四五六七八九十百千]+(?:[.点點][零〇一二两兩三四五六七八九\d]+)?)/gu

function chineseInteger(value: string): number | null {
  if (/^[零〇一二两兩三四五六七八九]+$/.test(value)) return Number([...value].map(character => chineseDigits[character]).join(''))
  let total = 0, pending: number | null = null, previousUnit = Infinity
  for (const character of value) {
    const digit = chineseDigits[character]
    if (digit !== undefined) {
      if (pending !== null && pending !== 0) return null
      pending = digit
      continue
    }
    const unit = chineseUnits[character]
    if (!unit || unit >= previousUnit || (pending === null && unit !== 10)) return null
    total += (pending ?? 1) * unit
    pending = null
    previousUnit = unit
  }
  return total + (pending ?? 0)
}

function deciKilograms(value: string): number | null {
  if (/^[+\-−负負]/u.test(value)) return null
  const parts = value.split(/[.点點]/u)
  if (parts.length > 2 || (parts[1] !== undefined && [...parts[1]].length !== 1)) return null
  const whole = /^\d+$/.test(parts[0]) ? Number(parts[0]) : chineseInteger(parts[0])
  const fraction = parts[1] === undefined ? 0 : /^\d$/.test(parts[1]) ? Number(parts[1]) : chineseDigits[parts[1]]
  if (whole === null || fraction === undefined) return null
  const result = whole * 10 + fraction
  return Number.isSafeInteger(result) && result > 0 ? result : null
}

function cleanFishPhrase(value: string): string {
  return value.replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '').trim()
}

/** Parse spoken kg without conversion or rounding. Ambiguous input is never accepted. */
export function parseWeight(transcript: string): WeightParse {
  const text = transcript.normalize('NFKC').trim()
  const candidates: { phrase: string; number: string; start: number; end: number; unsupported: boolean }[] = []
  for (const match of text.matchAll(numericPhrase)) {
    const start = match.index, number = match[0], numberEnd = start + number.length
    const remainder = text.slice(numberEnd), whitespace = remainder.match(/^\s*/u)?.[0] ?? ''
    const afterSpace = remainder.slice(whitespace.length)
    const unit = afterSpace.match(supportedUnit)?.[0] ?? ''
    const invalidUnit = afterSpace.match(unsupportedUnit)?.[0] ?? ''
    const endsInLiang = /[零〇一二三四五六七八九十百千][两兩]$/u.test(number) && !unit
    // Numerals inside common fish names (三线鱼, 八爪鱼, 三文鱼) are names,
    // not a second basket weight. Spoken multi-digit quantities remain candidates.
    const fishNameNumeral = !unit && !invalidUnit && /^[线線爪文点點星纹紋带帶鳍鰭目斑须鬚角尾]/u.test(remainder)
    const chinesePrefix = !/[\d十百千.点點]/u.test(number) && /^[\p{L}]/u.test(remainder) && !unit && !invalidUnit
    if (fishNameNumeral || chinesePrefix) continue
    const end = numberEnd + (unit || invalidUnit ? whitespace.length + (unit || invalidUnit).length : 0)
    candidates.push({ phrase: text.slice(start, end), number, start, end, unsupported: !!invalidUnit || endsInLiang })
  }
  const failure = (error: string, rawWeightPhrase = ''): WeightParse => ({ weightKg: null, weightDeciKg: null, rawWeightPhrase, fishPhrase: cleanFishPhrase(text), error })
  if (!candidates.length) return failure('未识别到 kg 重量。')
  if (candidates.length !== 1) return failure('识别到多个重量，无法确定同一筐重量。', candidates.map(candidate => candidate.phrase).join(' / '))
  const candidate = candidates[0]
  const fishPhrase = cleanFishPhrase(`${text.slice(0, candidate.start)} ${text.slice(candidate.end)}`)
  const failCandidate = (error: string): WeightParse => ({ ...failure(error, candidate.phrase), fishPhrase })
  if (candidate.unsupported) return failCandidate('只接受 kg，不换算斤、两或其他重量单位。')
  // Prevent malformed decimals such as .5, 80.5.5 or a detached negative sign
  // from becoming a different valid weight after tokenization.
  const before = text.slice(0, candidate.start), after = text.slice(candidate.end)
  if (/[.点點+\-−负負]\s*$/u.test(before) || /^\.\d|^[点點]/u.test(after)) return failCandidate('重量格式无效，须为正数且最多一位小数。')
  const weightDeciKg = deciKilograms(candidate.number)
  if (weightDeciKg === null) return failCandidate('重量须为正数且最多一位小数；不自动四舍五入。')
  return { weightKg: weightDeciKg / 10, weightDeciKg, rawWeightPhrase: candidate.phrase, fishPhrase, error: null }
}

function normalizedPhrase(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function editDistance(left: string, right: string): number {
  const a = [...left], b = [...right]
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    previous = current
  }
  return previous[b.length]
}

/** Only a unique exact canonical name or alias becomes a candidate. */
export function matchFish(phrase: string, fish: FishSpecies[], aliases: VoiceAlias[]): FishMatch {
  const rawFishPhrase = phrase.trim(), query = normalizedPhrase(rawFishPhrase)
  const active = [...new Map(fish.filter(item => item.active).map(item => [item.id, item])).values()]
  const empty: FishMatch = { method: 'none', rawFishPhrase, candidate: null, suggestions: [] }
  if (!query || !active.length) return empty
  const exact = active.filter(item => normalizedPhrase(item.displayName) === query)
  if (exact.length) return { method: 'exact', rawFishPhrase, candidate: exact.length === 1 ? exact[0] : null, suggestions: exact.slice(0, 3) }
  const aliasMatch = active.filter(item => item.voiceAliases?.some(alias => normalizedPhrase(alias) === query)
    || aliases.some(alias => alias.fishSpeciesId === item.id && normalizedPhrase(alias.phrase) === query))
  if (aliasMatch.length) return { method: 'alias', rawFishPhrase, candidate: aliasMatch.length === 1 ? aliasMatch[0] : null, suggestions: aliasMatch.slice(0, 3) }
  const suggestions = active.map(item => {
    const names = [item.displayName, ...(item.voiceAliases ?? []), ...aliases.filter(alias => alias.fishSpeciesId === item.id).map(alias => alias.phrase)].map(normalizedPhrase).filter(Boolean)
    const score = Math.min(...names.map(name => editDistance(query, name) / Math.max([...query].length, [...name].length)))
    return { item, score }
  }).sort((a, b) => a.score - b.score || a.item.displayName.localeCompare(b.item.displayName) || a.item.id.localeCompare(b.item.id)).slice(0, 3).map(entry => entry.item)
  return { method: 'fuzzy', rawFishPhrase, candidate: null, suggestions }
}
