import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { acquireLock, planQueue, readLock, releaseLock } from './codex-queue.mjs'

const issue = (number, overrides = {}) => ({
  number, state: 'open', labels: ['codex-ready'], ownerApproved: true,
  priority: null, productionDeploy: false, productionDataWrites: false, ...overrides,
})
const pr = (number, issueNumber, overrides = {}) => ({
  number, issueNumber, state: 'open', draft: false, ...overrides,
})
const verifiedExecution = (overrides = {}) => ({
  mode: 'manual', cloudCodingVerified: true, legacyDispatcherStopped: true, noOtherWorker: true, ...overrides,
})
const snapshot = (issues = [], pullRequests = [], executionContext = verifiedExecution()) => ({
  issues, pullRequests, executionContext,
})

test('missing execution context cannot implicitly authorize a coding worker', () => {
  const result = planQueue({ issues: [issue(73)], pullRequests: [] })
  assert.equal(result.action, 'stop')
  assert.equal(result.issueNumber, null)
  assert.equal(result.executionMode, null)
  assert.match(result.reason, /Execution context missing/)
})

test('explicit migration preparation never claims or resumes business work', () => {
  const result = planQueue(snapshot([
    issue(73), issue(74, { labels: ['owner-decision'] }),
  ], [pr(75, 73)], verifiedExecution({
    mode: 'prepare', cloudCodingVerified: false, legacyDispatcherStopped: null, noOtherWorker: null,
  })))
  assert.equal(result.action, 'prepare')
  assert.equal(result.executionMode, 'prepare')
  assert.equal(result.issueNumber, null)
  assert.equal(result.prNumber, null)
  assert.deepEqual(result.ignored, [{ issueNumber: 74, reason: 'blocking-status' }])
})

for (const mode of ['manual', 'scheduled']) {
  for (const legacyDispatcherStopped of [false, null]) {
    test(`${mode} worker stops when legacy dispatcher stopped=${legacyDispatcherStopped}`, () => {
      const result = planQueue(snapshot([issue(73)], [], verifiedExecution({ mode, legacyDispatcherStopped })))
      assert.equal(result.action, 'stop')
      assert.equal(result.issueNumber, null)
      assert.match(result.reason, /Legacy dispatcher/)
    })
  }
  for (const noOtherWorker of [false, null]) {
    test(`${mode} worker stops when no other worker=${noOtherWorker}`, () => {
      const result = planQueue(snapshot([issue(73)], [], verifiedExecution({ mode, noOtherWorker })))
      assert.equal(result.action, 'stop')
      assert.equal(result.issueNumber, null)
      assert.match(result.reason, /another coding worker/)
    })
  }
  test(`${mode} worker needs verified actual cloud coding capability`, () => {
    const result = planQueue(snapshot([issue(73)], [], verifiedExecution({ mode, cloudCodingVerified: false })))
    assert.equal(result.action, 'stop')
    assert.equal(result.issueNumber, null)
    assert.match(result.reason, /not coding runners/)
  })
}

test('verified scheduled mode retains existing approved PR preference', () => {
  const result = planQueue(snapshot([issue(73, { priority: 0 }), issue(70)], [pr(71, 70)], verifiedExecution({ mode: 'scheduled' })))
  assert.equal(result.executionMode, 'scheduled')
  assert.equal(result.action, 'resume-pr')
  assert.equal(result.issueNumber, 70)
  assert.equal(result.prNumber, 71)
})

test('execution observations require explicit known fields and values', () => {
  const { noOtherWorker: omitted, ...missingObservation } = verifiedExecution()
  assert.equal(omitted, true)
  for (const executionContext of [
    null, {}, [], missingObservation,
    verifiedExecution({ mode: 'unknown' }),
    verifiedExecution({ cloudCodingVerified: 'true' }),
    verifiedExecution({ legacyDispatcherStopped: 'false' }),
    verifiedExecution({ noOtherWorker: 'unknown' }),
    verifiedExecution({ distributedLockVerified: true }),
  ]) assert.throws(() => planQueue(snapshot([issue(73)], [], executionContext)))
})

for (const number of [32, 36]) {
  test(`held PR #${number} cannot resume or become a duplicate claim through stale labels`, () => {
    for (const label of ['codex-ready', 'codex-in-progress', 'codex-review']) {
      const result = planQueue(snapshot([issue(number, { labels: [label] })], [pr(number, number, { draft: true })]))
      assert.equal(result.action, 'stop')
      assert.equal(result.issueNumber, null)
      assert.equal(result.prNumber, null)
      assert.match(result.reason, /Held PR/)
    }
  })
}

