import type { AudioInput, ProviderId, TranscriptionResult } from '../shared/types.ts'

export type ProviderEnvironment = Record<string, string | undefined>
export type FetchImplementation = typeof fetch

export class ProviderFailure extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.code = code }
}

export function timeoutFrom(env: ProviderEnvironment): number {
  const requested = Number(env.ASR_TIMEOUT_MS)
  return Number.isFinite(requested) && requested > 0 ? Math.min(120_000, Math.max(10, requested)) : 60_000
}

export function validateAudio(audio: AudioInput): void {
  if (audio.mimeType !== 'audio/wav' || audio.sampleRate !== 16000 || audio.channels !== 1
    || !Number.isFinite(audio.durationMs) || audio.durationMs <= 0 || audio.durationMs > 45_000
    || audio.bytes.byteLength < 44 || audio.bytes.byteLength > 1_500_000) {
    throw new ProviderFailure('INVALID_AUDIO')
  }
  // The local server validates the complete WAV; reject obvious format mismatches here too.
  const header = new DataView(audio.bytes.buffer, audio.bytes.byteOffset, audio.bytes.byteLength)
  const ascii = (offset: number) => String.fromCharCode(...audio.bytes.subarray(offset, offset + 4))
  if (ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE' || ascii(12) !== 'fmt '
    || header.getUint16(20, true) !== 1 || header.getUint16(22, true) !== 1
    || header.getUint32(24, true) !== 16000 || header.getUint16(34, true) !== 16) {
    throw new ProviderFailure('INVALID_AUDIO')
  }
}

export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function safeProviderCode(value: unknown, secrets: string[]): string {
  // Never return provider messages, stack traces, request headers, or arbitrary response fields.
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(value)
    && !secrets.some(secret => secret && value.includes(secret)) ? value : 'PROVIDER_ERROR'
}

export function redactSecrets(text: string, secrets: string[]): string {
  return secrets.filter(Boolean).reduce((result, secret) => result.split(secret).join('[REDACTED]'), text)
}

export async function requestJson(fetchImpl: FetchImplementation, url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new ProviderFailure('TIMEOUT')); controller.abort() }, timeoutMs)
  })
  const request = async () => {
    const response = await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error' })
    if (!response.ok) throw new ProviderFailure(`HTTP_${response.status}`)
    try { return await response.json() as unknown } catch { throw new ProviderFailure('INVALID_RESPONSE') }
  }
  try { return await Promise.race([request(), timeout]) }
  finally { clearTimeout(timer); controller.abort() }
}

export async function transcription(provider: ProviderId, model: string, configured: boolean,
  audio: AudioInput, perform: () => Promise<string>): Promise<TranscriptionResult> {
  const started = performance.now()
  try {
    if (!configured) throw new ProviderFailure('NOT_CONFIGURED')
    validateAudio(audio)
    const rawTranscript = await perform()
    return { provider, model, rawTranscript, latencyMs: Math.round(performance.now() - started), error: null }
  } catch (error) {
    return { provider, model, rawTranscript: '', latencyMs: Math.round(performance.now() - started),
      error: error instanceof ProviderFailure ? error.code : 'REQUEST_FAILED' }
  }
}
