import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { ProviderAdapter } from '../shared/types.ts'
import { object, ProviderFailure, redactSecrets, requestJson, safeProviderCode, timeoutFrom, transcription,
  type FetchImplementation, type ProviderEnvironment } from './common.ts'

const host = 'asr.tencentcloudapi.com'
const contentType = 'application/json; charset=utf-8'
const signedHeaders = 'content-type;host'

// TC3 canonicalization follows Tencent's official SDK src/common/sign.ts.
// Never log the returned authorization or any signing intermediate.
export function tc3Authorization(secretId: string, secretKey: string, payload: string, timestamp: number): string {
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  const hmac = (key: string | Buffer, value: string) => createHmac('sha256', key).update(value).digest()
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const scope = `${date}/asr/tc3_request`
  const canonicalRequest = ['POST', '/', '', `content-type:${contentType}\nhost:${host}\n`, signedHeaders, hash(payload)].join('\n')
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, scope, hash(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(`TC3${secretKey}`, date), 'asr'), 'tc3_request')
  const signature = hmac(signingKey, stringToSign).toString('hex')
  return `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

export function createTencentAdapter(env: ProviderEnvironment = process.env, fetchImpl: FetchImplementation = fetch): ProviderAdapter {
  const secretId = env.TENCENT_SECRET_ID?.trim() ?? ''
  const secretKey = env.TENCENT_SECRET_KEY?.trim() ?? ''
  const token = env.TENCENT_SESSION_TOKEN?.trim() ?? ''
  // SentenceRecognition documents this engine; its dialect list does not establish Teochew support.
  const model = env.TENCENT_ASR_ENGINE?.trim() || '16k_zh'
  const region = env.TENCENT_REGION?.trim() || 'ap-guangzhou'
  const configured = !!secretId && !!secretKey
  const timeoutMs = timeoutFrom(env)
  const secrets = [secretId, secretKey, token]
  return {
    provider: 'tencent', model, configured,
    transcribe(audio) {
      return transcription('tencent', model, configured, audio, async () => {
        const payload = JSON.stringify({ EngSerViceType: model, SourceType: 1, VoiceFormat: 'wav',
          ProjectId: 0, SubServiceType: 2, UsrAudioKey: randomUUID(),
          Data: Buffer.from(audio.bytes).toString('base64'), DataLen: audio.bytes.byteLength })
        const timestamp = Math.floor(Date.now() / 1000)
        const headers: Record<string, string> = {
          'Content-Type': contentType, Host: host,
          'X-TC-Action': 'SentenceRecognition', 'X-TC-Version': '2019-06-14',
          'X-TC-Timestamp': String(timestamp), 'X-TC-Region': region,
          Authorization: tc3Authorization(secretId, secretKey, payload, timestamp),
        }
        if (token) headers['X-TC-Token'] = token
        const body = object(await requestJson(fetchImpl, `https://${host}/`, { method: 'POST', headers, body: payload }, timeoutMs))
        const response = object(body?.Response)
        const providerError = object(response?.Error)
        if (providerError) throw new ProviderFailure(safeProviderCode(providerError.Code, secrets))
        if (!response || typeof response.Result !== 'string') throw new ProviderFailure('INVALID_RESPONSE')
        return redactSecrets(response.Result, secrets)
      })
    },
  }
}