test('claims at most one ready approved issue, ordered by priority then issue number', () => {
  const result = planQueue(snapshot([
    issue(8), issue(7, { priority: 2 }), issue(4, { priority: 0 }), issue(3, { priority: 0 }),
  ]))
  assert.equal(result.action, 'claim')
  assert.equal(result.issueNumber, 3)
  assert.equal(result.prNumber, null)
})

test('no eligible ready issue means read-only audit, not automatic backlog work', () => {
  assert.equal(planQueue(snapshot([issue(1, { labels: ['backlog'] })])).action, 'audit')
  assert.equal(planQueue(snapshot()).action, 'audit')
})

for (const label of ['owner-decision', 'codex-blocked', 'codex-done']) {
  test(`${label} overrides codex-ready and owner approval`, () => {
    const result = planQueue(snapshot([issue(1, { labels: ['codex-ready', label] })]))
    assert.equal(result.action, 'audit')
    assert.equal(result.ignored[0].reason, 'blocking-status')
  })
}

test('closed, unapproved and unresolved issues cannot be selected', () => {
  const result = planQueue(snapshot([
    issue(1, { state: 'closed' }),
    issue(2, { ownerApproved: false }),
    issue(3, { blockers: ['business decision pending'] }),
  ]))
  assert.equal(result.action, 'audit')
  assert.equal(result.ignored.length, 3)
})

for (const flag of ['productionDeploy', 'productionDataWrites']) {
  test(`${flag} requests cannot enter automated development even when approved and ready`, () => {
    const result = planQueue(snapshot([issue(1, { [flag]: true })], [pr(8, 1)]))
    assert.equal(result.action, 'audit')
    assert.equal(result.ignored[0].reason, 'protected-production-action')
  })
}

test('an existing authorized PR takes precedence over a higher-priority new issue', () => {
  const result = planQueue(snapshot([issue(1, { priority: 0 }), issue(2)], [pr(12, 2)]))
  assert.equal(result.action, 'resume-pr')
  assert.equal(result.issueNumber, 2)
  assert.equal(result.prNumber, 12)
})

for (const label of ['codex-in-progress', 'codex-review']) {
  test(`${label} resumes a linked authorized PR without needing a ready label`, () => {
    const result = planQueue(snapshot([issue(1), issue(2, { labels: [label] })], [pr(12, 2)]))
    assert.equal(result.action, 'resume-pr')
    assert.equal(result.prNumber, 12)
  })
}

test('authorized draft is resumed, while unrelated existing drafts are ignored', () => {
  const result = planQueue(snapshot([issue(59)], [
    pr(32, null, { draft: true }), pr(36, 36, { draft: true }), pr(60, 59, { draft: true }),
  ]))
  assert.equal(result.action, 'resume-pr')
  assert.equal(result.prNumber, 60)
  assert.equal(planQueue(snapshot([], [pr(32, null, { draft: true }), pr(36, 36, { draft: true })])).action, 'audit')
})

test('an active issue without a PR resumes its checkpoint instead of starting a new task', () => {
  const result = planQueue(snapshot([issue(1), issue(2, { labels: ['codex-in-progress'] })]))
  assert.equal(result.action, 'resume-issue')
  assert.equal(result.issueNumber, 2)
  assert.equal(result.prNumber, null)
})

test('blocked active work stops the dispatcher without claiming another issue', () => {
  const result = planQueue(snapshot([issue(1), issue(2, {
    labels: ['codex-in-progress', 'owner-decision'],
  })]))
  assert.equal(result.action, 'stop')
  assert.equal(result.issueNumber, null)
})

test('multiple active issues or conflicting approved PRs stop for triage', () => {
  assert.equal(planQueue(snapshot([
    issue(1, { labels: ['codex-in-progress'] }), issue(2, { labels: ['codex-review'] }),
  ])).action, 'stop')
  assert.equal(planQueue(snapshot([issue(1), issue(2)], [pr(11, 1), pr(12, 2)])).action, 'stop')
  assert.equal(planQueue(snapshot([issue(1)], [pr(11, 1), pr(12, 1)])).action, 'stop')
})

