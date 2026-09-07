import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exportCsv, CSV_COLUMNS } from '../core/csv.ts'
import { aggregateStatistics, evaluateResult } from '../core/evaluation.ts'
import { matchFish, parseWeight } from '../core/parsing.ts'
import type { AudioMetadata, FishSpecies, TranscriptionResult, VoiceAlias } from '../shared/types.ts'

const fish: FishSpecies[] = [
  { id: 'kembung', displayName: '甘丰', active: true, voiceAliases: ['甘风', 'kembung'] },
  { id: 'mabong', displayName: '马丰', active: true, voiceAliases: ['mabong'] },
  { id: 'kerabu', displayName: '上过', active: true },
  { id: 'three', displayName: '三线鱼', active: true },
  { id: 'inactive', displayName: '停用鱼', active: false, voiceAliases: ['老鱼'] },
]
const aliases: VoiceAlias[] = [
  { phrase: '上果', fishSpeciesId: 'kerabu', createdAt: '2026-09-07T00:00:00Z' },
  { phrase: '不存在的鱼', fishSpeciesId: 'unknown', createdAt: '2026-09-07T00:00:00Z' },
]
const audio: AudioMetadata = { sha256: 'same-audio', byteLength: 32044, mimeType: 'audio/wav', sampleRate: 16000, channels: 1, durationMs: 1000, fileName: 'sample.wav' }
const expected = { sampleId: 'sample-1', expectedFishSpeciesId: 'kembung', expectedFishName: '甘丰', expectedWeightKg: 80.5, audio }
const result = (rawTranscript: string, override: Partial<TranscriptionResult> = {}): TranscriptionResult => ({ provider: 'openai', model: 'test-model', rawTranscript, latencyMs: 120, error: null, ...override })

test('1. exact canonical name has priority over a conflicting alias', () => {
  const matched = matchFish(' 甘丰。', fish, [...aliases, { phrase: '甘丰', fishSpeciesId: 'mabong', createdAt: '' }])
  assert.equal(matched.method, 'exact')
  assert.equal(matched.candidate?.id, 'kembung')
})

test('2. master voice aliases and local aliases resolve only their active master item', () => {
  assert.equal(matchFish('甘风', fish, aliases).candidate?.id, 'kembung')
  assert.equal(matchFish(' KEMBUNG ', fish, aliases).candidate?.id, 'kembung')
  const local = matchFish('上果', fish, aliases)
  assert.equal(local.method, 'alias')
  assert.equal(local.candidate?.id, 'kerabu')
  assert.equal(matchFish('甘风', fish, [...aliases, { phrase: '甘风', fishSpeciesId: 'mabong', createdAt: '' }]).candidate, null)
})

test('3. fuzzy matching returns at most three suggestions and never accepts one automatically', () => {
  const matched = matchFish('麻丰', fish, aliases)
  assert.equal(matched.method, 'fuzzy')
  assert.equal(matched.candidate, null)
  assert.equal(matched.suggestions.length, 3)
  assert.ok(matched.suggestions.some(item => item.id === 'mabong'))
})

test('4. matches and suggestions never invent fish or use inactive master items', () => {
  for (const phrase of ['不存在的鱼', '停用鱼', '老鱼', '不认识']) {
    const matched = matchFish(phrase, fish, aliases)
    assert.equal(matched.candidate, null)
    assert.ok(matched.suggestions.every(item => fish.some(master => master.active && master.id === item.id)))
  }
  assert.deepEqual(matchFish('甘丰', [], aliases).suggestions, [])
})

test('5. parses integer 80 with kg, kilo, or no explicit unit', () => {
  for (const transcript of ['甘丰80', '甘丰 80 kg', '甘丰 80 kilo', '甘丰80.']) {
    const parsed = parseWeight(transcript)
    assert.equal(parsed.weightDeciKg, 800)
    assert.equal(parsed.weightKg, 80)
    assert.equal(parsed.fishPhrase, '甘丰')
  }
})

test('6. parses 80.5 exactly as integer tenths', () => {
  assert.equal(parseWeight('甘丰80.5kg').weightDeciKg, 805)
  assert.equal(parseWeight('甘丰80.5kg').weightKg, 80.5)
  assert.equal(parseWeight('甘丰0.1公斤').weightDeciKg, 1)
  assert.equal(parseWeight('甘丰800公斤').weightKg, 800)
})

test('7. parses 八十 without losing numerals inside fish names', () => {
  assert.equal(parseWeight('甘丰八十公斤').weightKg, 80)
  assert.equal(parseWeight('三线鱼八十').fishPhrase, '三线鱼')
  assert.equal(parseWeight('八爪鱼80kg').fishPhrase, '八爪鱼')
  assert.equal(parseWeight('三线鱼').weightKg, null)
  assert.equal(parseWeight('八爪鱼').weightKg, null)
})

