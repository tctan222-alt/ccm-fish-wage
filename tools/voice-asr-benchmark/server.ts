import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMasterLoader, type FishCatalog } from './backend/master-data.ts'
import { LocalStore } from './backend/store.ts'
import { MAX_AUDIO_BYTES, MAX_DURATION_SECONDS, readAudio } from './backend/audio.ts'
import { createOpenAIAdapter, createTencentAdapter } from './providers/index.ts'
import { aggregateStatistics, evaluateResult } from './core/evaluation.ts'
import { exportCsv } from './core/csv.ts'
import type { BenchmarkSample, ProviderAdapter, ProviderId, TranscriptionResult } from './shared/types.ts'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
class RequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
interface ServerOptions { dataDir?: string; staticDir?: string; providers?: ProviderAdapter[]; loadFish?: () => Promise<FishCatalog> }
const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)) }
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 10000) throw new RequestError(413, '请求超过音频大小上限。')
    chunks.push(chunk as Buffer)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch { throw new RequestError(400, '请求必须是 JSON 对象。') }
}

export function createBenchmarkServer(options: ServerOptions = {}) {
  const store = new LocalStore(options.dataDir ?? join(ROOT, 'data'))
  const loadFish = options.loadFish ?? createMasterLoader(store.dataDir)
  const adapters = options.providers ?? [createOpenAIAdapter(), createTencentAdapter()]
  const csrfToken = randomBytes(32).toString('hex')
  let busy = false
  const history = async () => {
    const { samples } = await store.state()
    return { samples, statistics: aggregateStatistics(samples.flatMap(sample => sample.results)) }
  }
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
    void (async () => {
      const port = req.socket.localPort
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`]
      if (!allowedHosts.includes(req.headers.host ?? '')) throw new RequestError(403, '仅允许本机访问。')
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new RequestError(403, '拒绝跨来源请求。')
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new RequestError(403, '拒绝跨站请求。')
      const path = new URL(req.url ?? '/', `http://${req.headers.host}`).pathname
      if (req.method === 'POST') {
        if (req.headers['x-benchmark-token'] !== csrfToken) throw new RequestError(403, '本地请求令牌失效，请刷新页面。')
        if (!req.headers['content-type']?.startsWith('application/json')) throw new RequestError(415, '只接受 JSON 请求。')
        const body = await readBody(req)
        if (path === '/api/aliases') {
          const catalog = await loadFish()
          if (catalog.error) throw new RequestError(503, catalog.error)
          const phrase = typeof body.phrase === 'string' ? body.phrase.trim() : ''
          if (!phrase || phrase.length > 100 || /[\p{Cc}\p{Cf}]/u.test(phrase) || typeof body.fishSpeciesId !== 'string' || !catalog.fish.some(fish => fish.active && fish.id === body.fishSpeciesId)) throw new RequestError(400, '别名需要有效短语和 active Master Data 鱼种。')
          await store.setAlias(phrase, body.fishSpeciesId)
          return json(res, 200, { aliases: (await store.state()).aliases })
        }
        if (path === '/api/benchmark') {
          if (busy) throw new RequestError(409, '已有比较进行中，请等待完成。')
          busy = true
          try {
            if (!Array.isArray(body.providers) || !body.providers.length || body.providers.length > 2 || new Set(body.providers).size !== body.providers.length || body.providers.some(id => id !== 'openai' && id !== 'tencent')) throw new RequestError(400, '请选择 OpenAI 和/或腾讯 ASR。')
            if (!adapters.some(adapter => adapter.configured)) throw new RequestError(503, '尚未配置任何语音识别服务')
            const selected = (body.providers as ProviderId[]).map(id => adapters.find(adapter => adapter.provider === id))
            if (selected.some(adapter => !adapter)) throw new RequestError(400, '所选 provider 不可用。')
            const unconfigured = selected.filter(adapter => !adapter!.configured)
            if (unconfigured.length) throw new RequestError(503, `${unconfigured.map(adapter => adapter!.provider === 'openai' ? 'OpenAI' : 'Tencent').join('、')} API 尚未配置`)
            const catalog = await loadFish()
            if (catalog.error) throw new RequestError(503, catalog.error)
            const expectedFish = catalog.fish.find(fish => fish.active && fish.id === body.expectedFishSpeciesId)
            if (!expectedFish) throw new RequestError(400, '标准鱼种必须来自当前 active Master Data。')
            if (typeof body.expectedWeightKg !== 'string' || !/^\d+(?:\.\d)?$/.test(body.expectedWeightKg.trim())) throw new RequestError(400, '标准重量必须为正数，最多 1 位小数。')
            const expectedWeightKg = Number(body.expectedWeightKg)
            if (expectedWeightKg <= 0 || !Number.isSafeInteger(Math.round(expectedWeightKg * 10))) throw new RequestError(400, '标准重量超出有效范围。')
            const sampleId = randomUUID()
            let audio: ReturnType<typeof readAudio>
            try { audio = readAudio(body.audioBase64, sampleId) } catch (error) { throw new RequestError(400, (error as Error).message) }
            const aliasSnapshot = (await store.state()).aliases
            const expected = { sampleId, expectedFishSpeciesId: expectedFish.id, expectedFishName: expectedFish.displayName, expectedWeightKg, audio: audio.metadata }
            // Saving first avoids paid requests when the local disk cannot accept the sample.
            await store.saveAudio(sampleId, audio.input.bytes)
            const outputs = await Promise.all(selected.map(async adapter => {
              const chosen = adapter!
              const started = performance.now()
              try { return await chosen.transcribe(audio.input) }
              catch { return { provider: chosen.provider, model: chosen.model, rawTranscript: '', latencyMs: Math.round(performance.now() - started), error: 'provider_request_failed' } satisfies TranscriptionResult }
            }))
            const sample: BenchmarkSample = { ...expected, createdAt: new Date().toISOString(), aliasSnapshot, fishSnapshot: catalog.fish,
              results: outputs.map(output => evaluateResult(expected, output, catalog.fish, aliasSnapshot)) }
            await store.addSample(sample)
            return json(res, 200, { sample, ...await history() })
          } finally { busy = false }
        }
        throw new RequestError(404, '接口不存在。')
      }
      if (req.method !== 'GET') throw new RequestError(405, '不支持此请求方式。')
      if (path === '/api/health') return json(res, 200, { ok: true, providers: {
        openai: { configured: adapters.some(adapter => adapter.provider === 'openai' && adapter.configured) },
        tencent: { configured: adapters.some(adapter => adapter.provider === 'tencent' && adapter.configured) },
      } })
      if (path === '/api/config') return json(res, 200, { csrfToken, maxDurationSeconds: MAX_DURATION_SECONDS, providers: adapters.map(adapter => ({ id: adapter.provider, label: adapter.provider === 'openai' ? 'OpenAI' : '腾讯', configured: adapter.configured, model: adapter.model })) })
      if (path === '/api/fish') return json(res, 200, await loadFish())
      if (path === '/api/samples') return json(res, 200, await history())
      if (path === '/api/aliases') return json(res, 200, { aliases: (await store.state()).aliases })
      if (path === '/api/export.csv') {
        const { samples } = await store.state()
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="voice-asr-benchmark.csv"' })
        res.end(exportCsv(samples.flatMap(sample => sample.results))); return
      }
      const files: Record<string, [string, string]> = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] }
      const file = files[path]
      if (!Object.hasOwn(files, path)) throw new RequestError(404, '文件不存在。')
      try {
        const content = await readFile(join(options.staticDir ?? join(ROOT, 'node_modules', '.cache', 'voice-asr-benchmark'), file[0]))
        res.writeHead(200, { 'Content-Type': file[1] }); res.end(content)
      } catch { throw new RequestError(503, '请先运行 npm.cmd run build。') }
    })().catch(error => {
      if (!res.headersSent) json(res, error instanceof RequestError ? error.status : 500, { error: error instanceof RequestError ? error.message : '本地操作失败；请检查数据目录及服务配置。未输出凭据或上游响应。' })
      else res.end()
    })
  })
  server.requestTimeout = 150000
  server.headersTimeout = 10000
  return server
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.BENCHMARK_PORT ?? 8787)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('BENCHMARK_PORT 必须在 1024–65535。')
  const server = createBenchmarkServer()
  server.on('error', () => { console.error('本地服务启动失败，请检查端口是否被占用。'); process.exitCode = 1 })
  server.listen(port, '127.0.0.1', () => console.info(`潮州话语音识别测试：http://127.0.0.1:${port}（仅本机；不会自动上传录音）`))
}
