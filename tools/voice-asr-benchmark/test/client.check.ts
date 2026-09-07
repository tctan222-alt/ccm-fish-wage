import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { JSDOM } from 'jsdom'
import { buildClient } from '../scripts/build-client.ts'
import { readAudio } from '../backend/audio.ts'
import { evaluateResult, aggregateStatistics } from '../core/evaluation.ts'
import type { BenchmarkSample, ProviderId } from '../shared/types.ts'

let directory = '', markup = '', bundle = ''
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ccm-asr-client-check-'))
  await buildClient(directory)
  markup = await readFile(join(directory, 'index.html'), 'utf8')
  bundle = await readFile(join(directory, 'app.js'), 'utf8')
})
after(async () => {
  const path = resolve(directory), base = resolve(tmpdir()) + sep
  assert.ok(path.startsWith(base) && path.includes('ccm-asr-client-check-'))
  await rm(path, { recursive: true, force: true })
})
const fish = [{ id: 'fish-gold', displayName: '金线', active: true }]
async function until(check: () => boolean, message = 'UI did not settle') {
  const deadline = Date.now() + 2000
  while (!check() && Date.now() < deadline) await new Promise(done => setTimeout(done, 5))
  assert.ok(check(), message)
}
interface HarnessOptions { configured?: ProviderId[]; offline?: boolean; thrown?: boolean; historyError?: boolean; stopDecodeError?: boolean; waitForReply?: Promise<void> }
async function openClient(options: HarnessOptions = {}) {
  const configured = options.configured ?? ['openai', 'tencent']
  const dom = new JSDOM(markup, { url: 'http://127.0.0.1:8787/', runScripts: 'outside-only' })
  const win = dom.window
  const calls: { path: string; method: string; body?: Record<string, unknown> }[] = []
  let offline = options.offline ?? false
  let trackStops = 0
  const byId = <T extends HTMLElement = HTMLElement>(id: string) => win.document.getElementById(id) as T
  const text = () => win.document.body.textContent ?? ''
  Object.defineProperty(win, 'Blob', { value: Blob })
  Object.defineProperty(win, 'fetch', { value: async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    calls.push({ path, method: init?.method ?? 'GET', body })
    if (offline) throw new TypeError('Failed to fetch')
    const response = (value: unknown, status = 200) => ({ ok: status < 400, status, json: async () => value })
    if (path === '/api/health') return response({ ok: true, providers: { openai: { configured: configured.includes('openai') }, tencent: { configured: configured.includes('tencent') } } })
    if (path === '/api/config') return response({ csrfToken: 'test-session-token', maxDurationSeconds: 45, providers: (['openai', 'tencent'] as const).map(id => ({ id, label: id === 'openai' ? 'OpenAI' : 'Tencent', configured: configured.includes(id), model: 'mock' })) })
    if (path === '/api/fish') return response({ fish, source: 'fixture only', fetchedAt: '2026-09-07T00:00:00Z', error: null })
    if (path === '/api/samples') return options.historyError ? response({ error: '本地历史文件无法读取' }, 500) : response({ samples: [], statistics: [] })
    if (path === '/api/benchmark') {
      if (options.waitForReply) await options.waitForReply
      const sampleId = '11111111-1111-4111-8111-111111111111'
      const audio = readAudio(body?.audioBase64, sampleId)
      const expected = { sampleId, expectedFishSpeciesId: fish[0].id, expectedFishName: fish[0].displayName, expectedWeightKg: Number(body?.expectedWeightKg), audio: audio.metadata }
      const results = (body?.providers as ProviderId[]).map(provider => evaluateResult(expected, { provider, model: 'mock', rawTranscript: options.thrown ? '' : '金线八十点五', latencyMs: 10, error: options.thrown ? 'provider_request_failed' : null }, fish, []))
      const sample: BenchmarkSample = { ...expected, createdAt: '2026-09-07T00:00:00Z', fishSnapshot: fish, aliasSnapshot: [], results }
      return response({ sample, samples: [sample], statistics: aggregateStatistics(results) })
    }
    return response({ error: 'not found' }, 404)
  } })
  win.HTMLMediaElement.prototype.pause = () => {}
  win.HTMLMediaElement.prototype.load = () => {}
  win.URL.createObjectURL = () => 'blob:fixture'
  win.URL.revokeObjectURL = () => {}
  Object.defineProperty(win.navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getTracks: () => [{ stop() { trackStops++ } }] }) } })
  class Recorder {
    state = 'inactive'; mimeType = 'audio/webm'
    ondataavailable?: (event: { data: Blob }) => void
    onstop?: () => void
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) }); this.onstop?.() }
  }
  class AudioContext {
    async decodeAudioData() { if (options.stopDecodeError) throw new Error('decode failed'); return { length: 16000, duration: 1 } }
    async close() {}
  }
  class OfflineAudioContext {
    destination = {}
    createBufferSource() { return { buffer: null, connect() {}, start() {} } }
    async startRendering() { return { getChannelData: () => new Float32Array(16000).fill(.25) } }
  }
  Object.assign(win, { MediaRecorder: Recorder, AudioContext, OfflineAudioContext })
  win.eval(bundle)
  await until(() => !!byId('status') && !/正在载入|正在连接|正在检查/.test(byId('status').textContent ?? ''))
  return {
    dom, calls, byId, text, setOffline(value: boolean) { offline = value }, trackStops: () => trackStops,
    async record() {
      byId<HTMLButtonElement>('start').click()
      await until(() => !byId<HTMLButtonElement>('stop').disabled)
      byId<HTMLButtonElement>('stop').click()
      await until(() => options.stopDecodeError ? /音频处理失败/.test(text()) : /已录音|1\.00 秒/.test(byId('audio-info').textContent ?? ''))
      byId<HTMLInputElement>('weight').value = '80.5'; byId('weight').dispatchEvent(new win.Event('input', { bubbles: true }))
    },
    async close() { win.dispatchEvent(new win.Event('beforeunload')); win.close() },
  }
}

