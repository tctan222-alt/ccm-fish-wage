import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { test, type TestContext } from 'node:test'
import { activeFish, createMasterLoader, fetchMasterData, PROJECT_ID, saveMasterSnapshot } from '../backend/master-data.ts'
import { LocalStore } from '../backend/store.ts'
import { aggregateStatistics, evaluateResult } from '../core/evaluation.ts'
import { matchFish } from '../core/parsing.ts'
import type { BenchmarkSample, FishSpecies, VoiceAlias } from '../shared/types.ts'

const fish: FishSpecies[] = [
  { id: 'kembung', displayName: '甘丰', active: true },
  { id: 'mabong', displayName: '马丰', active: true },
  { id: 'inactive', displayName: '停用鱼', active: false },
]

async function dataDirectory(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ccm-voice-master-store-'))
  context.after(async () => {
    const target = resolve(directory)
    if (!target.startsWith(`${resolve(tmpdir())}${sep}`) || !basename(target).startsWith('ccm-voice-master-store-')) throw new Error('Refusing cleanup outside this test temporary directory')
    await rm(target, { recursive: true, force: true })
  })
  return directory
}

function document(id: string, displayName: string, active: boolean) {
  return { name: `projects/${PROJECT_ID}/databases/(default)/documents/fishSpecies/${id}`, fields: {
    displayName: { stringValue: displayName }, active: { booleanValue: active }, voiceAliases: { arrayValue: { values: [{ stringValue: ' alias ' }] } },
  } }
}

function sample(aliasSnapshot: VoiceAlias[] = []): BenchmarkSample {
  const expected = { sampleId: randomUUID(), expectedFishSpeciesId: 'kembung', expectedFishName: '甘丰', expectedWeightKg: 80,
    audio: { sha256: 'test-audio', byteLength: 32044, mimeType: 'audio/wav' as const, sampleRate: 16000, channels: 1, durationMs: 1000, fileName: 'test.wav' } }
  return { ...expected, createdAt: '2026-09-07T00:00:00Z', aliasSnapshot, fishSnapshot: fish,
    results: [evaluateResult(expected, { provider: 'openai', model: 'test-model', rawTranscript: '甘风80kg', latencyMs: 120, error: null }, fish, aliasSnapshot)] }
}

test('Master Data pagination issues only GET requests to the fixed project collection', async () => {
  const requests: { url: URL; init: RequestInit | undefined }[] = []
  const mockedFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push({ url, init })
    if (requests.length === 1) return Response.json({ documents: [document('kembung', '甘丰', true), document('inactive', '停用鱼', false)], nextPageToken: 'next/ cursor' })
    return Response.json({ documents: [document('mabong', '马丰', true), document('kembung', '重复 ID', true)] })
  }
  const actual = await fetchMasterData('test-read-token', mockedFetch)
  assert.deepEqual(new Set(actual.map(item => item.id)), new Set(['kembung', 'mabong']))
  assert.equal(actual.find(item => item.id === 'kembung')?.displayName, '甘丰')
  assert.deepEqual(actual[0].voiceAliases, ['alias'])
  assert.equal(requests.length, 2)
  assert.equal(requests[1].url.searchParams.get('pageToken'), 'next/ cursor')
  for (const { url, init } of requests) {
    assert.equal(url.origin, 'https://firestore.googleapis.com')
    assert.equal(url.pathname, `/v1/projects/${PROJECT_ID}/databases/(default)/documents/fishSpecies`)
    assert.equal(url.searchParams.get('pageSize'), '300')
    assert.equal(init?.method, 'GET')
    assert.equal(init?.body, undefined)
    assert.equal(init?.redirect, 'error')
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-read-token')
    assert.ok(init?.signal)
  }
})

test('Master Data filtering rejects malformed entries and keeps only active unique IDs', () => {
  const input: unknown = [...fish, { id: 'missing-name', active: true }, { id: 'truthy-active', displayName: '错误状态', active: 'true' }, null,
    { id: 'clean', displayName: ' 清理鱼 ', active: true, voiceAliases: [' 正确别名 ', '', null, 42] }, { ...fish[0], displayName: '重复' }]
  const actual = activeFish(input)
  assert.deepEqual(new Set(actual.map(item => item.id)), new Set(['kembung', 'mabong', 'clean']))
  assert.deepEqual(actual.find(item => item.id === 'clean'), { id: 'clean', displayName: '清理鱼', active: true, voiceAliases: ['正确别名'] })
  assert.throws(() => activeFish({ fish }), /快照格式错误/u)
})

