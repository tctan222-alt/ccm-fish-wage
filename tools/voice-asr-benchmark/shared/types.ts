export type ProviderId = 'openai' | 'tencent'
export interface FishSpecies { id: string; displayName: string; active: boolean; voiceAliases?: string[] }
export interface VoiceAlias { phrase: string; fishSpeciesId: string; createdAt: string }
export interface AudioInput { bytes: Uint8Array; mimeType: 'audio/wav'; fileName: string; sampleRate: 16000; channels: 1; durationMs: number }
export interface AudioMetadata { sha256: string; byteLength: number; mimeType: 'audio/wav'; sampleRate: number; channels: number; durationMs: number; fileName: string }
export interface TranscriptionResult { provider: ProviderId; model: string; rawTranscript: string; latencyMs: number; error: string | null }
export interface ProviderAdapter { provider: ProviderId; model: string; configured: boolean; transcribe(audio: AudioInput): Promise<TranscriptionResult> }
export type MatchMethod = 'exact' | 'alias' | 'fuzzy' | 'none'
export interface FishMatch { method: MatchMethod; rawFishPhrase: string; candidate: FishSpecies | null; suggestions: FishSpecies[] }
export interface WeightParse { weightKg: number | null; weightDeciKg: number | null; rawWeightPhrase: string; fishPhrase: string; error: string | null }
export interface BenchmarkRow extends TranscriptionResult {
  sampleId: string; expectedFishSpeciesId: string; expectedFishName: string; expectedWeightKg: number; audio: AudioMetadata
  parsedFishCandidate: { id: string; displayName: string } | null; parsedFishName: string | null; parsedWeightKg: number | null
  rawFishPhrase: string; matchMethod: MatchMethod; fishSuggestions: FishSpecies[]
  fishCorrect: boolean; weightCorrect: boolean; wholeBasketCorrect: boolean
}
export interface BenchmarkSample {
  sampleId: string; createdAt: string; expectedFishSpeciesId: string; expectedFishName: string; expectedWeightKg: number
  audio: AudioMetadata; aliasSnapshot: VoiceAlias[]; fishSnapshot: FishSpecies[]; results: BenchmarkRow[]
}
export interface ProviderStatistics { provider: ProviderId; samples: number; errors: number; fishAccuracy: number; weightAccuracy: number; wholeBasketAccuracy: number; averageLatencyMs: number | null }