test('no audio: the actual bound Compare control explains 请先录音 and makes no POST', async () => {
  const app = await openClient()
  try {
    const compare = app.byId<HTMLButtonElement>('compare')
    assert.equal(typeof compare.onclick, 'function')
    assert.equal(compare.disabled, true)
    assert.match(app.text(), /请先录音/)
    compare.click()
    assert.equal(app.calls.filter(call => call.method === 'POST').length, 0)
  } finally { await app.close() }
})

test('both missing credentials remain explicit after Stop creates a valid audio Blob', async () => {
  const app = await openClient({ configured: [] })
  try {
    assert.match(app.text(), /尚未配置任何语音识别服务/)
    assert.ok(app.calls.some(call => call.path === '/api/health'))
    await app.record()
    assert.match(app.byId('audio-info').textContent ?? '', /已录音.*1(?:\.\d+)? 秒/)
    assert.ok(app.trackStops() > 0)
    assert.equal(app.byId<HTMLButtonElement>('compare').disabled, true)
    assert.equal(app.calls.filter(call => call.method === 'POST').length, 0)
  } finally { await app.close() }
})

for (const configured of [['openai'], ['tencent'], ['openai', 'tencent']] as ProviderId[][]) {
  test(`${configured.join('+')} configured: record Stop produces WAV, selects only available providers and restores Compare`, async () => {
    let finish: () => void = () => {}
    const waitForReply = new Promise<void>(done => { finish = done })
    const app = await openClient({ configured, waitForReply })
    try {
      await app.record()
      assert.equal(app.byId<HTMLButtonElement>('compare').disabled, false)
      app.byId<HTMLButtonElement>('compare').click()
      await until(() => app.calls.some(call => call.path === '/api/benchmark'))
      const post = app.calls.find(call => call.path === '/api/benchmark')!
      assert.equal(post.method, 'POST'); assert.deepEqual(post.body?.providers, configured)
      assert.equal(readAudio(post.body?.audioBase64, 'fixture').input.bytes.length, 32044)
      assert.match(app.byId('status').textContent ?? '', /比较中/)
      assert.equal(app.byId<HTMLButtonElement>('compare').disabled, true)
      finish()
      await until(() => /比较完成/.test(app.byId('status').textContent ?? ''))
      assert.equal(app.byId<HTMLButtonElement>('compare').disabled, false)
      assert.match(app.byId('results').textContent ?? '', /金线/)
    } finally { finish(); await app.close() }
  })
}

test('offline backend is visible and Compare remains disabled with a local-server reason', async () => {
  const app = await openClient({ offline: true })
  try {
    assert.match(app.text(), /未连接/)
    assert.match(app.text(), /本地识别服务未启动|无法连接本地识别服务/)
    assert.equal(app.byId<HTMLButtonElement>('compare').disabled, true)
  } finally { await app.close() }
})