test('8. parses 八十点五 and ordinary Chinese positive weights', () => {
  for (const transcript of ['甘丰八十点五', '甘丰八十点五公斤', '甘丰八十點五 kg', '甘丰80点五公斤']) assert.equal(parseWeight(transcript).weightDeciKg, 805)
  assert.equal(parseWeight('甘丰一百零五公斤').weightKg, 105)
  assert.equal(parseWeight('甘丰两公斤').weightKg, 2)
})

test('9. rejects extra precision, ambiguous weights, zero, negative, and unsupported units without conversion', () => {
  for (const transcript of ['甘丰80.55kg', '甘丰八十点五五公斤', '甘丰0kg', '甘丰-80kg', '甘丰负八十公斤', '甘丰 - 80kg', '甘丰80斤', '甘丰八十两', '甘丰八十兩', '甘丰80两', '甘丰80克', '甘丰80kg 马丰90kg', '甘丰80 马丰90', '甘丰八十 马丰九十', '甘丰80.5.5kg', '甘丰.5kg']) {
    const parsed = parseWeight(transcript)
    assert.equal(parsed.weightKg, null, transcript)
    assert.equal(parsed.weightDeciKg, null, transcript)
    assert.ok(parsed.error, transcript)
  }
})

test('10. whole-basket correctness requires both correct fish ID and exact weight; provider errors are incorrect', () => {
  const correct = evaluateResult(expected, result('甘丰80.5kg'), fish, aliases)
  assert.equal(correct.wholeBasketCorrect, true)
  assert.equal(correct.audio, audio)
  const wrongFish = evaluateResult(expected, result('马丰80.5kg'), fish, aliases)
  assert.equal(wrongFish.fishCorrect, false)
  assert.equal(wrongFish.weightCorrect, true)
  assert.equal(wrongFish.wholeBasketCorrect, false)
  const wrongWeight = evaluateResult(expected, result('甘丰80kg'), fish, aliases)
  assert.equal(wrongWeight.fishCorrect, true)
  assert.equal(wrongWeight.weightCorrect, false)
  assert.equal(wrongWeight.wholeBasketCorrect, false)
  assert.equal(evaluateResult(expected, result('甘风80.5kg'), fish, aliases).fishCorrect, true)
  assert.equal(evaluateResult(expected, result('敢丰80.5kg'), fish, aliases).fishCorrect, false)
  const failed = evaluateResult(expected, result('甘丰80.5kg', { error: 'provider unavailable', latencyMs: 300 }), fish, aliases)
  assert.equal(failed.fishCorrect, false)
  assert.equal(failed.weightCorrect, false)
  assert.equal(failed.wholeBasketCorrect, false)
  const statistics = aggregateStatistics([correct, wrongFish, wrongWeight, failed])[0]
  assert.deepEqual(statistics, { provider: 'openai', samples: 4, errors: 1, fishAccuracy: 0.5, weightAccuracy: 0.5, wholeBasketAccuracy: 0.25, averageLatencyMs: 165 })
  assert.deepEqual(aggregateStatistics([]), [])
  assert.equal(aggregateStatistics([{ ...failed, latencyMs: NaN }])[0].averageLatencyMs, null)
  const invalidWeight = evaluateResult(expected, result('甘丰80.55kg'), fish, aliases)
  assert.equal(invalidWeight.weightCorrect, false)
  assert.equal(invalidWeight.fishCorrect, true)
  assert.equal(invalidWeight.wholeBasketCorrect, false)
  assert.match(invalidWeight.error ?? '', /weight parse error/)
  assert.deepEqual(aggregateStatistics([invalidWeight])[0], { provider: 'openai', samples: 1, errors: 1, fishAccuracy: 1, weightAccuracy: 0, wholeBasketAccuracy: 0, averageLatencyMs: 120 })
})

test('13. CSV exports the required columns and preserves Chinese, quotes/newlines, while neutralizing formulas', () => {
  const row = evaluateResult(expected, result('甘丰80.5kg'), fish, aliases)
  const csv = exportCsv([{ ...row, sampleId: '=1+1', expectedFishName: '鱼,"名"\n第二行', rawTranscript: '  @SUM(A1:A2)', error: '\t=HYPERLINK("url")' }])
  assert.ok(csv.startsWith(`\uFEFF${CSV_COLUMNS.join(',')}\r\n`))
  assert.ok(csv.includes('"\'=1+1"'))
  assert.ok(csv.includes('"鱼,""名""\n第二行"'))
  assert.ok(csv.includes('"\'  @SUM(A1:A2)"'))
  assert.ok(csv.includes('"\'\t=HYPERLINK(""url"")"'))
  assert.ok(csv.includes('"true","true","true","120"'))
  assert.equal(exportCsv([]), `\uFEFF${CSV_COLUMNS.join(',')}\r\n`)
})
