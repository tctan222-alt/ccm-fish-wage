import assert from 'node:assert/strict'
import { test } from 'node:test'
import { auditErrorMessage, fetchQueueInventory, QUEUE_REPOSITORY, renderQueueSummary } from './cloud-queue-audit.mjs'

const item = (number, overrides = {}) => ({ number, title: `Task ${number}`, labels: [{ name: 'codex-ready' }], ...overrides })
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const inventory = (overrides = {}) => ({ repository: QUEUE_REPOSITORY, observedAt: '2026-11-06T14:00:00.000Z', issues: [], pullRequests: [], ...overrides })

test('reads every page with pinned GET-only requests and excludes PRs from the issue inventory', async () => {
  const calls = []
  const firstPage = Array.from({ length: 100 }, (_, index) => item(index + 1, index === 0 ? { pull_request: { url: 'ignored' } } : {}))
  const result = await fetchQueueInventory({ token: 'ephemeral-token', observedAt: '2026-11-06T14:00:00.000Z', fetchImpl: async (url, options) => {
    calls.push({ url, options })
    const parsed = new globalThis.URL(url)
    if (parsed.pathname.endsWith('/pulls')) return response([item(32, { draft: true }), item(36, { draft: true })])
    return response(parsed.searchParams.get('page') === '1' ? firstPage : [item(101)])
  } })
  assert.equal(result.issues.length, 100)
  assert.equal(result.issues.some(issue => issue.number === 1), false)
  assert.equal(result.issues.at(-1).number, 101)
  assert.deepEqual(result.pullRequests.map(pr => pr.number), [32, 36])
  assert.equal(calls.length, 3)
  for (const { url, options } of calls) {
    assert.match(url, /^https:\/\/api\.github\.com\/repos\/tctan222-alt\/ccm-fish-wage\/(issues|pulls)\?state=open&per_page=100&page=[12]$/)
    assert.equal(options.method, 'GET')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.Authorization, 'Bearer ephemeral-token')
    assert.equal(options.headers['X-GitHub-Api-Version'], '2022-11-28')
    assert.equal('body' in options, false)
    assert.ok(options.signal instanceof globalThis.AbortSignal)
  }
})

test('does not fetch without a token and never exposes an unexpected credential error', async () => {
  let calls = 0
  await assert.rejects(fetchQueueInventory({ token: '', fetchImpl: async () => { calls += 1 } }), /read-only GitHub token is required/)
  assert.equal(calls, 0)
  assert.equal(auditErrorMessage(new Error('Bearer secret-credential')), 'Queue audit failed unexpectedly; no queue changes were made.')
})

test('sanitizes network and HTTP failures without response bodies or token values', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('Bearer secret-credential') },
    async () => response({ message: 'secret-credential' }, 403),
  ]) {
    let error
    try { await fetchQueueInventory({ token: 'secret-credential', fetchImpl }) } catch (caught) { error = caught }
    assert.ok(error)
    const message = auditErrorMessage(error)
    assert.match(message, /GitHub queue read failed/)
    assert.equal(message.includes('secret-credential'), false)
    assert.equal(message.includes('Bearer'), false)
  }
})

test('rejects malformed queue pages and items instead of reporting a complete inventory', async () => {
  for (const body of [null, {}, [null], [item(0)], [item(1, { labels: ['codex-ready'] })]]) {
    await assert.rejects(fetchQueueInventory({ token: 'token', fetchImpl: async () => response(body) }), /invalid queue/)
  }
  await assert.rejects(fetchQueueInventory({ token: 'token', fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('secret') } }) }), /invalid queue JSON/)
})

test('refuses an incomplete inventory when pagination exceeds the bound', async () => {
  const page = Array.from({ length: 100 }, (_, index) => item(index + 1))
  await assert.rejects(fetchQueueInventory({ token: 'token', fetchImpl: async url => response(url.includes('/pulls?') ? [] : page) }), /inventory is incomplete/)
})

test('redacts credentials from source data and escapes untrusted Markdown and HTML titles', async () => {
  const result = await fetchQueueInventory({ token: 'token-value', fetchImpl: async url => response(url.includes('/pulls?') ? [] : [item(74, {
    title: 'token-value <script>alert(1)</script>\n| [jump](https://evil.invalid) `cmd`',
    html_url: 'https://evil.invalid',
    labels: [{ name: 'owner-decision' }, { name: 'token-value' }],
  })]) })
  const text = renderQueueSummary(result)
  assert.equal(text.includes('token-value'), false)
  assert.equal(text.includes('<script>'), false)
  assert.equal(text.includes('\n| [jump]'), false)
  assert.equal(text.includes('](https://evil.invalid)'), false)
  assert.ok(text.includes('&lt;script&gt;'))
  assert.ok(text.includes('\\| \\[jump\\]\\(https://evil\\.invalid\\)'))
  assert.ok(text.includes('https://github.com/tctan222-alt/ccm-fish-wage/issues/74'))
})

test('summarizes queue labels without inferring approval or claiming active work', () => {
  const text = renderQueueSummary(inventory({ issues: [
    { number: 73, title: 'Ready', labels: ['codex-ready'] },
    { number: 74, title: 'Migration', labels: ['owner-decision'] },
    { number: 76, title: 'Working', labels: ['codex-in-progress'] },
    { number: 77, title: 'Reviewing', labels: ['codex-review'] },
    { number: 24, title: 'Unlabelled', labels: [] },
  ] }))
  assert.ok(text.includes('A queue label is not proof of owner approval.'))
  assert.ok(text.includes('Inspect active ownership and checkpoint'))
  assert.ok(text.includes('status not verified'))
  assert.ok(text.includes('Active-labelled issues observed: 2. Multiple active issues require manual ownership triage.'))
  assert.equal(text.includes('#24 Unlabelled'), false)
  assert.ok(text.includes('No claim, code generation, paid model call, PR mutation, merge, or deployment.'))
  assert.ok(text.includes('An unattended cloud coding trigger is not configured'))
  assert.ok(text.includes('Absence from an API response is not proof of shutdown.'))
})

test('preserves held PR 32 and 36 regardless of draft state and never promotes them', () => {
  const text = renderQueueSummary(inventory({ pullRequests: [
    { number: 32, title: 'Voice', draft: false, labels: [] },
    { number: 36, title: 'Retail', draft: true, labels: [] },
    { number: 76, title: 'Migration', draft: false, labels: [] },
  ] }))
  assert.equal((text.match(/\| HELD \| Do not resume, promote, or merge/g) ?? []).length, 2)
  assert.ok(text.includes('Inspect current-head CI/review; no action taken'))
})

test('shows empty inventories explicitly and rejects a foreign repository', () => {
  const text = renderQueueSummary(inventory())
  assert.ok(text.includes('No queue-labelled open issue'))
  assert.ok(text.includes('No work selected'))
  assert.throws(() => renderQueueSummary(inventory({ repository: 'someone/else' })), /Unexpected inventory repository/)
})