test('adapter throw produces a visible Chinese error and restores button state', async () => {
  const app = await openClient({ configured: ['openai'], thrown: true })
  try {
    await app.record(); app.byId<HTMLButtonElement>('compare').click()
    await until(() => app.byId('results').textContent?.includes('mock') ?? false)
    assert.match(app.byId('status').textContent ?? '', /失败.*OpenAI|OpenAI.*失败/)
    assert.match(app.byId('results').textContent ?? '', /识别请求失败/)
    assert.equal(app.byId<HTMLButtonElement>('compare').disabled, false)
  } finally { await app.close() }
})

test('decode failure explains why recording cannot be compared', async () => {
  const app = await openClient({ stopDecodeError: true })
  try {
    await app.record()
    assert.match(app.text(), /音频处理失败/)
    assert.match(app.text(), /请先录音|重新录音/)
    assert.equal(app.byId<HTMLButtonElement>('compare').disabled, true)
    assert.equal(app.calls.filter(call => call.method === 'POST').length, 0)
  } finally { await app.close() }
})

test('unrelated history load failure does not silently lock recording and comparison', async () => {
  const app = await openClient({ configured: ['openai'], historyError: true })
  try {
    assert.match(app.text(), /历史.*失败|历史.*无法读取/)
    assert.equal(app.byId<HTMLButtonElement>('start').matches(':disabled'), false)
    await app.record()
    assert.equal(app.byId<HTMLButtonElement>('compare').matches(':disabled'), false)
  } finally { await app.close() }
})

test('cancelling a file picker retains a usable recording and its Compare state', async () => {
  const app = await openClient({ configured: ['openai'] })
  try {
    await app.record()
    const audioDescription = app.byId('audio-info').textContent
    app.byId<HTMLButtonElement>('file').click()
    // A cancelled chooser has no change event; only the native input click happens.
    assert.equal(app.byId('audio-info').textContent, audioDescription)
    assert.equal(app.byId<HTMLButtonElement>('compare').disabled, false)
  } finally { await app.close() }
})

test('blank and overprecise expected weight have separate actionable reasons', async () => {
  const app = await openClient({ configured: ['openai'] })
  try {
    await app.record()
    const weight = app.byId<HTMLInputElement>('weight')
    for (const [value, reason] of [['', /请输入预期重量/], ['80.55', /最多 1 位小数/]] as const) {
      weight.value = value; weight.dispatchEvent(new app.dom.window.Event('input', { bubbles: true }))
      assert.equal(app.byId<HTMLButtonElement>('compare').disabled, true)
      assert.match(app.byId('compare-reason').textContent ?? '', reason)
    }
    assert.equal(app.calls.filter(call => call.method === 'POST').length, 0)
  } finally { await app.close() }
})

test('server disconnect and reconnect update the status without losing audio or auto-submitting', async () => {
  const app = await openClient({ configured: ['tencent'] })
  try {
    await app.record(); app.setOffline(true)
    app.byId<HTMLButtonElement>('refresh').click()
    await until(() => app.byId('server-status').textContent === '未连接')
    await until(() => !app.byId<HTMLButtonElement>('refresh').disabled)
    assert.equal(app.byId<HTMLButtonElement>('compare').disabled, true)
    assert.match(app.byId('compare-reason').textContent ?? '', /无法连接本地识别服务/)
    app.setOffline(false); app.byId<HTMLButtonElement>('refresh').click()
    await until(() => !app.byId<HTMLButtonElement>('refresh').disabled && app.byId('server-status').textContent === '已连接')
    assert.equal(app.byId<HTMLButtonElement>('compare').disabled, false)
    assert.match(app.byId('audio-info').textContent ?? '', /已录音/)
    assert.equal(app.calls.filter(call => call.method === 'POST').length, 0)
  } finally { await app.close() }
})

test('a request-time disconnect exits loading with a Chinese error and disabled offline button', async () => {
  const app = await openClient({ configured: ['openai'] })
  try {
    await app.record(); app.setOffline(true); app.byId<HTMLButtonElement>('compare').click()
    await until(() => /比较失败/.test(app.byId('status').textContent ?? ''))
    assert.equal(app.byId('server-status').textContent, '未连接')
    assert.match(app.byId('status').textContent ?? '', /无法连接本地识别服务/)
    assert.equal(app.byId<HTMLButtonElement>('compare').disabled, true)
    assert.equal(app.byId('compare').textContent, '开始比较')
    assert.equal(app.byId<HTMLFieldSetElement>('inputs').disabled, false)
    assert.equal(app.calls.filter(call => call.path === '/api/benchmark').length, 1)
  } finally { await app.close() }
})
