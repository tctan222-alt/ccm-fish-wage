import type { BenchmarkRow, FishSpecies, ProviderStatistics, TranscriptionResult, VoiceAlias } from '../shared/types.ts'
import { matchFish, parseWeight } from './parsing.ts'

type SampleExpected = Pick<BenchmarkRow, 'sampleId' | 'expectedFishSpeciesId' | 'expectedFishName' | 'expectedWeightKg' | 'audio'>

export function evaluateResult(expected: SampleExpected, result: TranscriptionResult, fish: FishSpecies[], aliases: VoiceAlias[]): BenchmarkRow {
  const weight = parseWeight(result.rawTranscript), match = matchFish(weight.fishPhrase, fish, aliases)
  const expectedWeight = parseWeight(String(expected.expectedWeightKg))
  const successful = !result.error
  const fishCorrect = successful && match.candidate !== null && match.candidate.id === expected.expectedFishSpeciesId
  const weightCorrect = successful && expectedWeight.weightDeciKg !== null && weight.weightDeciKg === expectedWeight.weightDeciKg
  return {
    ...expected, ...result, error: result.error ?? (weight.error ? `weight parse error: ${weight.error}` : null),
    parsedFishCandidate: match.candidate ? { id: match.candidate.id, displayName: match.candidate.displayName } : null,
    parsedFishName: match.candidate?.displayName ?? null, parsedWeightKg: weight.weightKg,
    rawFishPhrase: weight.fishPhrase, matchMethod: match.method, fishSuggestions: match.suggestions,
    fishCorrect, weightCorrect, wholeBasketCorrect: fishCorrect && weightCorrect,
  }
}

/** Accuracy is a 0..1 fraction over all attempts, including failures. Latency is
 * the arithmetic mean of finite nonnegative durations, including failed calls. */
export function aggregateStatistics(rows: BenchmarkRow[]): ProviderStatistics[] {
  return [...new Set(rows.map(row => row.provider))].sort().map(provider => {
    const samples = rows.filter(row => row.provider === provider)
    const latencies = samples.map(row => row.latencyMs).filter(value => Number.isFinite(value) && value >= 0)
    return {
      provider, samples: samples.length, errors: samples.filter(row => !!row.error).length,
      fishAccuracy: samples.filter(row => row.fishCorrect).length / samples.length,
      weightAccuracy: samples.filter(row => row.weightCorrect).length / samples.length,
      wholeBasketAccuracy: samples.filter(row => row.fishCorrect && row.weightCorrect).length / samples.length,
      averageLatencyMs: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null,
    }
  })
}
