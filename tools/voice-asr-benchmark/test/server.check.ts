import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { request, type IncomingHttpHeaders, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { describe, it } from 'node:test'
import { createBenchmarkServer } from '../server.ts'
import { readAudio } from '../backend/audio.ts'
import { encodeWav } from '../client/audio.ts'
import type { FishCatalog } from '../backend/master-data.ts'
import type { AudioInput, BenchmarkSample, ProviderAdapter, ProviderId, TranscriptionResult } from '../shared/types.ts'

const fish = [
  { id: 'fish-kembung', displayName: '甘丰', active: true },
  { id: 'fish-merah', displayName: '红鱼', active: true },
  { id: 'fish-inactive', displayName: '停用鱼', active: false },
]
const catalog: FishCatalog = { fish, source: 'Injected test catalogue', fetchedAt: '2026-09-07T00:00:00.000Z', error: null }
const wav = () => Buffer.from(encodeWav(new Float32Array([0, .25, -.25, 0])))
const inputBody = () => ({ expectedFishSpeciesId: fish[0].id, expectedWeightKg: '12.5',
  providers: ['openai', 'tencent'], audioBase64: wav().toString('base64') })
const result = (provider: ProviderId, rawTranscript = '甘丰十二点五公斤', error: string | null = null): TranscriptionResult =>
  ({ provider, model: `fake-${provider}`, rawTranscript, latencyMs: 12, error })
const adapter = (provider: ProviderId, perform: (audio: AudioInput) => Promise<TranscriptionResult>): ProviderAdapter =>
  ({ provider, model: `fake-${provider}`, configured: true, transcribe: perform })

interface Reply { status: number; headers: IncomingHttpHeaders; text: string; json: () => Record<string, unknown> }
interface LocalClient {
  url: string; port: number; token: string; directory: string
  send(path: string, method?: string, body?: unknown, overrides?: Record<string, string | undefined>): Promise<Reply>
  restart(): Promise<void>
}

async function withServer(providers: ProviderAdapter[], run: (client: LocalClient) => Promise<void>, loadFish: () => Promise<FishCatalog> = async () => catalog) {
  const directory = await mkdtemp(join(tmpdir(), 'ccm-asr-server-check-'))
  const dataDir = join(directory, 'data'), staticDir = join(directory, 'static')
  await mkdir(staticDir)
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>Mock benchmark</title>')
  await writeFile(join(staticDir, 'app.js'), '/* mock app */')
  await writeFile(join(staticDir, 'style.css'), '/* mock styles */')
  await writeFile(join(staticDir, '.env'), 'FAKE_SENTINEL_DO_NOT_SERVE')
  let server: Server | undefined
  const client: LocalClient = {
    url: '', port: 0, token: '', directory,
    send(path, method = 'GET', body, overrides = {}) {
      const payload = body === undefined ? undefined : JSON.stringify(body)
      const headers = Object.fromEntries(Object.entries({ Host: `127.0.0.1:${client.port}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/json', 'X-Benchmark-Token': client.token } : {}),
        ...overrides }).filter((entry): entry is [string, string] => entry[1] !== undefined))
      return new Promise((resolveReply, reject) => {
        const req = request({ hostname: '127.0.0.1', port: client.port, path, method, headers }, res => {
          const parts: Buffer[] = []
          res.on('data', part => parts.push(Buffer.from(part)))
          res.on('error', reject)
          res.on('end', () => {
            const text = Buffer.concat(parts).toString('utf8')
            resolveReply({ status: res.statusCode ?? 0, headers: res.headers, text, json: () => JSON.parse(text) as Record<string, unknown> })
          })
        })
        req.on('error', reject); req.end(payload)
      })
    },
    async restart() {
      if (server) {
        const closing = new Promise<void>((done, reject) => server!.close(error => error ? reject(error) : done()))
        server.closeAllConnections(); await closing
      }
      server = createBenchmarkServer({ dataDir, staticDir, providers, loadFish })
      await new Promise<void>((done, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', done) })
      const address = server.address()
      assert.ok(address && typeof address !== 'string'); assert.equal(address.address, '127.0.0.1')
      client.port = address.port; client.url = `http://127.0.0.1:${address.port}`
      const config = await client.send('/api/config')
      assert.equal(config.status, 200); client.token = String(config.json().csrfToken)
    },
  }
  try { await client.restart(); await run(client) }
  finally {
    if (server) {
      const closing = new Promise<void>(done => server!.close(() => done()))
      server.closeAllConnections(); await closing
    }
    // Delete only this test's newly created, verified child of the system temp directory.
    const target = resolve(directory), tempRoot = resolve(tmpdir()) + sep
    assert.ok(target.startsWith(tempRoot)); assert.ok(target.includes('ccm-asr-server-check-'))
    await rm(target, { recursive: true, force: true })
  }
}

describe('local benchmark server with injected providers and temporary storage', () => {
  it('reports health and configuration flags without secrets, tokens, model details, Master Data reads, or local writes', async () => {
    let masterReads = 0
    const providers = [Object.assign(adapter('openai', async () => result('openai')), { apiKey: 'FAKE_HEALTH_SECRET', token: 'FAKE_HEALTH_TOKEN' }),
      { ...adapter('tencent', async () => result('tencent')), configured: false }]
    await withServer(providers, async client => {
      const health = await client.send('/api/health')
      assert.equal(health.status, 200)
      assert.deepEqual(health.json(), { ok: true, providers: { openai: { configured: true }, tencent: { configured: false } } })
      assert.equal(health.text.includes('FAKE_HEALTH_'), false)
      assert.equal(health.text.includes(client.token), false)
      assert.equal(masterReads, 0)
      await assert.rejects(access(join(client.directory, 'data')), { code: 'ENOENT' })
    }, async () => { masterReads++; throw new Error('Health must not contact Master Data') })
  })

  for (const available of ['openai', 'tencent'] as const) {
    it(`runs only ${available} when the other provider is unconfigured`, async () => {
      const called: ProviderId[] = []
      const providers = (['openai', 'tencent'] as const).map(provider => ({
        ...adapter(provider, async () => { called.push(provider); return result(provider) }), configured: provider === available,
      }))
      await withServer(providers, async client => {
        const reply = await client.send('/api/benchmark', 'POST', { ...inputBody(), providers: [available] })
        assert.equal(reply.status, 200)
        assert.deepEqual(called, [available])
        const sample = reply.json().sample as BenchmarkSample
        assert.equal(sample.results.length, 1)
        assert.equal(sample.results[0].provider, available)
        assert.equal(sample.results[0].wholeBasketCorrect, true)
      })
    })
  }

  it('rejects two unconfigured providers clearly before reading Master Data, parsing audio, saving samples, or invoking adapters', async () => {
    let calls = 0, masterReads = 0
    const providers = (['openai', 'tencent'] as const).map(provider => ({
      ...adapter(provider, async () => { calls++; return result(provider) }), configured: false,
    }))
    await withServer(providers, async client => {
      const health = await client.send('/api/health')
      assert.deepEqual(health.json(), { ok: true, providers: { openai: { configured: false }, tencent: { configured: false } } })
      for (const audioBase64 of [inputBody().audioBase64, 'invalid audio']) {
        const reply = await client.send('/api/benchmark', 'POST', { ...inputBody(), audioBase64 })
        assert.equal(reply.status, 503)
        assert.deepEqual(reply.json(), { error: '尚未配置任何语音识别服务' })
      }
      assert.equal(calls, 0); assert.equal(masterReads, 0)
      await assert.rejects(access(join(client.directory, 'data')), { code: 'ENOENT' })
      assert.deepEqual((await client.send('/api/samples')).json().samples, [])
    }, async () => { masterReads++; return catalog })
  })

  it('rejects an unconfigured selection with its provider name before saving or invoking any adapter', async () => {
    for (const unavailable of ['openai', 'tencent'] as const) {
      let calls = 0, masterReads = 0
      const providers = (['openai', 'tencent'] as const).map(provider => ({
        ...adapter(provider, async () => { calls++; return result(provider) }), configured: provider !== unavailable,
      }))
      await withServer(providers, async client => {
        const reply = await client.send('/api/benchmark', 'POST', { ...inputBody(), providers: [unavailable], audioBase64: 'invalid audio' })
        assert.equal(reply.status, 503)
        assert.deepEqual(reply.json(), { error: `${unavailable === 'openai' ? 'OpenAI' : 'Tencent'} API 尚未配置` })
        assert.equal(calls, 0); assert.equal(masterReads, 0)
        await assert.rejects(access(join(client.directory, 'data')), { code: 'ENOENT' })
        assert.deepEqual((await client.send('/api/samples')).json().samples, [])
      }, async () => { masterReads++; return catalog })
    }
  })

  it('runs selected providers concurrently on the same AudioInput and byte buffer, then persists one sample', async () => {
    const received: AudioInput[] = []
    let release: () => void = () => {}
    const bothStarted = new Promise<void>(done => { release = done })
    const providers = (['openai', 'tencent'] as const).map(provider => adapter(provider, async audio => {
      received.push(audio)
      if (received.length === 2) release()
      await bothStarted
      return result(provider)
    }))
    await withServer(providers, async client => {
      const reply = await client.send('/api/benchmark', 'POST', inputBody())
      assert.equal(reply.status, 200)
      assert.equal(received.length, 2); assert.strictEqual(received[0], received[1]); assert.strictEqual(received[0].bytes, received[1].bytes)
      assert.deepEqual(Buffer.from(received[0].bytes), wav())
      assert.deepEqual(Object.keys(received[0]).sort(), ['bytes', 'channels', 'durationMs', 'fileName', 'mimeType', 'sampleRate'])
      const sample = reply.json().sample as BenchmarkSample
      assert.equal(sample.results.length, 2); assert.ok(sample.results.every(row => row.wholeBasketCorrect))
      assert.equal(sample.audio.sha256, createHash('sha256').update(wav()).digest('hex'))
      const savedAudio = await readFile(join(client.directory, 'data', 'audio', sample.audio.fileName))
      assert.deepEqual(savedAudio, wav())
      const disk = JSON.parse(await readFile(join(client.directory, 'data', 'benchmark.json'), 'utf8'))
      assert.deepEqual(disk.samples, [sample])
      await client.restart()
      const history = (await client.send('/api/samples')).json()
      assert.deepEqual(history.samples, [sample])
      assert.equal((history.statistics as unknown[]).length, 2)
    })
  })

  it('calls only selected providers and saves the other result when one provider rejects', async () => {
    const called: ProviderId[] = []
    const providers = [adapter('openai', async () => { called.push('openai'); throw new Error('fake_sensitive_upstream_body') }),
      adapter('tencent', async () => { called.push('tencent'); return result('tencent') })]
    await withServer(providers, async client => {
      const single = await client.send('/api/benchmark', 'POST', { ...inputBody(), providers: ['tencent'] })
      assert.equal(single.status, 200); assert.deepEqual(called, ['tencent'])
      const both = await client.send('/api/benchmark', 'POST', inputBody())
      assert.equal(both.status, 200); assert.deepEqual(called, ['tencent', 'openai', 'tencent'])
      const sample = both.json().sample as BenchmarkSample
      assert.equal(sample.results[0].error, 'provider_request_failed'); assert.equal(sample.results[0].rawTranscript, '')
      assert.equal(sample.results[1].error, null); assert.equal(sample.results[1].wholeBasketCorrect, true)
      assert.equal(both.text.includes('fake_sensitive_upstream_body'), false)
      assert.equal((both.json().samples as unknown[]).length, 2)
    })
  })

  it('rejects invalid truth, inactive fish, provider selections, and malformed WAV before any provider calls', async () => {
    let calls = 0
    const providers = [adapter('openai', async () => { calls++; return result('openai') })]
    await withServer(providers, async client => {
      const valid = { ...inputBody(), providers: ['openai'] }
      const changedWav = (offset: number, value: number) => { const bytes = wav(); bytes[offset] = value; return bytes.toString('base64') }
      const invalid: Record<string, unknown>[] = [
        { expectedFishSpeciesId: 'missing' }, { expectedFishSpeciesId: 'fish-inactive' },
        { expectedWeightKg: '12.55' }, { expectedWeightKg: 12.5 }, { expectedWeightKg: '0' },
        { expectedWeightKg: '-1' }, { expectedWeightKg: '1e2' }, { expectedWeightKg: 'Infinity' },
        { providers: [] }, { providers: ['openai', 'openai'] }, { providers: ['unrecognized'] }, { providers: ['tencent'] },
        { audioBase64: '' }, { audioBase64: 'not valid base64' },
        { audioBase64: changedWav(22, 2) }, { audioBase64: changedWav(34, 24) },
        { audioBase64: changedWav(24, 0) }, { audioBase64: changedWav(40, 0) },
        { audioBase64: changedWav(0, 0xd2) }, // ASCII decoding must not mask an invalid high-bit RIFF tag.
      ]
      for (const fields of invalid) {
        const reply = await client.send('/api/benchmark', 'POST', { ...valid, ...fields })
        assert.equal(reply.status, 400, `Invalid input unexpectedly accepted: ${Object.keys(fields).join(',')}`)
      }
      assert.equal(calls, 0)
      assert.deepEqual((await client.send('/api/samples')).json().samples, [])
      const afterFailure = await client.send('/api/benchmark', 'POST', valid)
      assert.equal(afterFailure.status, 200); assert.equal(calls, 1)
    })
  })

  it('blocks foreign Host/Origin, cross-site requests, missing CSRF, unsupported methods, and private paths', async () => {
    let calls = 0
    await withServer([adapter('openai', async () => { calls++; return result('openai') })], async client => {
      for (const headers of [{ Host: `attacker.example:${client.port}` }, { Origin: 'https://attacker.example' },
        { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
        assert.equal((await client.send('/api/config', 'GET', undefined, headers)).status, 403)
      }
      assert.equal((await client.send('/api/config', 'GET', undefined, { Origin: client.url })).status, 200)
      assert.equal((await client.send('/api/config', 'GET', undefined, { Host: `localhost:${client.port}` })).status, 200)
      for (const headers of [{ 'X-Benchmark-Token': undefined }, { 'X-Benchmark-Token': 'wrong' }, { Origin: 'https://attacker.example' }]) {
        assert.equal((await client.send('/api/benchmark', 'POST', inputBody(), headers)).status, 403)
      }
      assert.equal((await client.send('/api/benchmark', 'POST', inputBody(), { 'Content-Type': 'text/plain' })).status, 415)
      assert.equal((await client.send('/api/benchmark', 'OPTIONS')).status, 405)
      assert.equal((await client.send('/api/benchmark', 'DELETE')).status, 405)
      for (const path of ['/.env', '/%2eenv', '/server.ts', '/providers/openai.ts', '/data/benchmark.json', '/data/master-data.json',
        '/../../.env', '/%2e%2e/.env', '/constructor', '/toString', '/__proto__']) {
        const reply = await client.send(path)
        assert.equal(reply.status, 404, path); assert.equal(reply.text.includes('FAKE_SENTINEL_DO_NOT_SERVE'), false)
      }
      const home = await client.send('/')
      assert.equal(home.status, 200); assert.ok(home.text.includes('Mock benchmark'))
      assert.equal(home.headers['x-frame-options'], 'DENY'); assert.equal(home.headers['cache-control'], 'no-store')
      assert.equal(home.headers['x-content-type-options'], 'nosniff'); assert.ok(String(home.headers['content-security-policy']).includes("frame-ancestors 'none'"))
      assert.equal(calls, 0)
    })
  })

  it('persists local aliases across restart and exports their scored samples as UTF-8 CSV', async () => {
    await withServer([adapter('openai', async () => result('openai', '金风十二点五公斤'))], async client => {
      const alias = await client.send('/api/aliases', 'POST', { phrase: '金风', fishSpeciesId: fish[0].id })
      assert.equal(alias.status, 200)
      const savedAliases = alias.json().aliases
      assert.equal((await client.send('/api/aliases', 'POST', { phrase: '停用', fishSpeciesId: 'fish-inactive' })).status, 400)
      await client.restart()
      assert.deepEqual((await client.send('/api/aliases')).json().aliases, savedAliases)
      const reply = await client.send('/api/benchmark', 'POST', { ...inputBody(), providers: ['openai'] })
      assert.equal(reply.status, 200)
      const sample = reply.json().sample as BenchmarkSample
      assert.equal(sample.results[0].matchMethod, 'alias'); assert.equal(sample.results[0].wholeBasketCorrect, true)
      assert.deepEqual(sample.aliasSnapshot, savedAliases)
      const csv = await client.send('/api/export.csv')
      assert.equal(csv.status, 200); assert.ok(String(csv.headers['content-type']).includes('text/csv; charset=utf-8'))
      assert.equal(csv.text.charCodeAt(0), 0xfeff)
      assert.ok(csv.text.includes('"金风十二点五公斤"')); assert.ok(csv.text.includes('"甘丰"')); assert.ok(csv.text.includes('"12.5"'))
      assert.ok(csv.text.includes(`"${sample.sampleId}"`)); assert.ok(csv.text.includes('"true","true","true"'))
      await client.restart()
      assert.equal((await client.send('/api/export.csv')).text, csv.text)
    })
  })

  it('accepts the exact 45-second WAV boundary and rejects one extra PCM frame', () => {
    const maximum = Buffer.from(encodeWav(new Float32Array(45 * 16000)))
    assert.equal(readAudio(maximum.toString('base64'), 'sample').input.durationMs, 45000)
    const tooLong = Buffer.from(encodeWav(new Float32Array(45 * 16000 + 1)))
    assert.throws(() => readAudio(tooLong.toString('base64'), 'sample'))
  })
})
