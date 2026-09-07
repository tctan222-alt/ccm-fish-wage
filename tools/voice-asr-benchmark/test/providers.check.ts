import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createOpenAIAdapter, createTencentAdapter } from '../providers/index.ts'
import { tc3Authorization } from '../providers/tencent.ts'
import { timeoutFrom } from '../providers/common.ts'
import type { AudioInput, ProviderAdapter } from '../shared/types.ts'

function audioFixture(): AudioInput {
  const bytes = new Uint8Array(32044), view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset)
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, bytes.length - 44, true)
  return { bytes, mimeType: 'audio/wav', sampleRate: 16000, channels: 1,
    durationMs: 1000, fileName: 'expected-fish-and-weight-must-not-be-sent.wav' }
}

// Deliberately fake values, never environment credentials. Every fetch below is mocked.
const env = { OPENAI_API_KEY: 'openai-test-only', TENCENT_SECRET_ID: 'tencent-test-id',
  TENCENT_SECRET_KEY: 'tencent-test-key', TENCENT_SESSION_TOKEN: 'test-session-token', ASR_TIMEOUT_MS: '30' }
const factories = [createOpenAIAdapter, createTencentAdapter]
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
function assertShape(adapter: ProviderAdapter, result: Awaited<ReturnType<ProviderAdapter['transcribe']>>) {
  assert.deepEqual(Object.keys(result).sort(), ['error', 'latencyMs', 'model', 'provider', 'rawTranscript'])
  assert.equal(result.provider, adapter.provider); assert.equal(result.model, adapter.model)
  assert.equal(Number.isInteger(result.latencyMs), true); assert.ok(result.latencyMs >= 0)
}