test('Only a snapshot with the exact project, collection and valid capture time is accepted', async context => {
  const directory = await dataDirectory(context)
  const snapshot = await saveMasterSnapshot(directory, fish)
  const file = join(directory, 'master-data.json')
  const neverFetch: typeof fetch = async () => { throw new Error('Offline snapshot must not make requests') }
  const catalog = await createMasterLoader(directory, {}, neverFetch)()
  assert.equal(snapshot.projectId, PROJECT_ID)
  assert.equal(snapshot.collection, 'fishSpecies')
  assert.ok(Number.isFinite(Date.parse(snapshot.fetchedAt)))
  assert.deepEqual(catalog.fish.map(item => item.id), snapshot.fish.map(item => item.id))
  assert.equal(catalog.fetchedAt, snapshot.fetchedAt)
  assert.match(catalog.source, /本地只读快照/u)
  assert.equal(catalog.error, null)
  for (const invalid of [{ projectId: 'different-project' }, { collection: 'retailFish' }, { fetchedAt: 'invalid-date' }]) {
    const bytes = JSON.stringify({ ...snapshot, ...invalid })
    await writeFile(file, bytes)
    const rejected = await createMasterLoader(directory, {}, neverFetch)()
    assert.deepEqual(rejected.fish, [])
    assert.ok(rejected.error)
    assert.equal(await readFile(file, 'utf8'), bytes)
  }
})

test('A failed authenticated live request never falls back to or overwrites a stale snapshot', async context => {
  const directory = await dataDirectory(context)
  await saveMasterSnapshot(directory, fish)
  const file = join(directory, 'master-data.json'), original = await readFile(file, 'utf8')
  const mockedFetch: typeof fetch = async () => new Response('upstream details must stay private', { status: 403 })
  const catalog = await createMasterLoader(directory, { ERP_FIRESTORE_TOKEN: 'test-read-token' }, mockedFetch)()
  assert.deepEqual(catalog.fish, [])
  assert.equal(catalog.fetchedAt, null)
  assert.match(catalog.error ?? '', /未回退旧快照/u)
  assert.doesNotMatch(JSON.stringify(catalog), /test-read-token|upstream details/u)
  assert.equal(await readFile(file, 'utf8'), original)
  await assert.rejects(fetchMasterData('test-read-token', mockedFetch), /HTTP 403/u)
})

test('Concurrent Master Data loads share one GET and persist an explicit provenance snapshot', async context => {
  const directory = await dataDirectory(context)
  let calls = 0, release = () => {}
  const gate = new Promise<void>(resolveGate => { release = resolveGate })
  const mockedFetch: typeof fetch = async () => { calls++; await gate; return Response.json({ documents: [document('kembung', '甘丰', true)] }) }
  const load = createMasterLoader(directory, { ERP_FIRESTORE_TOKEN: 'test-read-token' }, mockedFetch)
  const first = load(), second = load()
  assert.equal(calls, 1)
  release()
  const [left, right] = await Promise.all([first, second])
  assert.equal(left, right)
  assert.equal((await load()).error, null)
  assert.equal(calls, 1)
  const snapshot = JSON.parse(await readFile(join(directory, 'master-data.json'), 'utf8'))
  assert.equal(snapshot.projectId, PROJECT_ID)
  assert.equal(snapshot.collection, 'fishSpecies')
  assert.equal(snapshot.fetchedAt, left.fetchedAt)
  assert.equal(snapshot.fish[0].id, 'kembung')
})

test('LocalStore serializes concurrent sample and alias writes without losing either collection', async context => {
  const directory = await dataDirectory(context), store = new LocalStore(directory)
  const samples = Array.from({ length: 12 }, () => sample())
  await Promise.all(samples.flatMap((item, index) => [store.addSample(item), store.setAlias(`别名${index}`, 'kembung')]))
  const state = await store.state()
  assert.equal(state.samples.length, 12)
  assert.equal(state.aliases.length, 12)
  assert.deepEqual(new Set(state.samples.map(item => item.sampleId)), new Set(samples.map(item => item.sampleId)))
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'benchmark.json'), 'utf8')), state)
})

test('Local alias changes never rewrite prior alias/fish snapshots or historical accuracy', async context => {
  const directory = await dataDirectory(context), store = new LocalStore(directory)
  const before = sample()
  assert.equal(before.results[0].fishCorrect, false)
  await store.addSample(before)
  await store.setAlias('甘风', 'kembung')
  const state = await store.state()
  assert.deepEqual(state.samples[0], before)
  assert.deepEqual(state.samples[0].aliasSnapshot, [])
  assert.equal(aggregateStatistics(state.samples.flatMap(item => item.results))[0].fishAccuracy, 0)
  assert.equal(sample(state.aliases).results[0].fishCorrect, true)
  state.samples[0].results[0].fishCorrect = true
  assert.equal((await store.state()).samples[0].results[0].fishCorrect, false)
})

test('Alias correction uses the same punctuation-insensitive identity as fish matching', async context => {
  const directory = await dataDirectory(context), store = new LocalStore(directory)
  await store.setAlias(' 甘风。 ', 'kembung')
  await store.setAlias('甘风', 'mabong')
  const { aliases } = await store.state()
  assert.equal(aliases.length, 1)
  assert.equal(matchFish('甘风。', fish, aliases).candidate?.id, 'mabong')
})

test('A corrupt local store fails without replacing the original file', async context => {
  const directory = await dataDirectory(context), store = new LocalStore(directory)
  const path = join(directory, 'benchmark.json'), original = '{ invalid json'
  await writeFile(path, original)
  await assert.rejects(store.addSample(sample()), /未覆盖原数据/u)
  await assert.rejects(store.setAlias('甘风', 'kembung'), /未覆盖原数据/u)
  assert.equal(await readFile(path, 'utf8'), original)
})