test('closed PRs do not falsely count as active work', () => {
  assert.equal(planQueue(snapshot([issue(1)], [pr(11, 1, { state: 'closed' })])).action, 'claim')
})

test('a merged PR with stale actionable issue labels stops instead of duplicating work', () => {
  for (const label of ['codex-ready', 'codex-in-progress', 'codex-review']) {
    const result = planQueue(snapshot([issue(1, { labels: [label] }), issue(2)], [pr(11, 1, { state: 'merged' })]))
    assert.equal(result.action, 'stop')
    assert.equal(result.issueNumber, null)
  }
  assert.equal(planQueue(snapshot([issue(1, { state: 'closed' }), issue(2)], [
    pr(11, 1, { state: 'merged' }),
  ])).issueNumber, 2)
})

test('malformed snapshots fail closed including missing or unknown protected flags', () => {
  const { productionDeploy: omittedFlag, ...missingFlag } = issue(1)
  assert.equal(omittedFlag, false)
  for (const input of [
    null, {}, [], { issues: [], pullRequests: [], productionMigration: true },
    snapshot([missingFlag]),
    snapshot([issue(1, { productionMigration: true })]),
    snapshot([issue(1, { productionDeploy: 'false' })]),
    snapshot([issue(1, { ownerApproved: undefined })]),
    snapshot([issue(1, { ownerApproved: 'true' })]),
    snapshot([issue(1, { priority: undefined })]),
    snapshot([issue(1, { priority: -1 })]),
    snapshot([issue(1, { labels: 'codex-ready' })]),
    snapshot([issue(1, { blockers: 'blocked' })]),
    snapshot([issue(1.2)]),
    snapshot([issue(1), issue(1)]),
    snapshot([], [pr(1, null), pr(1, null)]),
    snapshot([], [pr(1, 1.5)]),
    snapshot([], [pr(1, null, { state: 'unknown' })]),
  ]) assert.throws(() => planQueue(input))
})

test('lock is exclusive, remains until owner releases, and status is read-only', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccm-codex-lock-'))
  const lockPath = join(directory, 'codex-automation.lock')
  try {
    assert.deepEqual(readLock(lockPath), { locked: false })
    const acquired = acquireLock(lockPath, 'daily-2026-10-20')
    assert.equal(acquired.runId, 'daily-2026-10-20')
    assert.ok(Number.isFinite(Date.parse(acquired.createdAt)))
    const original = readFileSync(lockPath, 'utf8')
    assert.deepEqual(readLock(lockPath), acquired)
    assert.throws(() => acquireLock(lockPath, 'monday-other'), /already exists/)
    assert.throws(() => acquireLock(lockPath, 'daily-2026-10-20'), /already exists/)
    assert.throws(() => releaseLock(lockPath, 'monday-other'), /different run/)
    assert.equal(readFileSync(lockPath, 'utf8'), original)
    assert.deepEqual(releaseLock(lockPath, 'daily-2026-10-20'), { locked: false })
    assert.deepEqual(readLock(lockPath), { locked: false })
    assert.equal(acquireLock(lockPath, 'next-run').runId, 'next-run')
    releaseLock(lockPath, 'next-run')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('old locks never expire automatically and malformed locks are retained', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccm-codex-lock-'))
  const lockPath = join(directory, 'codex-automation.lock')
  try {
    writeFileSync(lockPath, JSON.stringify({ runId: 'old-run', createdAt: '2020-01-01T00:00:00.000Z' }))
    assert.equal(readLock(lockPath).locked, true)
    assert.throws(() => acquireLock(lockPath, 'new-run'), /already exists/)
    releaseLock(lockPath, 'old-run')
    writeFileSync(lockPath, '{broken')
    assert.throws(() => readLock(lockPath), /malformed/)
    assert.throws(() => releaseLock(lockPath, 'new-run'), /malformed/)
    assert.equal(readFileSync(lockPath, 'utf8'), '{broken')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('checkout locks do not pretend to coordinate independent clones', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccm-codex-clones-'))
  const first = join(directory, 'first-clone.lock'), second = join(directory, 'second-clone.lock')
  try {
    acquireLock(first, 'first-worker')
    acquireLock(second, 'second-worker')
    assert.equal(readLock(first).runId, 'first-worker')
    assert.equal(readLock(second).runId, 'second-worker')
    releaseLock(first, 'first-worker')
    releaseLock(second, 'second-worker')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