describe('provider adapters without network or credentials', () => {
  it('matches an independently calculated TC3 SHA-256 fixture at a fixed UTC timestamp', () => {
    // TC3 construction from Tencent's official Node SDK; expected digest independently calculated with .NET HMACSHA256.
    // These are public test strings, not credentials or a request that will be transmitted.
    const payload = '{"EngSerViceType":"16k_zh","SourceType":1,"VoiceFormat":"wav","Data":"UklGRg==","DataLen":4}'
    assert.equal(tc3Authorization('EXAMPLE_ID', 'example-key-not-a-credential', payload, 1551113065),
      'TC3-HMAC-SHA256 Credential=EXAMPLE_ID/2019-02-25/asr/tc3_request, SignedHeaders=content-type;host, Signature=13b357722571437bc2fa59f013e5e1b16d824ea5a7587dceda0c89264ead976d')
  })

  it('uses documented configurable defaults and makes no request when unconfigured', async () => {
    let calls = 0
    const noRequest: typeof fetch = async () => { calls++; throw new Error('must not call') }
    const openai = createOpenAIAdapter({}, noRequest), tencent = createTencentAdapter({}, noRequest)
    assert.equal(openai.model, 'gpt-transcribe'); assert.equal(tencent.model, '16k_zh')
    for (const adapter of [openai, tencent]) {
      assert.equal(adapter.configured, false)
      const result = await adapter.transcribe(audioFixture())
      assertShape(adapter, result); assert.equal(result.error, 'NOT_CONFIGURED'); assert.equal(result.rawTranscript, '')
    }
    assert.equal(createTencentAdapter({ TENCENT_SECRET_ID: 'one-value' }, noRequest).configured, false)
    assert.equal(calls, 0)
  })

  it('uploads exactly the same WAV bytes to both services, without answer labels or hints', async () => {
    const audio = audioFixture(), uploads: Uint8Array[] = []
    const openai = createOpenAIAdapter({ ...env, OPENAI_ASR_MODEL: 'gpt-transcribe' }, async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions')
      assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error')
      assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${env.OPENAI_API_KEY}`)
      assert.ok(init?.body instanceof FormData)
      assert.deepEqual([...init.body.keys()].sort(), ['file', 'model'])
      const file = init.body.get('file')
      assert.ok(file instanceof File); assert.equal(file.name, 'sample.wav'); assert.equal(file.type, 'audio/wav')
      uploads.push(new Uint8Array(await file.arrayBuffer()))
      assert.equal(init.body.get('model'), 'gpt-transcribe')
      return json({ text: '甘丰十二点五公斤。' })
    })
    const tencent = createTencentAdapter({ ...env, TENCENT_ASR_ENGINE: '16k_ms', TENCENT_REGION: 'ap-shanghai' }, async (url, init) => {
      assert.equal(url, 'https://asr.tencentcloudapi.com/')
      assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error')
      const headers = new Headers(init?.headers)
      assert.equal(headers.get('X-TC-Action'), 'SentenceRecognition'); assert.equal(headers.get('X-TC-Version'), '2019-06-14')
      assert.equal(headers.get('X-TC-Region'), 'ap-shanghai'); assert.equal(headers.get('X-TC-Token'), env.TENCENT_SESSION_TOKEN)
      const payload = JSON.parse(String(init?.body))
      assert.deepEqual(Object.keys(payload).sort(), ['Data', 'DataLen', 'EngSerViceType', 'ProjectId', 'SourceType', 'SubServiceType', 'UsrAudioKey', 'VoiceFormat'])
      assert.equal(payload.EngSerViceType, '16k_ms'); assert.equal(payload.SourceType, 1); assert.equal(payload.VoiceFormat, 'wav')
      assert.equal(payload.DataLen, audio.bytes.byteLength)
      assert.equal(String(init?.body).includes(audio.fileName), false)
      assert.equal(headers.get('Authorization'), tc3Authorization(env.TENCENT_SECRET_ID, env.TENCENT_SECRET_KEY,
        String(init?.body), Number(headers.get('X-TC-Timestamp'))))
      uploads.push(new Uint8Array(Buffer.from(payload.Data, 'base64')))
      return json({ Response: { Result: '甘丰12.5公斤。', RequestId: 'mock-request' } })
    })
    for (const adapter of [openai, tencent]) {
      const result = await adapter.transcribe(audio)
      assertShape(adapter, result); assert.equal(result.error, null); assert.ok(result.rawTranscript.includes('甘丰'))
    }
    assert.equal(tencent.model, '16k_ms')
    assert.deepEqual(uploads[0], audio.bytes); assert.deepEqual(uploads[1], audio.bytes)
  })

  for (const factory of factories) {
    const name = factory === createOpenAIAdapter ? 'OpenAI' : 'Tencent'
    it(`${name} returns safe HTTP, network, malformed-response, and timeout failures`, async () => {
      const audio = audioFixture()
      const cases: [typeof fetch, string][] = [
        [async () => json({ error: { message: env.OPENAI_API_KEY, key: env.TENCENT_SECRET_KEY } }, 401), 'HTTP_401'],
        [async () => { throw new Error(`Request leaked ${env.OPENAI_API_KEY} ${env.TENCENT_SECRET_KEY}`) }, 'REQUEST_FAILED'],
        [async () => new Response('not JSON'), 'INVALID_RESPONSE'],
        [async () => json({ arbitrary: env.OPENAI_API_KEY }), 'INVALID_RESPONSE'],
        [async () => new Promise<Response>(() => {}), 'TIMEOUT'],
        [async () => ({ ok: true, json: async () => new Promise(() => {}) }) as Response, 'TIMEOUT'],
      ]
      for (const [fetchImpl, error] of cases) {
        const adapter = factory(env, fetchImpl), result = await adapter.transcribe(audio)
        assertShape(adapter, result); assert.equal(result.error, error); assert.equal(result.rawTranscript, '')
        assert.ok(result.latencyMs < 2000)
        for (const secret of Object.values(env).filter(value => value !== '30')) assert.equal(JSON.stringify(result).includes(secret), false)
      }
    })

    it(`${name} rejects noncanonical and oversized audio before requesting`, async () => {
      let calls = 0
      const adapter = factory(env, async () => { calls++; return json({}) })
      const invalid = [
        { ...audioFixture(), durationMs: 45_001 }, { ...audioFixture(), durationMs: Number.NaN },
        { ...audioFixture(), bytes: new Uint8Array(1_500_001) }, { ...audioFixture(), bytes: new Uint8Array(44) },
      ]
      for (const audio of invalid) assert.equal((await adapter.transcribe(audio)).error, 'INVALID_AUDIO')
      assert.equal(calls, 0)
    })
  }

  it('keeps Tencent provider codes but never provider error messages or credential-shaped codes', async () => {
    for (const [code, expected] of [['AuthFailure.SignatureFailure', 'AuthFailure.SignatureFailure'],
      [env.TENCENT_SECRET_KEY, 'PROVIDER_ERROR'], ['invalid code with spaces', 'PROVIDER_ERROR']]) {
      const adapter = createTencentAdapter(env, async () => json({ Response: { Error: { Code: code,
        Message: `sensitive ${env.TENCENT_SECRET_KEY}` } } }))
      const result = await adapter.transcribe(audioFixture())
      assert.equal(result.error, expected); assert.equal(result.rawTranscript, '')
      assert.equal(JSON.stringify(result).includes(env.TENCENT_SECRET_KEY), false)
    }
  })

  it('redacts an accidentally echoed credential even in a successful transcript', async () => {
    const openai = createOpenAIAdapter(env, async () => json({ text: `heard ${env.OPENAI_API_KEY}` }))
    const tencent = createTencentAdapter(env, async () => json({ Response: { Result: `heard ${env.TENCENT_SECRET_KEY}` } }))
    for (const adapter of [openai, tencent]) assert.equal((await adapter.transcribe(audioFixture())).rawTranscript, 'heard [REDACTED]')
  })

  it('bounds timeout configuration', () => {
    assert.equal(timeoutFrom({}), 60_000); assert.equal(timeoutFrom({ ASR_TIMEOUT_MS: 'invalid' }), 60_000)
    assert.equal(timeoutFrom({ ASR_TIMEOUT_MS: '-1' }), 60_000)
    assert.equal(timeoutFrom({ ASR_TIMEOUT_MS: '1' }), 10)
    assert.equal(timeoutFrom({ ASR_TIMEOUT_MS: '999999999' }), 120_000)
  })

  it('aborts the provider request when its deadline expires', async () => {
    let signal: AbortSignal | undefined
    const adapter = createOpenAIAdapter(env, async (_url, init) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    })
    assert.equal((await adapter.transcribe(audioFixture())).error, 'TIMEOUT')
    assert.equal(signal?.aborted, true)
  })
})
