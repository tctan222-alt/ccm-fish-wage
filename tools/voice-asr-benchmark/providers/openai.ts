import type { ProviderAdapter } from '../shared/types.ts'
import { object, ProviderFailure, redactSecrets, requestJson, timeoutFrom, transcription,
  type FetchImplementation, type ProviderEnvironment } from './common.ts'

// Official file-transcription guide: https://developers.openai.com/api/docs/guides/speech-to-text
export function createOpenAIAdapter(env: ProviderEnvironment = process.env, fetchImpl: FetchImplementation = fetch): ProviderAdapter {
  const apiKey = env.OPENAI_API_KEY?.trim() ?? ''
  const model = env.OPENAI_ASR_MODEL?.trim() || 'gpt-transcribe'
  const configured = !!apiKey
  const timeoutMs = timeoutFrom(env)
  return {
    provider: 'openai', model, configured,
    transcribe(audio) {
      return transcription('openai', model, configured, audio, async () => {
        const form = new FormData()
        // A neutral filename prevents expected labels in an upload name becoming hints.
        form.append('file', new Blob([new Uint8Array(audio.bytes)], { type: 'audio/wav' }), 'sample.wav')
        form.append('model', model)
        const body = object(await requestJson(fetchImpl, 'https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form,
        }, timeoutMs))
        if (!body || typeof body.text !== 'string') throw new ProviderFailure('INVALID_RESPONSE')
        return redactSecrets(body.text, [apiKey])
      })
    },
  }
}
